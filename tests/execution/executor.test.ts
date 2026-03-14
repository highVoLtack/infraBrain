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

// Mock self-healer
vi.mock('../../src/execution/self-healer.js', () => ({
  selfHealStep: vi.fn(),
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

import { acquireLock, releaseLock, promptLockOverride } from '../../src/locks/manager.js';
import { captureSnapshot } from '../../src/execution/snapshot.js';
import { rollbackStep } from '../../src/execution/rollback.js';
import { selfHealStep } from '../../src/execution/self-healer.js';
import type { SelfHealResult } from '../../src/execution/types.js';
import type { LanguageModel } from 'ai';
import type { SkillFile } from '../../src/skills/types.js';

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
    },
    sessionId: 'test-session-id',
    sessionDir: '/tmp/test-session',
    ...overrides,
  };
}

const readPlan: FixPlan = {
  summary: 'Read-only diagnostics',
  steps: [
    { command: 'cat /etc/hosts', description: 'Read hosts', rollback: '', risk: 'read' },
    { command: 'docker ps', description: 'List containers', rollback: '', risk: 'read' },
  ],
  complexity: 'simple',
};

const writePlan: FixPlan = {
  summary: 'Fix nginx config',
  steps: [
    { command: 'cp /etc/nginx/nginx.conf /tmp/backup', description: 'Backup config', rollback: 'cp /tmp/backup /etc/nginx/nginx.conf', risk: 'write' },
  ],
  complexity: 'simple',
};

const mixedPlan: FixPlan = {
  summary: 'Full fix',
  steps: [
    { command: 'cat /var/log/nginx/error.log', description: 'Check logs', rollback: '', risk: 'read' },
    { command: 'docker stop nginx', description: 'Stop nginx', rollback: 'docker start nginx', risk: 'destructive' },
  ],
  complexity: 'moderate',
};

describe('executePlan', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(acquireLock).mockReturnValue({ status: 'acquired' });
    vi.mocked(captureSnapshot).mockResolvedValue(null);
    vi.mocked(rollbackStep).mockResolvedValue({ success: true });
  });

  it('executes plan with 2 READ steps and returns completed', async () => {
    const deps = makeDeps();
    const result = await executePlan(readPlan, 'nginx', deps);

    expect(result.status).toBe('completed');
    expect(result.stepResults).toHaveLength(2);
    expect(result.stepResults[0].status).toBe('success');
    expect(result.stepResults[1].status).toBe('success');
    // Rolling context should contain step descriptions from completed steps
    expect(result.rollingContext).toBeDefined();
    expect(result.rollingContext).toContain('Step 0');
    expect(result.rollingContext).toContain('Step 1');
  });

  it('captures snapshot before WRITE step execution', async () => {
    const deps = makeDeps();
    await executePlan(writePlan, 'nginx', deps);

    expect(captureSnapshot).toHaveBeenCalledWith(
      writePlan.steps[0],
      deps.runner,
      '/tmp/test-session',
      0,
    );
  });

  it('returns rejected when approval is denied at step 1', async () => {
    const deps = makeDeps({
      requestApproval: vi.fn()
        .mockResolvedValueOnce({ approved: true })
        .mockResolvedValueOnce({ approved: false }),
    });

    const result = await executePlan(mixedPlan, 'nginx', deps);

    expect(result.status).toBe('rejected');
    expect(result.stoppedAt).toBe(1);
  });

  it('triggers rollback and returns halted on circuit breaker', async () => {
    const deps = makeDeps({
      runner: {
        run: vi.fn<() => Promise<RunResult>>().mockResolvedValue({ stdout: '', stderr: 'fail', exitCode: 1 }),
      },
    });

    const plan: FixPlan = {
      summary: 'Failing plan',
      steps: [
        { command: 'docker restart nginx', description: 'Restart nginx', rollback: 'docker start nginx', risk: 'write' },
      ],
      complexity: 'simple',
    };

    const result = await executePlan(plan, 'nginx', deps);

    expect(result.status).toBe('halted');
    expect(result.reason).toContain('circuit_breaker');
    expect(rollbackStep).toHaveBeenCalled();
    // No steps completed successfully, so rollingContext is undefined (empty string -> undefined)
    expect(result.rollingContext).toBeUndefined();
  });

  it('returns partial rollingContext when circuit breaker halts after some successful steps', async () => {
    const runner = {
      run: vi.fn<() => Promise<RunResult>>()
        .mockResolvedValueOnce({ stdout: 'hosts content', stderr: '', exitCode: 0 })
        .mockResolvedValue({ stdout: '', stderr: 'fail', exitCode: 1 }),
    };
    const deps = makeDeps({ runner });

    const plan: FixPlan = {
      summary: 'Partial fail plan',
      steps: [
        { command: 'cat /etc/hosts', description: 'Read hosts', rollback: '', risk: 'read' },
        { command: 'docker restart nginx', description: 'Restart nginx', rollback: 'docker start nginx', risk: 'write' },
      ],
      complexity: 'simple',
    };

    const result = await executePlan(plan, 'nginx', deps);

    expect(result.status).toBe('halted');
    expect(result.reason).toContain('circuit_breaker');
    // Rolling context should contain partial results from the successful first step
    expect(result.rollingContext).toBeDefined();
    expect(result.rollingContext).toContain('Step 0');
    expect(result.rollingContext).toContain('Read hosts');
  });

  it('triggers rollback and returns halted on damage budget exceeded', async () => {
    const deps = makeDeps();
    // Config with very low budget
    deps.config = {
      ...deps.config,
      damageBudget: { maxPoints: 1 },
    };

    const plan: FixPlan = {
      summary: 'Over budget plan',
      steps: [
        { command: 'docker stop nginx', description: 'Stop', rollback: 'docker start nginx', risk: 'destructive' },
      ],
      complexity: 'simple',
    };

    const result = await executePlan(plan, 'nginx', deps);

    expect(result.status).toBe('halted');
    expect(result.reason).toContain('damage_budget');
    expect(rollbackStep).toHaveBeenCalled();
    // No steps completed before budget exceeded, so rollingContext is undefined
    expect(result.rollingContext).toBeUndefined();
  });

  it('returns rejected on lock conflict without override', async () => {
    vi.mocked(acquireLock).mockReturnValue({
      status: 'locked',
      existing: {
        target: 'nginx',
        sessionId: 'other-session',
        adminName: 'other-admin',
        createdAt: new Date().toISOString(),
        pid: 1234,
        planSummary: 'other plan',
      },
    });
    vi.mocked(promptLockOverride).mockResolvedValue(false);

    const deps = makeDeps();
    const result = await executePlan(readPlan, 'nginx', deps);

    expect(result.status).toBe('rejected');
    expect(result.reason).toContain('lock');
    // Rolling context should be undefined -- context not yet created before lock acquisition
    expect(result.rollingContext).toBeUndefined();
  });

  it('releases lock in finally block even when error thrown', async () => {
    const deps = makeDeps({
      requestApproval: vi.fn().mockRejectedValue(new Error('unexpected')),
    });

    try {
      await executePlan(readPlan, 'nginx', deps);
    } catch {
      // Expected
    }

    expect(releaseLock).toHaveBeenCalled();
  });

  it('logs budget status after each successful step', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const deps = makeDeps();

    await executePlan(readPlan, 'nginx', deps);

    // Budget display for each step
    const budgetLogs = consoleSpy.mock.calls.filter(
      call => typeof call[0] === 'string' && call[0].includes('Budget:'),
    );
    expect(budgetLogs.length).toBe(2); // One per step

    consoleSpy.mockRestore();
  });

  it('shows bold red alert on circuit breaker trigger', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const deps = makeDeps({
      runner: {
        run: vi.fn<() => Promise<RunResult>>().mockResolvedValue({ stdout: '', stderr: 'fail', exitCode: 1 }),
      },
    });

    const plan: FixPlan = {
      summary: 'Fail plan',
      steps: [
        { command: 'docker restart nginx', description: 'Restart', rollback: 'docker start nginx', risk: 'write' },
      ],
      complexity: 'simple',
    };

    await executePlan(plan, 'nginx', deps);

    const alertLogs = consoleSpy.mock.calls.filter(
      call => typeof call[0] === 'string' && call[0].includes('CIRCUIT BREAKER'),
    );
    expect(alertLogs.length).toBeGreaterThan(0);

    consoleSpy.mockRestore();
  });

  it('shows bold red alert on damage budget exceeded', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const deps = makeDeps();
    deps.config = { ...deps.config, damageBudget: { maxPoints: 1 } };

    const plan: FixPlan = {
      summary: 'Over budget',
      steps: [
        { command: 'docker stop nginx', description: 'Stop', rollback: 'docker start nginx', risk: 'destructive' },
      ],
      complexity: 'simple',
    };

    await executePlan(plan, 'nginx', deps);

    const alertLogs = consoleSpy.mock.calls.filter(
      call => typeof call[0] === 'string' && call[0].includes('DAMAGE BUDGET'),
    );
    expect(alertLogs.length).toBeGreaterThan(0);

    consoleSpy.mockRestore();
  });

  describe('self-healing integration', () => {
    const mockModel = {} as LanguageModel;
    const mockSkill: SkillFile = {
      frontmatter: {
        name: 'linux-expert',
        description: 'Linux expert skill for testing',
        triggers: ['linux'],
        tools: {},
        priority: 0,
      },
      sections: { systemPrompt: 'test' },
      rawContent: '',
      filePath: 'skills/linux-expert.md',
    };

    function makeSelfHealDeps(overrides: Partial<ExecutionDeps> = {}): ExecutionDeps {
      return makeDeps({
        correctionModel: mockModel,
        skill: mockSkill,
        rewriteRules: [],
        containers: ['test-container'],
        ...overrides,
      });
    }

    it('uses self-healing when command fails and correctionModel+skill are in deps', async () => {
      const failResult: RunResult = { stdout: '', stderr: 'permission denied', exitCode: 1 };
      const successResult: RunResult = { stdout: 'ok', stderr: '', exitCode: 0 };

      const deps = makeSelfHealDeps({
        runner: {
          run: vi.fn<() => Promise<RunResult>>().mockResolvedValue(failResult),
        },
      });

      const healResult: SelfHealResult = {
        status: 'success',
        finalResult: successResult,
        attempts: [{
          originalCommand: 'docker exec test chown 1000:1000 /data',
          correctedCommand: 'docker exec -u 0 test chown 1000:1000 /data',
          error: { stderr: 'permission denied', exitCode: 1 },
          outcome: 'success',
        }],
        commandUsed: 'docker exec -u 0 test chown 1000:1000 /data',
      };

      vi.mocked(selfHealStep).mockResolvedValue(healResult);

      const plan: FixPlan = {
        summary: 'Fix permissions',
        steps: [
          { command: 'docker exec test chown 1000:1000 /data', description: 'Fix ownership', rollback: '', risk: 'write' },
        ],
        complexity: 'simple',
      };

      const result = await executePlan(plan, 'test-target', deps);

      expect(result.status).toBe('completed');
      expect(result.stepResults[0].status).toBe('success');
      expect(selfHealStep).toHaveBeenCalledOnce();
    });

    it('falls back to CircuitBreaker when no correctionModel in deps', async () => {
      const deps = makeDeps({
        runner: {
          run: vi.fn<() => Promise<RunResult>>().mockResolvedValue({ stdout: '', stderr: 'fail', exitCode: 1 }),
        },
      });
      // No correctionModel, no skill -- should use CircuitBreaker

      const plan: FixPlan = {
        summary: 'Failing plan',
        steps: [
          { command: 'docker restart nginx', description: 'Restart', rollback: 'docker start nginx', risk: 'write' },
        ],
        complexity: 'simple',
      };

      const result = await executePlan(plan, 'nginx', deps);

      expect(result.status).toBe('halted');
      expect(result.reason).toBe('circuit_breaker');
      expect(selfHealStep).not.toHaveBeenCalled();
    });

    it('halts with self_heal_exhausted when self-healing fails all attempts', async () => {
      const failResult: RunResult = { stdout: '', stderr: 'command not found', exitCode: 127 };

      const deps = makeSelfHealDeps({
        runner: {
          run: vi.fn<() => Promise<RunResult>>().mockResolvedValue(failResult),
        },
      });

      const healResult: SelfHealResult = {
        status: 'exhausted',
        attempts: [
          { originalCommand: 'bad-cmd', correctedCommand: 'also-bad', error: { stderr: 'not found', exitCode: 127 }, outcome: 'failed' },
          { originalCommand: 'bad-cmd', correctedCommand: 'still-bad', error: { stderr: 'not found', exitCode: 127 }, outcome: 'failed' },
          { originalCommand: 'bad-cmd', correctedCommand: 'nope', error: { stderr: 'not found', exitCode: 127 }, outcome: 'failed' },
        ],
        commandUsed: 'bad-cmd',
      };

      vi.mocked(selfHealStep).mockResolvedValue(healResult);

      const plan: FixPlan = {
        summary: 'Bad plan',
        steps: [
          { command: 'bad-cmd', description: 'Bad command', rollback: '', risk: 'write' },
        ],
        complexity: 'simple',
      };

      const result = await executePlan(plan, 'test-target', deps);

      expect(result.status).toBe('halted');
      expect(result.reason).toBe('self_heal_exhausted');
      expect(result.stepResults[0].status).toBe('failed');
      expect(result.stepResults[0].retries).toBe(3);
      expect(rollbackStep).toHaveBeenCalled();
    });

    it('rolling context receives corrected command after self-healing success', async () => {
      const failResult: RunResult = { stdout: '', stderr: 'error', exitCode: 1 };
      const successResult: RunResult = { stdout: 'fixed output', stderr: '', exitCode: 0 };

      const deps = makeSelfHealDeps({
        runner: {
          run: vi.fn<() => Promise<RunResult>>()
            .mockResolvedValueOnce(failResult)  // First attempt fails
            .mockResolvedValue({ stdout: 'ok', stderr: '', exitCode: 0 }),  // Success after heal
        },
      });

      const correctedCmd = 'docker exec -u 0 test chown 1000:1000 /data';
      vi.mocked(selfHealStep).mockResolvedValue({
        status: 'success',
        finalResult: successResult,
        attempts: [{
          originalCommand: 'docker exec test chown 1000:1000 /data',
          correctedCommand: correctedCmd,
          error: { stderr: 'error', exitCode: 1 },
          outcome: 'success',
        }],
        commandUsed: correctedCmd,
      });

      const plan: FixPlan = {
        summary: 'Fix plan',
        steps: [
          { command: 'docker exec test chown 1000:1000 /data', description: 'Fix ownership', rollback: '', risk: 'write' },
          { command: 'docker ps', description: 'Check status', rollback: '', risk: 'read' },
        ],
        complexity: 'simple',
      };

      const result = await executePlan(plan, 'test-target', deps);

      expect(result.status).toBe('completed');
      // Rolling context should contain the corrected command, not the original
      expect(result.rollingContext).toContain(correctedCmd);
      expect(result.rollingContext).not.toContain('docker exec test chown');
    });
  });

  describe('lock audit events', () => {
    it('emits lock_acquired after successful lock acquisition', async () => {
      const deps = makeDeps();
      await executePlan(readPlan, 'nginx', deps);

      expect(deps.auditLogger.logExecution).toHaveBeenCalledWith('lock_acquired', { target: 'nginx' });
    });

    it('emits lock_released after lock release in finally block', async () => {
      const deps = makeDeps();
      await executePlan(readPlan, 'nginx', deps);

      expect(deps.auditLogger.logExecution).toHaveBeenCalledWith('lock_released', { target: 'nginx' });
    });

    it('emits lock_conflict when lock is held and no readline for override', async () => {
      vi.mocked(acquireLock).mockReturnValue({
        status: 'locked',
        existing: {
          target: 'nginx',
          sessionId: 'other-session',
          adminName: 'other-admin',
          createdAt: new Date().toISOString(),
          pid: 1234,
          planSummary: 'other plan',
        },
      });

      const deps = makeDeps();
      // No readline on deps means override prompt is skipped
      delete (deps as Record<string, unknown>).readline;
      await executePlan(readPlan, 'nginx', deps);

      expect(deps.auditLogger.logExecution).toHaveBeenCalledWith('lock_conflict', {
        target: 'nginx',
        existingSession: 'other-session',
      });
    });

    it('emits lock_override when force-override succeeds', async () => {
      vi.mocked(acquireLock)
        .mockReturnValueOnce({
          status: 'locked',
          existing: {
            target: 'nginx',
            sessionId: 'other-session',
            adminName: 'other-admin',
            createdAt: new Date().toISOString(),
            pid: 1234,
            planSummary: 'other plan',
          },
        })
        .mockReturnValueOnce({ status: 'acquired' });
      vi.mocked(promptLockOverride).mockResolvedValue(true);

      const deps = makeDeps({
        readline: {} as ExecutionDeps['readline'],
      });
      await executePlan(readPlan, 'nginx', deps);

      expect(deps.auditLogger.logExecution).toHaveBeenCalledWith('lock_override', {
        target: 'nginx',
        overriddenSession: 'other-session',
      });
    });

    it('does NOT emit lock_acquired when lock acquisition is rejected', async () => {
      vi.mocked(acquireLock).mockReturnValue({
        status: 'locked',
        existing: {
          target: 'nginx',
          sessionId: 'other-session',
          adminName: 'other-admin',
          createdAt: new Date().toISOString(),
          pid: 1234,
          planSummary: 'other plan',
        },
      });

      const deps = makeDeps();
      delete (deps as Record<string, unknown>).readline;
      await executePlan(readPlan, 'nginx', deps);

      expect(deps.auditLogger.logExecution).not.toHaveBeenCalledWith('lock_acquired', expect.anything());
    });
  });
});
