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

import { acquireLock, releaseLock } from '../../src/locks/manager.js';

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
      ollamaBaseUrl: 'http://localhost:11434',
      modelName: 'llama3.3:70b',
      apiPort: 3000,
      sessionDir: '.infrabrain',
      skillsDir: 'skills',
      tokenBudgets: { diagnosis: 4096, command: 2048 },
      circuitBreaker: { maxRetries: 3, retryDelayMs: 0 },
      damageBudget: { maxPoints: 10 },
      locks: { staleTimeoutMs: 3600000 },
      execution: { commandTimeoutMs: 30000, maxBufferBytes: 1024 * 1024 },
      resumeWindowMs: 86400000,
    },
    sessionId: 'test-session-id',
    sessionDir: '/tmp/test-session',
    ...overrides,
  };
}

const fiveStepPlan: FixPlan = {
  summary: 'Multi-step fix',
  steps: [
    { command: 'echo step0', description: 'Step 0', rollback: '', risk: 'read' },
    { command: 'echo step1', description: 'Step 1', rollback: '', risk: 'read' },
    { command: 'echo step2', description: 'Step 2', rollback: '', risk: 'read' },
    { command: 'echo step3', description: 'Step 3', rollback: '', risk: 'read' },
    { command: 'echo step4', description: 'Step 4', rollback: '', risk: 'read' },
  ],
  complexity: 'moderate',
};

describe('executePlan with resume (startFromStep)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(acquireLock).mockReturnValue({ status: 'acquired' });
  });

  it('skips steps 0 and 1 when startFromStep=2, executes 2-4 normally', async () => {
    const deps = makeDeps();
    const result = await executePlan(fiveStepPlan, 'nginx', deps, { startFromStep: 2 });

    expect(result.status).toBe('completed');
    expect(result.stepResults).toHaveLength(5);
    expect(result.stepResults[0].status).toBe('skipped');
    expect(result.stepResults[1].status).toBe('skipped');
    expect(result.stepResults[2].status).toBe('success');
    expect(result.stepResults[3].status).toBe('success');
    expect(result.stepResults[4].status).toBe('success');

    // Runner should only be called for steps 2, 3, 4
    expect(deps.runner.run).toHaveBeenCalledTimes(3);
  });

  it('skips steps 0, 1, and 2 when startFromStep=2 with skipFailedStep=true', async () => {
    const deps = makeDeps();
    const result = await executePlan(fiveStepPlan, 'nginx', deps, { startFromStep: 2, skipFailedStep: true });

    expect(result.status).toBe('completed');
    expect(result.stepResults).toHaveLength(5);
    expect(result.stepResults[0].status).toBe('skipped');
    expect(result.stepResults[1].status).toBe('skipped');
    expect(result.stepResults[2].status).toBe('skipped');
    expect(result.stepResults[3].status).toBe('success');
    expect(result.stepResults[4].status).toBe('success');

    // Runner should only be called for steps 3, 4
    expect(deps.runner.run).toHaveBeenCalledTimes(2);
  });

  it('logs execution_resume audit event with correct metadata', async () => {
    const deps = makeDeps();
    await executePlan(fiveStepPlan, 'nginx', deps, { startFromStep: 2 });

    expect(deps.auditLogger.logExecution).toHaveBeenCalledWith('execution_resume', {
      resumingFrom: 2,
      totalSteps: 5,
    });
  });
});
