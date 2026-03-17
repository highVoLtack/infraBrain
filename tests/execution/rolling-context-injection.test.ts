import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executePlan } from '../../src/execution/executor.js';
import type { FixPlan } from '../../src/orchestrator/types.js';
import type { RunResult, ExecutionDeps } from '../../src/execution/types.js';

// Mock lock manager
vi.mock('../../src/locks/manager.js', () => ({
  acquireLock: vi.fn(),
  releaseLock: vi.fn(),
  formatLockConflict: vi.fn(() => 'Lock conflict message'),
  promptLockOverride: vi.fn(),
}));

// Mock snapshot
vi.mock('../../src/execution/snapshot.js', () => ({
  captureSnapshot: vi.fn().mockResolvedValue(null),
  getSnapshotCommand: vi.fn(),
  SNAPSHOT_COMMANDS: {},
}));

// Mock rollback
vi.mock('../../src/execution/rollback.js', () => ({
  rollbackStep: vi.fn().mockResolvedValue({ success: true }),
}));

// Mock chalk to avoid ANSI in test assertions
vi.mock('chalk', () => {
  const handler: ProxyHandler<object> = {
    get(_t, prop) {
      if (prop === 'default') return new Proxy(() => {}, handler);
      if (typeof prop === 'symbol') return undefined;
      return new Proxy((...args: unknown[]) => args.join(' '), handler);
    },
    apply(_t, _this, args) {
      return args.join(' ');
    },
  };
  return { default: new Proxy(() => {}, handler) };
});

import { acquireLock } from '../../src/locks/manager.js';

function makeDeps(overrides: Partial<ExecutionDeps> = {}): ExecutionDeps {
  return {
    runner: {
      run: vi.fn<() => Promise<RunResult>>().mockResolvedValue({ stdout: 'ok', stderr: '', exitCode: 0 }),
    },
    requestApproval: vi.fn().mockResolvedValue({ approved: true }),
    auditLogger: {
      log: vi.fn(),
      logExecution: vi.fn(),
    } as unknown as ExecutionDeps['auditLogger'],
    config: {
      defaultBaseUrl: 'http://localhost:11434/v1',
      modelName: 'llama3.3:70b',
      apiPort: 3000,
      sessionDir: '.infrabrain',
      skillsDir: 'skills',
      tokenBudgets: { diagnosis: 4096, command: 2048 },
      circuitBreaker: { maxRetries: 3, retryDelayMs: 0 },
      damageBudget: { maxPoints: 10 },
      locks: { staleTimeoutMs: 3600000 },
      execution: { commandTimeoutMs: 30000, maxBufferBytes: 1024 * 1024 },
    },
    sessionId: 'test-session-id',
    sessionDir: '/tmp/test-session',
    ...overrides,
  };
}

/** 3-step read plan with distinct outputs per step */
const threeStepPlan: FixPlan = {
  summary: 'Three-step diagnostic',
  steps: [
    { command: 'echo step-0-output', description: 'Step zero', rollback: '', risk: 'read' },
    { command: 'echo step-1-output', description: 'Step one', rollback: '', risk: 'read' },
    { command: 'echo step-2-output', description: 'Step two', rollback: '', risk: 'read' },
  ],
  complexity: 'simple',
};

describe('rolling context injection via onBeforeStep', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(acquireLock).mockReturnValue({ status: 'acquired' });
  });

  it('does NOT call onBeforeStep before step 0 (no prior context)', async () => {
    const onBeforeStep = vi.fn().mockResolvedValue(undefined);
    const runner = {
      run: vi.fn<() => Promise<RunResult>>()
        .mockResolvedValueOnce({ stdout: 'step-0-output', stderr: '', exitCode: 0 })
        .mockResolvedValueOnce({ stdout: 'step-1-output', stderr: '', exitCode: 0 })
        .mockResolvedValueOnce({ stdout: 'step-2-output', stderr: '', exitCode: 0 }),
    };
    const deps = makeDeps({ runner, onBeforeStep });

    await executePlan(threeStepPlan, 'target', deps);

    // onBeforeStep should never have been called with stepIndex 0
    const callsWithStep0 = onBeforeStep.mock.calls.filter(
      (call: [number, string]) => call[0] === 0,
    );
    expect(callsWithStep0).toHaveLength(0);
  });

  it('calls onBeforeStep before step 1 with context containing step 0 results', async () => {
    const onBeforeStep = vi.fn().mockResolvedValue(undefined);
    const runner = {
      run: vi.fn<() => Promise<RunResult>>()
        .mockResolvedValueOnce({ stdout: 'step-0-output', stderr: '', exitCode: 0 })
        .mockResolvedValueOnce({ stdout: 'step-1-output', stderr: '', exitCode: 0 })
        .mockResolvedValueOnce({ stdout: 'step-2-output', stderr: '', exitCode: 0 }),
    };
    const deps = makeDeps({ runner, onBeforeStep });

    await executePlan(threeStepPlan, 'target', deps);

    // Find the call for step 1
    const step1Call = onBeforeStep.mock.calls.find(
      (call: [number, string]) => call[0] === 1,
    );
    expect(step1Call).toBeDefined();
    // Context should contain step 0 info
    expect(step1Call![1]).toContain('Step 0');
    expect(step1Call![1]).toContain('step-0-output');
  });

  it('calls onBeforeStep before step 2 with context containing step 0 and step 1 results', async () => {
    const onBeforeStep = vi.fn().mockResolvedValue(undefined);
    const runner = {
      run: vi.fn<() => Promise<RunResult>>()
        .mockResolvedValueOnce({ stdout: 'step-0-output', stderr: '', exitCode: 0 })
        .mockResolvedValueOnce({ stdout: 'step-1-output', stderr: '', exitCode: 0 })
        .mockResolvedValueOnce({ stdout: 'step-2-output', stderr: '', exitCode: 0 }),
    };
    const deps = makeDeps({ runner, onBeforeStep });

    await executePlan(threeStepPlan, 'target', deps);

    // Find the call for step 2
    const step2Call = onBeforeStep.mock.calls.find(
      (call: [number, string]) => call[0] === 2,
    );
    expect(step2Call).toBeDefined();
    // Context should contain both step 0 and step 1 info
    expect(step2Call![1]).toContain('Step 0');
    expect(step2Call![1]).toContain('step-0-output');
    expect(step2Call![1]).toContain('Step 1');
    expect(step2Call![1]).toContain('step-1-output');
  });

  it('context string matches rollingContext.getContext() format (contains step headers, command output)', async () => {
    const onBeforeStep = vi.fn().mockResolvedValue(undefined);
    const runner = {
      run: vi.fn<() => Promise<RunResult>>()
        .mockResolvedValueOnce({ stdout: 'step-0-output', stderr: '', exitCode: 0 })
        .mockResolvedValueOnce({ stdout: 'step-1-output', stderr: '', exitCode: 0 })
        .mockResolvedValueOnce({ stdout: 'step-2-output', stderr: '', exitCode: 0 }),
    };
    const deps = makeDeps({ runner, onBeforeStep });

    await executePlan(threeStepPlan, 'target', deps);

    // Step 2 call should have full format matching RollingContext.getContext()
    const step2Call = onBeforeStep.mock.calls.find(
      (call: [number, string]) => call[0] === 2,
    );
    const ctx = step2Call![1] as string;
    // Should contain "## Step 0:" header format from RollingContext.formatFull
    expect(ctx).toContain('## Step 0:');
    expect(ctx).toContain('## Step 1:');
    expect(ctx).toContain('Command:');
    expect(ctx).toContain('Exit code:');
  });

  it('executor works normally when onBeforeStep is not provided (backwards compatible)', async () => {
    const runner = {
      run: vi.fn<() => Promise<RunResult>>()
        .mockResolvedValueOnce({ stdout: 'step-0-output', stderr: '', exitCode: 0 })
        .mockResolvedValueOnce({ stdout: 'step-1-output', stderr: '', exitCode: 0 })
        .mockResolvedValueOnce({ stdout: 'step-2-output', stderr: '', exitCode: 0 }),
    };
    // No onBeforeStep provided
    const deps = makeDeps({ runner });

    const result = await executePlan(threeStepPlan, 'target', deps);

    expect(result.status).toBe('completed');
    expect(result.stepResults).toHaveLength(3);
    expect(result.stepResults.every(s => s.status === 'success')).toBe(true);
    expect(result.rollingContext).toBeDefined();
  });

  it('skipped steps (resume) do not trigger onBeforeStep for steps 0 and 1', async () => {
    const onBeforeStep = vi.fn().mockResolvedValue(undefined);
    const runner = {
      run: vi.fn<() => Promise<RunResult>>()
        .mockResolvedValue({ stdout: 'step-2-output', stderr: '', exitCode: 0 }),
    };
    const deps = makeDeps({ runner, onBeforeStep });

    // Resume from step 2 -- steps 0 and 1 are skipped
    await executePlan(threeStepPlan, 'target', deps, { startFromStep: 2 });

    // onBeforeStep should NOT be called for skipped steps
    // Also should NOT be called for step 2 since no prior context exists (skipped steps don't add context)
    expect(onBeforeStep).not.toHaveBeenCalled();
  });

  it('rollingContext on ExecutionResult still works when onBeforeStep is provided and plan halts', async () => {
    const onBeforeStep = vi.fn().mockResolvedValue(undefined);
    const runner = {
      run: vi.fn<() => Promise<RunResult>>()
        .mockResolvedValueOnce({ stdout: 'step-0-output', stderr: '', exitCode: 0 })
        .mockResolvedValue({ stdout: '', stderr: 'fail', exitCode: 1 }),
    };
    const deps = makeDeps({ runner, onBeforeStep });

    const haltPlan: FixPlan = {
      summary: 'Halt after step 0',
      steps: [
        { command: 'echo ok', description: 'First step', rollback: '', risk: 'read' },
        { command: 'docker restart fail', description: 'Failing step', rollback: 'docker start fail', risk: 'write' },
      ],
      complexity: 'simple',
    };

    const result = await executePlan(haltPlan, 'target', deps);

    expect(result.status).toBe('halted');
    // Rolling context should still contain step 0 results
    expect(result.rollingContext).toBeDefined();
    expect(result.rollingContext).toContain('Step 0');
    expect(result.rollingContext).toContain('step-0-output');
  });
});
