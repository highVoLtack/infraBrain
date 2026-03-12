import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createResumeRoute } from '../../src/api/routes/resume.js';
import { createExecuteRoute } from '../../src/api/routes/execute.js';
import type { SessionState } from '../../src/state/types.js';
import type { WriteThrough } from '../../src/state/store.js';
import type { InfraBrainConfig } from '../../src/config/types.js';

// Mock executePlan
vi.mock('../../src/execution/executor.js', () => ({
  executePlan: vi.fn().mockResolvedValue({ status: 'completed', stepResults: [] }),
}));

// Mock runner — track calls to runCommand
vi.mock('../../src/execution/runner.js', () => ({
  runCommand: vi.fn().mockResolvedValue({ stdout: 'real-output', stderr: '', exitCode: 0 }),
  parseCommand: vi.fn().mockReturnValue({ executable: 'echo', args: ['test'] }),
}));

// Mock lock manager
vi.mock('../../src/locks/manager.js', () => ({
  acquireLock: vi.fn().mockReturnValue({ status: 'acquired' }),
  releaseLock: vi.fn(),
  formatLockConflict: vi.fn(() => 'Lock conflict'),
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

import { executePlan } from '../../src/execution/executor.js';
import { runCommand } from '../../src/execution/runner.js';

function makeConfig(): InfraBrainConfig {
  return {
    ollamaBaseUrl: 'http://localhost:11434',
    modelName: 'llama3.3:70b',
    apiPort: 3000,
    sessionDir: '.infrabrain',
    skillsDir: 'skills',
    tokenBudgets: { diagnosis: 4096, command: 2048 },
    circuitBreaker: { maxRetries: 3, retryDelayMs: 0 },
    damageBudget: { maxPoints: 10 },
    resumeWindowMs: 86400000, // 24h
    locks: { staleTimeoutMs: 3600000 },
    execution: { commandTimeoutMs: 30000, maxBufferBytes: 1024 * 1024 },
  };
}

function makeResumableSession(overrides: Partial<SessionState> = {}): SessionState {
  return {
    sessionId: 'test-session-123',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: 'active',
    currentPlan: {
      id: 'plan-1',
      description: 'Fix nginx',
      steps: [
        { id: 0, command: 'echo step0', description: 'Step 0', status: 'executed', riskLevel: 'read' },
        { id: 1, command: 'echo step1', description: 'Step 1', status: 'executed', riskLevel: 'read' },
        { id: 2, command: 'echo step2', description: 'Step 2', status: 'failed', riskLevel: 'write' },
        { id: 3, command: 'echo step3', description: 'Step 3', status: 'pending', riskLevel: 'read' },
      ],
      currentStep: 2,
      status: 'failed',
    },
    resumeMetadata: {
      lastCompletedStep: 1,
      stoppedAt: new Date().toISOString(),
      error: 'circuit_breaker',
      target: 'nginx',
    },
    ...overrides,
  };
}

function makeStore(getByIdResult: SessionState | null = null): WriteThrough {
  return {
    getSessionById: vi.fn().mockReturnValue(getByIdResult),
    persistState: vi.fn(),
    appendAudit: vi.fn(),
    getRecentSessions: vi.fn().mockReturnValue([]),
    getIncompleteSessions: vi.fn().mockReturnValue([]),
    queryAuditLog: vi.fn().mockReturnValue([]),
  } as unknown as WriteThrough;
}

function makeApp(store: WriteThrough, config?: InfraBrainConfig) {
  const app = express();
  app.use(express.json());
  app.use('/resume', createResumeRoute({
    store,
    config: config ?? makeConfig(),
    auditLogger: { logExecution: vi.fn() } as any,
    sessionId: 'current-session',
    sessionDir: '/tmp/test-session',
  }));
  return app;
}

describe('POST /resume', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(executePlan).mockResolvedValue({ status: 'completed', stepResults: [] });
  });

  it('returns 404 with "Session not found" for unknown sessionId', async () => {
    const store = makeStore(null);
    const app = makeApp(store);

    const res = await request(app)
      .post('/resume')
      .send({ sessionId: 'unknown-id', action: 'retry' });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Session not found');
  });

  it('returns 400 with "No resumable plan in session" when session has no resumeMetadata', async () => {
    const session = makeResumableSession();
    delete session.resumeMetadata;
    session.status = 'completed';
    const store = makeStore(session);
    const app = makeApp(store);

    const res = await request(app)
      .post('/resume')
      .send({ sessionId: session.sessionId, action: 'retry' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('No resumable plan in session');
  });

  it('calls executePlan with correct startFromStep for retry action', async () => {
    const session = makeResumableSession();
    const store = makeStore(session);
    const app = makeApp(store);

    const res = await request(app)
      .post('/resume')
      .send({ sessionId: session.sessionId, action: 'retry' });

    expect(res.status).toBe(200);
    // lastCompletedStep=1, so startFromStep=2 (retry the failed step)
    expect(executePlan).toHaveBeenCalledWith(
      expect.anything(),
      'nginx',
      expect.anything(),
      { startFromStep: 2, skipFailedStep: false },
    );
  });

  it('calls executePlan with skipFailedStep=true for skip action', async () => {
    const session = makeResumableSession();
    const store = makeStore(session);
    const app = makeApp(store);

    const res = await request(app)
      .post('/resume')
      .send({ sessionId: session.sessionId, action: 'skip' });

    expect(res.status).toBe(200);
    expect(executePlan).toHaveBeenCalledWith(
      expect.anything(),
      'nginx',
      expect.anything(),
      { startFromStep: 2, skipFailedStep: true },
    );
  });

  it('includes warning for stale session (stoppedAt older than resumeWindowMs)', async () => {
    const session = makeResumableSession();
    // Set stoppedAt to 2 days ago (older than 24h window)
    session.resumeMetadata!.stoppedAt = new Date(Date.now() - 2 * 86400000).toISOString();
    const store = makeStore(session);
    const app = makeApp(store);

    const res = await request(app)
      .post('/resume')
      .send({ sessionId: session.sessionId, action: 'retry' });

    expect(res.status).toBe(200);
    expect(res.body.warning).toBeDefined();
    expect(res.body.warning).toContain('old');
  });

  it('has no warning for fresh session within window', async () => {
    const session = makeResumableSession();
    // stoppedAt is now (fresh)
    const store = makeStore(session);
    const app = makeApp(store);

    const res = await request(app)
      .post('/resume')
      .send({ sessionId: session.sessionId, action: 'retry' });

    expect(res.status).toBe(200);
    expect(res.body.warning).toBeUndefined();
  });

  it('passes real runCommand runner to executePlan (not a stub)', async () => {
    const session = makeResumableSession();
    const store = makeStore(session);
    const app = makeApp(store);

    await request(app)
      .post('/resume')
      .send({ sessionId: session.sessionId, action: 'retry' });

    // Verify executePlan was called with a runner that uses runCommand
    const callArgs = vi.mocked(executePlan).mock.calls[0];
    const deps = callArgs[2];

    // Call the runner to verify it delegates to the real runCommand
    await deps.runner.run('echo', ['hello'], { timeout: 5000 });
    expect(runCommand).toHaveBeenCalledWith('echo', ['hello'], { timeout: 5000 });
  });

  it('includes session data in response for CLI formatResumeSummary', async () => {
    const session = makeResumableSession();
    const store = makeStore(session);
    const app = makeApp(store);

    const res = await request(app)
      .post('/resume')
      .send({ sessionId: session.sessionId, action: 'retry' });

    expect(res.status).toBe(200);
    expect(res.body.session).toBeDefined();
    expect(res.body.session.sessionId).toBe(session.sessionId);
    expect(res.body.session.currentPlan).toBeDefined();
    expect(res.body.session.resumeMetadata).toBeDefined();
  });
});

describe('POST /execute — halt persistence', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(executePlan).mockResolvedValue({ status: 'completed', stepResults: [] });
  });

  function makeExecuteApp(store: WriteThrough) {
    const app = express();
    app.use(express.json());
    app.use('/execute', createExecuteRoute({
      auditLogger: { logExecution: vi.fn() } as any,
      config: makeConfig(),
      sessionId: 'exec-session-1',
      sessionDir: '/tmp/test-session',
      store,
    }));
    return app;
  }

  const validBody = {
    sessionId: 'exec-session-1',
    target: 'nginx',
    adminName: 'admin',
    fixPlan: {
      summary: 'Fix nginx',
      steps: [
        { command: 'echo step0', description: 'Step 0', rollback: '', risk: 'read' },
        { command: 'echo step1', description: 'Step 1', rollback: '', risk: 'write' },
        { command: 'echo step2', description: 'Step 2', rollback: '', risk: 'read' },
      ],
      complexity: 'moderate',
    },
  };

  it('persists resumeMetadata and currentPlan when executePlan returns halted (damage_budget_exceeded)', async () => {
    vi.mocked(executePlan).mockResolvedValue({
      status: 'halted',
      reason: 'damage_budget_exceeded',
      stoppedAt: 1,
      stepResults: [{ stepIndex: 0, status: 'success', retries: 0, damageCost: 5 }],
    });

    const store = makeStore(null);
    const app = makeExecuteApp(store);

    await request(app)
      .post('/execute')
      .send(validBody);

    expect(store.persistState).toHaveBeenCalledTimes(1);
    const persistedState = vi.mocked(store.persistState).mock.calls[0][1] as SessionState;
    expect(persistedState.resumeMetadata).toBeDefined();
    expect(persistedState.resumeMetadata!.error).toBe('damage_budget_exceeded');
    expect(persistedState.resumeMetadata!.lastCompletedStep).toBe(0);
    expect(persistedState.currentPlan).toBeDefined();
    expect(persistedState.currentPlan!.stoppedAtStep).toBe(1);
  });

  it('persists resumeMetadata and currentPlan when executePlan returns halted (circuit_breaker)', async () => {
    vi.mocked(executePlan).mockResolvedValue({
      status: 'halted',
      reason: 'circuit_breaker',
      stoppedAt: 2,
      stepResults: [
        { stepIndex: 0, status: 'success', retries: 0, damageCost: 0 },
        { stepIndex: 1, status: 'success', retries: 0, damageCost: 3 },
      ],
    });

    const store = makeStore(null);
    const app = makeExecuteApp(store);

    await request(app)
      .post('/execute')
      .send(validBody);

    expect(store.persistState).toHaveBeenCalledTimes(1);
    const persistedState = vi.mocked(store.persistState).mock.calls[0][1] as SessionState;
    expect(persistedState.resumeMetadata!.error).toBe('circuit_breaker');
    expect(persistedState.resumeMetadata!.lastCompletedStep).toBe(1);
    expect(persistedState.resumeMetadata!.target).toBe('nginx');
    expect(persistedState.currentPlan!.failureReason).toBe('circuit_breaker');
  });

  it('does NOT set resumeMetadata when executePlan returns completed', async () => {
    vi.mocked(executePlan).mockResolvedValue({
      status: 'completed',
      stepResults: [
        { stepIndex: 0, status: 'success', retries: 0, damageCost: 0 },
      ],
    });

    const store = makeStore(null);
    const app = makeExecuteApp(store);

    await request(app)
      .post('/execute')
      .send(validBody);

    expect(store.persistState).not.toHaveBeenCalled();
  });
});
