import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Mock heavy dependencies
vi.mock('../../src/execution/runner.js', () => ({
  runCommand: vi.fn(),
  parseCommand: vi.fn().mockReturnValue({ executable: 'echo', args: ['test'] }),
  needsShell: vi.fn().mockReturnValue(false),
  runShellCommand: vi.fn(),
  findDbContainer: vi.fn(),
}));
vi.mock('../../src/execution/circuit-breaker.js', () => ({
  CircuitBreaker: vi.fn().mockImplementation(() => ({
    execute: vi.fn(),
  })),
}));
vi.mock('../../src/execution/damage-budget.js', () => ({
  DamageBudget: vi.fn().mockImplementation(() => ({
    canAfford: vi.fn().mockReturnValue(true),
    costFor: vi.fn().mockReturnValue(1),
    deduct: vi.fn(),
    remaining: 10,
    total: 10,
    spent: 0,
  })),
}));
vi.mock('../../src/execution/context-builder.js', () => ({
  RollingContext: vi.fn().mockImplementation(() => ({
    getContext: vi.fn().mockReturnValue(''),
    addStepResult: vi.fn(),
  })),
}));
vi.mock('../../src/execution/snapshot.js', () => ({
  captureSnapshot: vi.fn().mockResolvedValue(null),
}));
vi.mock('../../src/execution/rollback.js', () => ({
  rollbackStep: vi.fn(),
}));
vi.mock('../../src/execution/self-healer.js', () => ({
  selfHealStep: vi.fn(),
  buildToolListFromSkill: vi.fn(),
  extractSkillDomainKnowledge: vi.fn(),
}));
vi.mock('../../src/execution/persistence-verification.js', () => ({
  isConfigModification: vi.fn().mockReturnValue(false),
  isRestartStep: vi.fn().mockReturnValue(false),
  verifyPersistence: vi.fn(),
}));
vi.mock('../../src/locks/manager.js', () => ({
  acquireLock: vi.fn().mockReturnValue({ status: 'acquired' }),
  releaseLock: vi.fn(),
  promptLockOverride: vi.fn(),
}));
vi.mock('../../src/safety/validator.js', () => ({
  sanitizeDockerExec: vi.fn((cmd: string) => cmd),
}));
vi.mock('../../src/execution/dynamic-rewriter.js', () => ({
  toolsToRewriteRules: vi.fn().mockReturnValue([]),
}));
vi.mock('../../src/cache/cache-lookup.js', () => ({
  storeFixInCache: vi.fn().mockResolvedValue(undefined),
  recordFixOutcome: vi.fn().mockResolvedValue(undefined),
  checkCache: vi.fn().mockResolvedValue({ type: 'miss' }),
}));
vi.mock('../../src/cache/lance-store.js', () => ({
  getCacheStore: vi.fn(() => ({
    init: vi.fn().mockResolvedValue(undefined),
  })),
}));
vi.mock('../../src/memory/incident-store.js', () => ({
  getIncidentStore: vi.fn(() => ({
    add: vi.fn().mockResolvedValue('inc-1'),
    init: vi.fn().mockResolvedValue(undefined),
  })),
}));
vi.mock('../../src/memory/entity-store.js', () => ({
  getEntityStore: vi.fn(() => ({
    add: vi.fn().mockResolvedValue(undefined),
    init: vi.fn().mockResolvedValue(undefined),
  })),
}));
vi.mock('../../src/memory/wal.js', () => ({
  getMemoryWAL: vi.fn(() => ({
    append: vi.fn(),
    read: vi.fn().mockReturnValue([]),
  })),
}));
vi.mock('../../src/memory/entity-extractor.js', () => ({
  extractEntitiesForGraph: vi.fn().mockReturnValue([]),
}));
vi.mock('../../src/memory/memory-search.js', () => ({
  formatIncidentEmbeddingInput: vi.fn().mockReturnValue('test'),
}));
vi.mock('../../src/cache/embedder.js', () => ({
  generateEmbedding: vi.fn().mockResolvedValue(null),
}));

// Mock executePlan with controllable behavior
const mockExecutePlan = vi.fn();
vi.mock('../../src/execution/executor.js', () => ({
  executePlan: (...args: unknown[]) => mockExecutePlan(...args),
}));

import { createStreamExecuteRoute } from '../../src/api/routes/stream-execute.js';

// ---- Helper: parse SSE text into events ----
function parseSSEText(text: string): Array<{ event: string; data: unknown }> {
  const events: Array<{ event: string; data: unknown }> = [];
  const lines = text.split('\n');
  let currentEvent = '';
  let currentData = '';

  for (const line of lines) {
    if (line.startsWith('event: ')) {
      currentEvent = line.slice(7).trim();
    } else if (line.startsWith('data: ')) {
      currentData = line.slice(6).trim();
    } else if (line === '' && currentEvent && currentData) {
      try {
        events.push({ event: currentEvent, data: JSON.parse(currentData) });
      } catch {
        events.push({ event: currentEvent, data: currentData });
      }
      currentEvent = '';
      currentData = '';
    }
  }
  return events;
}

// ---- Mock deps factory ----
function createMockDeps() {
  return {
    auditLogger: {
      logSkillSelection: vi.fn(),
      logExecution: vi.fn(),
      logDecision: vi.fn(),
      logCommandValidation: vi.fn(),
      logError: vi.fn(),
    },
    config: {
      defaultBaseUrl: 'http://localhost:11434/v1',
      execution: { commandTimeoutMs: 30000, maxBufferBytes: 1048576 },
      circuitBreaker: { maxRetries: 3, retryDelayMs: 1000 },
      damageBudget: { maxPoints: 10 },
      tokenBudgets: { diagnosis: 2000 },
      locks: { staleTimeoutMs: 600000 },
    },
    sessionId: 'test-session-123',
    sessionDir: '/tmp/test-session',
    store: undefined,
    provider: undefined,
    registry: undefined,
  };
}

describe('POST /stream/execute (SSE streaming execution)', () => {
  let app: express.Express;
  let deps: ReturnType<typeof createMockDeps>;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createMockDeps();
    app = express();
    app.use(express.json());
    app.use('/stream/execute', createStreamExecuteRoute(deps as any));
  });

  it('returns 400 JSON when fixPlan is missing', async () => {
    const res = await request(app)
      .post('/stream/execute')
      .send({ sessionId: 'test', target: 'container-1', adminName: 'admin' })
      .expect(400);

    expect(res.body.error).toContain('fixPlan');
    expect(res.headers['content-type']).toMatch(/json/);
  });

  it('returns 400 JSON when sessionId is missing', async () => {
    const res = await request(app)
      .post('/stream/execute')
      .send({ fixPlan: { summary: 'test', steps: [], complexity: 'simple' }, target: 'container-1', adminName: 'admin' })
      .expect(400);

    expect(res.body.error).toContain('sessionId');
  });

  it('returns Content-Type text/event-stream for valid request', async () => {
    mockExecutePlan.mockImplementation(async (_plan: any, _target: any, executeDeps: any) => {
      return { status: 'completed', stepResults: [] };
    });

    const res = await request(app)
      .post('/stream/execute')
      .send({
        sessionId: 'sess-1',
        fixPlan: {
          summary: 'Fix nginx',
          steps: [
            { command: 'docker logs nginx', description: 'Check logs', rollback: 'echo ok', risk: 'read' },
          ],
          complexity: 'simple',
        },
        target: 'nginx-1',
        adminName: 'admin',
      })
      .expect(200);

    expect(res.headers['content-type']).toMatch(/text\/event-stream/);
  });

  it('streams exec:step events for each step', async () => {
    mockExecutePlan.mockImplementation(async (plan: any, _target: any, executeDeps: any) => {
      // Simulate step execution -- the route should have already emitted initial exec:step pending events
      return {
        status: 'completed',
        stepResults: [
          { stepIndex: 0, status: 'success', retries: 0, damageCost: 0 },
          { stepIndex: 1, status: 'success', retries: 0, damageCost: 1 },
        ],
      };
    });

    const res = await request(app)
      .post('/stream/execute')
      .send({
        sessionId: 'sess-1',
        fixPlan: {
          summary: 'Fix nginx',
          steps: [
            { command: 'docker logs nginx', description: 'Check logs', rollback: 'echo ok', risk: 'read' },
            { command: 'docker restart nginx', description: 'Restart', rollback: 'docker stop nginx', risk: 'write' },
          ],
          complexity: 'simple',
        },
        target: 'nginx-1',
        adminName: 'admin',
      });

    const events = parseSSEText(res.text);
    const stepEvents = events.filter(e => e.event === 'exec:step');

    // Should have initial pending events for each step
    expect(stepEvents.length).toBeGreaterThanOrEqual(2);
  });

  it('streams dpev:complete when execution finishes', async () => {
    mockExecutePlan.mockResolvedValue({
      status: 'completed',
      stepResults: [{ stepIndex: 0, status: 'success', retries: 0, damageCost: 0 }],
    });

    const res = await request(app)
      .post('/stream/execute')
      .send({
        sessionId: 'sess-1',
        fixPlan: {
          summary: 'Fix it',
          steps: [{ command: 'echo test', description: 'Test', rollback: 'echo ok', risk: 'read' }],
          complexity: 'simple',
        },
        target: 'container-1',
        adminName: 'admin',
      });

    const events = parseSSEText(res.text);
    const completeEvents = events.filter(e => e.event === 'dpev:complete');

    expect(completeEvents.length).toBe(1);
    expect((completeEvents[0].data as any).status).toBeDefined();
  });

  it('emits exec:approval for WRITE steps when approval callback is called', async () => {
    let capturedApprovalCallback: ((cmd: string, risk: string) => Promise<{ approved: boolean }>) | null = null;

    mockExecutePlan.mockImplementation(async (plan: any, _target: any, executeDeps: any) => {
      capturedApprovalCallback = executeDeps.requestApproval;

      // Simulate requesting approval for the WRITE step
      // The route's requestApproval will emit exec:approval and register a resolver
      const approvalPromise = executeDeps.requestApproval('docker restart nginx', 'write');

      // Poll until the resolver is registered, then send approval via POST
      const pollAndApprove = async () => {
        for (let i = 0; i < 20; i++) {
          await new Promise(r => setTimeout(r, 50));
          try {
            const res = await request(app)
              .post('/stream/execute/approve')
              .send({ stepIndex: 0, approved: true });
            if (res.status === 200) return;
          } catch { /* keep trying */ }
        }
      };
      pollAndApprove(); // fire and forget

      const approval = await approvalPromise;
      return {
        status: approval.approved ? 'completed' : 'rejected',
        stepResults: [{ stepIndex: 0, status: 'success', retries: 0, damageCost: 1 }],
      };
    });

    const res = await request(app)
      .post('/stream/execute')
      .send({
        sessionId: 'sess-1',
        fixPlan: {
          summary: 'Fix nginx',
          steps: [{ command: 'docker restart nginx', description: 'Restart', rollback: 'docker stop nginx', risk: 'write' }],
          complexity: 'simple',
        },
        target: 'nginx-1',
        adminName: 'admin',
      });

    const events = parseSSEText(res.text);
    const approvalEvents = events.filter(e => e.event === 'exec:approval');

    expect(approvalEvents.length).toBe(1);
    expect((approvalEvents[0].data as any).command).toBe('docker restart nginx');
    expect((approvalEvents[0].data as any).riskLevel).toBe('write');
    expect(capturedApprovalCallback).not.toBeNull();
  });
});

describe('POST /stream/execute/approve', () => {
  let app: express.Express;
  let deps: ReturnType<typeof createMockDeps>;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createMockDeps();
    app = express();
    app.use(express.json());
    app.use('/stream/execute', createStreamExecuteRoute(deps as any));
  });

  it('returns 404 when no pending approval', async () => {
    const res = await request(app)
      .post('/stream/execute/approve')
      .send({ stepIndex: 0, approved: true })
      .expect(404);

    expect(res.body.error).toContain('No pending');
  });
});
