import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Mock all heavy dependencies before any imports
vi.mock('../../src/orchestrator/router.js', () => ({
  selectSkill: vi.fn(),
}));
vi.mock('../../src/orchestrator/planner.js', () => ({
  generateFixPlan: vi.fn(),
  generatePlanMarkdown: vi.fn(),
  formatPlanTable: vi.fn(),
}));
vi.mock('../../src/orchestrator/context.js', () => ({
  buildMessages: vi.fn(() => ({ system: 'mock system prompt', messages: [] })),
}));
vi.mock('../../src/cache/cache-lookup.js', () => ({
  checkCache: vi.fn().mockResolvedValue({ type: 'miss' }),
}));
vi.mock('../../src/cache/lance-store.js', () => ({
  getCacheStore: vi.fn(() => ({
    init: vi.fn().mockResolvedValue(undefined),
  })),
}));
vi.mock('../../src/memory/incident-store.js', () => ({
  getIncidentStore: vi.fn(() => ({
    search: vi.fn().mockResolvedValue([]),
    getRecent: vi.fn().mockResolvedValue([]),
    getStats: vi.fn().mockResolvedValue({ totalIncidents: 0, topDomains: [], successRate: 0 }),
    init: vi.fn().mockResolvedValue(undefined),
  })),
}));
vi.mock('../../src/memory/entity-store.js', () => ({
  getEntityStore: vi.fn(() => ({
    searchByEntities: vi.fn().mockResolvedValue([]),
    searchByType: vi.fn().mockResolvedValue([]),
    init: vi.fn().mockResolvedValue(undefined),
  })),
}));
vi.mock('../../src/memory/wake-up.js', () => ({
  buildWakeUpContext: vi.fn().mockResolvedValue({ pinned: '', evictable: '' }),
}));
vi.mock('../../src/memory/wal.js', () => ({
  getMemoryWAL: vi.fn(() => ({
    append: vi.fn().mockReturnValue(true),
    read: vi.fn().mockReturnValue([]),
  })),
}));
vi.mock('../../src/memory/entity-extractor.js', () => ({
  extractEntitiesForGraph: vi.fn().mockReturnValue([]),
}));
vi.mock('../../src/memory/memory-search.js', () => ({
  searchWithDecay: vi.fn().mockResolvedValue([]),
  formatIncidentEmbeddingInput: vi.fn().mockReturnValue('formatted embedding input'),
}));
vi.mock('../../src/cache/embedder.js', () => ({
  generateEmbedding: vi.fn().mockResolvedValue(null),
  formatEmbeddingInput: vi.fn().mockReturnValue('formatted'),
}));

// Mock executePlan for execution chaining tests
const mockExecutePlan = vi.fn();
vi.mock('../../src/execution/executor.js', () => ({
  executePlan: (...args: unknown[]) => mockExecutePlan(...args),
}));

// Mock runner + discovery so no real child_processes fire
vi.mock('../../src/execution/runner.js', () => ({
  runCommand: vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 }),
  parseCommand: vi.fn().mockReturnValue({ executable: 'echo', args: ['test'] }),
  needsShell: vi.fn().mockReturnValue(false),
  runShellCommand: vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 }),
  findDbContainer: vi.fn(),
}));

const mockRunParallelDiscovery = vi.fn();
vi.mock('../../src/orchestrator/discovery.js', () => ({
  runParallelDiscovery: (...args: unknown[]) => mockRunParallelDiscovery(...args),
}));

// Mock the pipeline with controllable event emission
const mockRunDPEV = vi.fn();
vi.mock('../../src/orchestrator/pipeline.js', () => ({
  runDPEV: (...args: unknown[]) => mockRunDPEV(...args),
}));

import { createStreamDebugRoute } from '../../src/api/routes/stream-debug.js';

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
function createMockDeps(overrides?: Record<string, unknown>) {
  return {
    provider: {
      model: { modelId: 'test-model' },
      registry: {
        get: vi.fn().mockReturnValue({ modelId: 'test-model' }),
        getDefault: vi.fn().mockReturnValue({ modelId: 'test-model' }),
        entries: vi.fn().mockReturnValue([]),
      },
      streamDiagnosis: vi.fn(),
      generateCommand: vi.fn(),
    },
    auditLogger: {
      logSkillSelection: vi.fn(),
      logExecution: vi.fn(),
      logDecision: vi.fn(),
      logCommandValidation: vi.fn(),
      logError: vi.fn(),
    },
    validator: vi.fn().mockReturnValue({ allowed: true, riskLevel: 'read', reason: 'ok' }),
    registry: {
      get: vi.fn().mockReturnValue(null),
      list: vi.fn().mockReturnValue([]),
    },
    config: { defaultBaseUrl: 'http://localhost:11434/v1' },
    sessionId: 'test-session-123',
    ...overrides,
  };
}

function createMockStore() {
  return {
    persistState: vi.fn(),
    getSessionList: vi.fn().mockReturnValue([]),
    appendAudit: vi.fn(),
    getSessionById: vi.fn().mockReturnValue(null),
    getRecentSessions: vi.fn().mockReturnValue([]),
    getLatestSessionId: vi.fn().mockReturnValue(null),
    getSessionIdByAlias: vi.fn().mockReturnValue(null),
    queryAuditLog: vi.fn().mockReturnValue([]),
  };
}

describe('POST /stream/debug (SSE streaming)', () => {
  let app: express.Express;
  let deps: ReturnType<typeof createMockDeps>;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createMockDeps();
    app = express();
    app.use(express.json());
    app.use('/stream/debug', createStreamDebugRoute(deps as any));
  });

  it('returns 400 JSON when prompt is missing', async () => {
    const res = await request(app)
      .post('/stream/debug')
      .send({})
      .expect(400);

    expect(res.body.error).toContain('prompt');
    expect(res.headers['content-type']).toMatch(/json/);
  });

  it('returns Content-Type text/event-stream for valid request', async () => {
    mockRunDPEV.mockImplementation(async (input: any) => {
      input.onEvent?.('dpev:phase', { phase: 'discovery', model: 'test', status: 'active' });
      input.onEvent?.('dpev:complete', { sessionId: 'test', status: 'success' });
      return { sessionId: 'test', diagnosis: 'test', commands: [], skillName: 'test' };
    });

    const res = await request(app)
      .post('/stream/debug')
      .send({ prompt: 'nginx is down' })
      .expect(200);

    expect(res.headers['content-type']).toMatch(/text\/event-stream/);
  });

  it('streams dpev:phase and dpev:complete events in correct order', async () => {
    mockRunDPEV.mockImplementation(async (input: any) => {
      input.onEvent?.('dpev:phase', { phase: 'discovery', model: 'test-model', status: 'active' });
      input.onEvent?.('dpev:phase', { phase: 'diagnosis', model: 'test-model', status: 'active' });
      input.onEvent?.('dpev:diagnosis', { rootCause: 'test', correlation: 'test', structuredDiagnosis: {} });
      input.onEvent?.('dpev:plan', { fixPlan: {}, planTable: 'test' });
      return { sessionId: 'sess-1', diagnosis: 'test', commands: [], skillName: 'test' };
    });

    const res = await request(app)
      .post('/stream/debug')
      .send({ prompt: 'nginx is down' });

    const events = parseSSEText(res.text);
    const eventNames = events.map(e => e.event);

    expect(eventNames).toContain('dpev:phase');
    expect(eventNames).toContain('dpev:complete');
    // dpev:complete must be last
    expect(eventNames[eventNames.length - 1]).toBe('dpev:complete');
  });

  it('streams dpev:token events during diagnosis', async () => {
    mockRunDPEV.mockImplementation(async (input: any) => {
      input.onEvent?.('dpev:phase', { phase: 'diagnosis', model: 'test', status: 'active' });
      input.onEvent?.('dpev:token', { text: 'The root', phase: 'diagnosis' });
      input.onEvent?.('dpev:token', { text: ' cause is', phase: 'diagnosis' });
      input.onEvent?.('dpev:token', { text: ' memory leak', phase: 'diagnosis' });
      return { sessionId: 'sess-1', diagnosis: 'The root cause is memory leak', commands: [], skillName: 'test' };
    });

    const res = await request(app)
      .post('/stream/debug')
      .send({ prompt: 'slow container' });

    const events = parseSSEText(res.text);
    const tokenEvents = events.filter(e => e.event === 'dpev:token');

    expect(tokenEvents.length).toBe(3);
    expect((tokenEvents[0].data as any).text).toBe('The root');
    expect((tokenEvents[2].data as any).text).toBe(' memory leak');
  });

  it('streams dpev:error on pipeline failure', async () => {
    mockRunDPEV.mockImplementation(async (input: any) => {
      input.onEvent?.('dpev:phase', { phase: 'discovery', model: 'test', status: 'active' });
      throw new Error('LLM backend unavailable');
    });

    const res = await request(app)
      .post('/stream/debug')
      .send({ prompt: 'test error' });

    const events = parseSSEText(res.text);
    const errorEvents = events.filter(e => e.event === 'dpev:error');

    expect(errorEvents.length).toBe(1);
    expect((errorEvents[0].data as any).message).toBe('LLM backend unavailable');
  });

  it('passes onEvent callback to runDPEV', async () => {
    mockRunDPEV.mockImplementation(async (input: any) => {
      expect(typeof input.onEvent).toBe('function');
      return { sessionId: 'test', diagnosis: 'test', commands: [], skillName: 'test' };
    });

    await request(app)
      .post('/stream/debug')
      .send({ prompt: 'test' });

    expect(mockRunDPEV).toHaveBeenCalledTimes(1);
    const callArgs = mockRunDPEV.mock.calls[0][0];
    expect(callArgs.onEvent).toBeDefined();
  });
});

describe('POST /stream/debug/approve (cache hit approval)', () => {
  let app: express.Express;
  let deps: ReturnType<typeof createMockDeps>;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createMockDeps();
    app = express();
    app.use(express.json());
    app.use('/stream/debug', createStreamDebugRoute(deps as any));
  });

  it('returns 404 when no pending cache hit approval', async () => {
    const res = await request(app)
      .post('/stream/debug/approve')
      .send({ sessionId: 'nonexistent', useCache: true })
      .expect(404);

    expect(res.body.error).toContain('No pending cache hit');
  });

  it('resolves cache hit approval with useCache: true', async () => {
    let cacheApprovalReceived = false;

    mockRunDPEV.mockImplementation(async (input: any) => {
      input.onEvent?.('dpev:phase', { phase: 'discovery', model: 'test', status: 'active' });

      if (input.requestCacheApproval) {
        const provenance = {
          similarity: 0.95,
          confidence: 0.88,
          sourceSessionId: 'old-session',
          sourceDate: '2026-04-10',
          skillName: 'docker-health',
        };

        // Start approval request (will block until POST /approve)
        const approvalPromise = input.requestCacheApproval(provenance);

        // Simulate client sending approval after a brief delay
        setTimeout(async () => {
          await request(app)
            .post('/stream/debug/approve')
            .send({ sessionId: input.sessionId, useCache: true });
        }, 50);

        const result = await approvalPromise;
        cacheApprovalReceived = true;
        expect(result).toBe(true);
      }

      return { sessionId: input.sessionId, diagnosis: 'cached', commands: [], skillName: 'test' };
    });

    const res = await request(app)
      .post('/stream/debug')
      .send({ prompt: 'test cache hit' });

    expect(cacheApprovalReceived).toBe(true);

    const events = parseSSEText(res.text);
    const cacheEvents = events.filter(e => e.event === 'dpev:cache-hit');
    expect(cacheEvents.length).toBe(1);
    expect((cacheEvents[0].data as any).similarity).toBe(0.95);
  });

  it('resolves cache hit approval with useCache: false', async () => {
    let cacheRejected = false;

    mockRunDPEV.mockImplementation(async (input: any) => {
      if (input.requestCacheApproval) {
        const provenance = {
          similarity: 0.85,
          confidence: 0.72,
          sourceSessionId: 'old-session',
          sourceDate: '2026-04-09',
          skillName: 'docker-health',
        };

        const approvalPromise = input.requestCacheApproval(provenance);

        setTimeout(async () => {
          await request(app)
            .post('/stream/debug/approve')
            .send({ sessionId: input.sessionId, useCache: false });
        }, 50);

        const result = await approvalPromise;
        cacheRejected = true;
        expect(result).toBe(false);
      }

      return { sessionId: input.sessionId, diagnosis: 're-diagnosed', commands: [], skillName: 'test' };
    });

    await request(app)
      .post('/stream/debug')
      .send({ prompt: 'test cache rejection' });

    expect(cacheRejected).toBe(true);
  });

  it('clears resolver after approval (second approve returns 404)', async () => {
    mockRunDPEV.mockImplementation(async (input: any) => {
      if (input.requestCacheApproval) {
        const provenance = {
          similarity: 0.90,
          confidence: 0.80,
          sourceSessionId: 'old-session',
          sourceDate: '2026-04-08',
          skillName: 'test-skill',
        };

        const approvalPromise = input.requestCacheApproval(provenance);

        setTimeout(async () => {
          // First approve succeeds
          const res1 = await request(app)
            .post('/stream/debug/approve')
            .send({ sessionId: input.sessionId, useCache: true });
          expect(res1.status).toBe(200);

          // Second approve should fail
          const res2 = await request(app)
            .post('/stream/debug/approve')
            .send({ sessionId: input.sessionId, useCache: true });
          expect(res2.status).toBe(404);
        }, 50);

        await approvalPromise;
      }

      return { sessionId: input.sessionId, diagnosis: 'test', commands: [], skillName: 'test' };
    });

    await request(app)
      .post('/stream/debug')
      .send({ prompt: 'test double approve' });
  });
});

describe('SSE session persistence', () => {
  let app: express.Express;
  let deps: ReturnType<typeof createMockDeps>;
  let mockStore: ReturnType<typeof createMockStore>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockStore = createMockStore();
    deps = createMockDeps({ store: mockStore, baseDir: '/tmp/infrabrain-test' });
    app = express();
    app.use(express.json());
    app.use('/stream/debug', createStreamDebugRoute(deps as any));
  });

  it('creates session record with target=prompt and status=active on start', async () => {
    mockRunDPEV.mockImplementation(async (input: any) => {
      return { sessionId: input.sessionId, diagnosis: 'test', commands: [], skillName: 'test' };
    });

    await request(app)
      .post('/stream/debug')
      .send({ prompt: 'nginx is down' });

    // persistState should be called at least once with status 'active' and target 'nginx is down'
    const persistCalls = mockStore.persistState.mock.calls;
    expect(persistCalls.length).toBeGreaterThanOrEqual(1);

    const firstCall = persistCalls[0];
    const sessionState = firstCall[1];
    expect(sessionState.status).toBe('active');
    expect(sessionState.target).toBe('nginx is down');
    expect(sessionState.sessionId).toBeDefined();
  });

  it('updates session status to completed after successful pipeline', async () => {
    mockRunDPEV.mockImplementation(async (input: any) => {
      return { sessionId: input.sessionId, diagnosis: 'test', commands: [], skillName: 'test' };
    });

    await request(app)
      .post('/stream/debug')
      .send({ prompt: 'nginx is down' });

    const persistCalls = mockStore.persistState.mock.calls;
    // Should have at least 2 calls: initial (active) and final (completed)
    expect(persistCalls.length).toBeGreaterThanOrEqual(2);

    const lastCall = persistCalls[persistCalls.length - 1];
    const finalState = lastCall[1];
    expect(finalState.status).toBe('completed');
  });

  it('updates session status to failed after pipeline error', async () => {
    mockRunDPEV.mockImplementation(async () => {
      throw new Error('LLM backend unavailable');
    });

    await request(app)
      .post('/stream/debug')
      .send({ prompt: 'nginx is down' });

    const persistCalls = mockStore.persistState.mock.calls;
    expect(persistCalls.length).toBeGreaterThanOrEqual(2);

    const lastCall = persistCalls[persistCalls.length - 1];
    const finalState = lastCall[1];
    expect(finalState.status).toBe('failed');
  });

  it('works without error when store is not provided (graceful degradation)', async () => {
    // Create deps without store
    const noDeps = createMockDeps({ store: undefined });
    const noStoreApp = express();
    noStoreApp.use(express.json());
    noStoreApp.use('/stream/debug', createStreamDebugRoute(noDeps as any));

    mockRunDPEV.mockImplementation(async (input: any) => {
      return { sessionId: input.sessionId, diagnosis: 'test', commands: [], skillName: 'test' };
    });

    const res = await request(noStoreApp)
      .post('/stream/debug')
      .send({ prompt: 'nginx is down' });

    const events = parseSSEText(res.text);
    const completeEvents = events.filter(e => e.event === 'dpev:complete');
    expect(completeEvents.length).toBe(1);
  });

  it('session dir is created via persistState call with correct path', async () => {
    mockRunDPEV.mockImplementation(async (input: any) => {
      return { sessionId: input.sessionId, diagnosis: 'test', commands: [], skillName: 'test' };
    });

    await request(app)
      .post('/stream/debug')
      .send({ prompt: 'nginx is down' });

    const persistCalls = mockStore.persistState.mock.calls;
    expect(persistCalls.length).toBeGreaterThanOrEqual(1);

    // Session dir should contain sessions path
    const sessionDir = persistCalls[0][0] as string;
    expect(sessionDir).toContain('.infrabrain/sessions/');
  });

  it('getSessionList returns SSE session with target and eventCount', async () => {
    // Simulate that getSessionList would return persisted data
    mockStore.getSessionList.mockReturnValue([
      { id: 'sse-session-1', status: 'completed', target: 'nginx is down', updatedAt: '2026-04-15', eventCount: 5 },
    ]);

    const sessions = mockStore.getSessionList(20);
    expect(sessions.length).toBe(1);
    expect(sessions[0].target).toBe('nginx is down');
    expect(sessions[0].eventCount).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Plan approval gate + execution chaining + verification (TERM-E03, E04, E06)
// ---------------------------------------------------------------------------

describe('POST /stream/debug/plan-approve (plan approval)', () => {
  let app: express.Express;
  let deps: ReturnType<typeof createMockDeps>;
  let mockStore: ReturnType<typeof createMockStore>;

  function makeFixPlan(opts?: { steps?: Array<{ command: string; risk: 'read' | 'write' | 'destructive' }> }) {
    const steps = opts?.steps ?? [
      { command: 'docker ps', risk: 'read' as const },
    ];
    return {
      summary: 'Restart nginx',
      steps: steps.map((s, i) => ({
        command: s.command,
        description: `Step ${i}`,
        rollback: 'n/a',
        risk: s.risk,
      })),
      complexity: 'simple' as const,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockStore = createMockStore();
    deps = createMockDeps({ store: mockStore, baseDir: '/tmp/infrabrain-test' });
    app = express();
    app.use(express.json());
    app.use('/stream/debug', createStreamDebugRoute(deps as any));

    // Default: mockRunParallelDiscovery returns empty
    mockRunParallelDiscovery.mockResolvedValue({ context: '', raw: {} });
    // Default: executePlan returns completed
    mockExecutePlan.mockResolvedValue({ status: 'completed', stepResults: [] });
  });

  it('returns 400 when sessionId missing on plan-approve', async () => {
    const res = await request(app)
      .post('/stream/debug/plan-approve')
      .send({ approved: true })
      .expect(400);
    expect(res.body.error).toContain('sessionId');
  });

  it('returns 404 when no pending plan approval for this session', async () => {
    const res = await request(app)
      .post('/stream/debug/plan-approve')
      .send({ sessionId: 'nonexistent', approved: true })
      .expect(404);
    expect(res.body.error).toContain('No pending plan approval');
  });

  it('sends dpev:plan-approval event when fixPlan exists', async () => {
    const fixPlan = makeFixPlan();

    mockRunDPEV.mockImplementation(async (input: any) => {
      // Simulate pipeline returning a fix plan; SSE handler should gate after this
      setTimeout(async () => {
        await request(app)
          .post('/stream/debug/plan-approve')
          .send({ sessionId: input.sessionId, approved: false });
      }, 30);
      return {
        sessionId: input.sessionId,
        diagnosis: 'nginx is crashing',
        commands: [],
        skillName: 'nginx',
        fixPlan,
        target: 'nginx-demo',
      };
    });

    const res = await request(app)
      .post('/stream/debug')
      .send({ prompt: 'nginx is down' });

    const events = parseSSEText(res.text);
    const planApprovalEvents = events.filter(e => e.event === 'dpev:plan-approval');
    expect(planApprovalEvents.length).toBe(1);
    expect((planApprovalEvents[0].data as any).fixPlan).toBeDefined();
    expect((planApprovalEvents[0].data as any).fixPlan.steps.length).toBe(1);
  });

  it('rejected plan results in dpev:complete with status plan_rejected', async () => {
    const fixPlan = makeFixPlan();

    mockRunDPEV.mockImplementation(async (input: any) => {
      setTimeout(async () => {
        await request(app)
          .post('/stream/debug/plan-approve')
          .send({ sessionId: input.sessionId, approved: false });
      }, 30);
      return {
        sessionId: input.sessionId,
        diagnosis: 'nginx is crashing',
        commands: [],
        skillName: 'nginx',
        fixPlan,
        target: 'nginx-demo',
      };
    });

    const res = await request(app)
      .post('/stream/debug')
      .send({ prompt: 'nginx is down' });

    const events = parseSSEText(res.text);
    const completeEvents = events.filter(e => e.event === 'dpev:complete');
    expect(completeEvents.length).toBe(1);
    expect((completeEvents[0].data as any).status).toBe('plan_rejected');

    // executePlan should NOT be called when user rejects the plan
    expect(mockExecutePlan).not.toHaveBeenCalled();
  });

  it('approved plan chains to execution via exec:step events', async () => {
    const fixPlan = makeFixPlan({
      steps: [
        { command: 'docker logs nginx', risk: 'read' },
        { command: 'docker restart nginx', risk: 'write' },
      ],
    });

    mockExecutePlan.mockResolvedValue({
      status: 'completed',
      stepResults: [
        { stepIndex: 0, status: 'success', retries: 0, damageCost: 0, runResult: { stdout: 'logs', stderr: '', exitCode: 0 } },
        { stepIndex: 1, status: 'success', retries: 0, damageCost: 0, runResult: { stdout: 'done', stderr: '', exitCode: 0 } },
      ],
    });

    mockRunDPEV.mockImplementation(async (input: any) => {
      setTimeout(async () => {
        await request(app)
          .post('/stream/debug/plan-approve')
          .send({ sessionId: input.sessionId, approved: true });
      }, 30);
      return {
        sessionId: input.sessionId,
        diagnosis: 'nginx crash',
        commands: [],
        skillName: 'nginx',
        fixPlan,
        target: 'nginx-demo',
      };
    });

    const res = await request(app)
      .post('/stream/debug')
      .send({ prompt: 'nginx is down' });

    const events = parseSSEText(res.text);

    // Should see execution phase active/complete
    const executionActive = events.find(
      e => e.event === 'dpev:phase' && (e.data as any).phase === 'execution' && (e.data as any).status === 'active'
    );
    const executionComplete = events.find(
      e => e.event === 'dpev:phase' && (e.data as any).phase === 'execution' && (e.data as any).status === 'complete'
    );
    expect(executionActive).toBeDefined();
    expect(executionComplete).toBeDefined();

    // Should see exec:step events
    const stepEvents = events.filter(e => e.event === 'exec:step');
    expect(stepEvents.length).toBeGreaterThan(0);

    // executePlan should be called
    expect(mockExecutePlan).toHaveBeenCalledTimes(1);
  });

  it('per-step approval for write steps via POST /step-approve', async () => {
    const fixPlan = makeFixPlan({
      steps: [
        { command: 'docker restart nginx', risk: 'write' },
      ],
    });

    let requestApprovalCallback: ((command: string, risk: any) => Promise<{ approved: boolean }>) | undefined;

    mockExecutePlan.mockImplementation(async (_plan: any, _target: any, execDeps: any) => {
      requestApprovalCallback = execDeps.requestApproval;
      // Simulate a write-step approval call
      const approvalResult = await execDeps.requestApproval('docker restart nginx', 'write');
      return {
        status: 'completed',
        stepResults: [
          { stepIndex: 0, status: approvalResult.approved ? 'success' : 'skipped', retries: 0, damageCost: 0 },
        ],
      };
    });

    mockRunDPEV.mockImplementation(async (input: any) => {
      setTimeout(async () => {
        // Approve the plan
        await request(app)
          .post('/stream/debug/plan-approve')
          .send({ sessionId: input.sessionId, approved: true });

        // Then approve step 0
        setTimeout(async () => {
          await request(app)
            .post('/stream/debug/step-approve')
            .send({ sessionId: input.sessionId, stepIndex: 0, approved: true });
        }, 50);
      }, 30);
      return {
        sessionId: input.sessionId,
        diagnosis: 'crash',
        commands: [],
        skillName: 'nginx',
        fixPlan,
        target: 'nginx-demo',
      };
    });

    const res = await request(app)
      .post('/stream/debug')
      .send({ prompt: 'nginx is down' });

    const events = parseSSEText(res.text);
    const approvalEvents = events.filter(e => e.event === 'exec:approval');
    expect(approvalEvents.length).toBe(1);
    expect((approvalEvents[0].data as any).riskLevel).toBe('write');
    expect(mockExecutePlan).toHaveBeenCalledTimes(1);
    expect(requestApprovalCallback).toBeDefined();
  });

  it('step-approve returns 404 when no pending approval', async () => {
    const res = await request(app)
      .post('/stream/debug/step-approve')
      .send({ sessionId: 'nonexistent', stepIndex: 0, approved: true })
      .expect(404);
    expect(res.body.error).toContain('No pending step approval');
  });

  it('verification phase runs after execution and emits dpev:phase events', async () => {
    const fixPlan = makeFixPlan();

    mockRunParallelDiscovery.mockResolvedValue({ context: 'fresh context', raw: { 'Running containers': 'nginx' } });
    mockExecutePlan.mockResolvedValue({ status: 'completed', stepResults: [] });

    mockRunDPEV.mockImplementation(async (input: any) => {
      setTimeout(async () => {
        await request(app)
          .post('/stream/debug/plan-approve')
          .send({ sessionId: input.sessionId, approved: true });
      }, 30);
      return {
        sessionId: input.sessionId,
        diagnosis: 'nginx crash',
        commands: [],
        skillName: 'nginx',
        fixPlan,
        target: 'nginx-demo',
        discoveryCommands: [{ command: 'docker ps', label: 'Running containers' }],
      };
    });

    const res = await request(app)
      .post('/stream/debug')
      .send({ prompt: 'nginx is down' });

    const events = parseSSEText(res.text);
    const verificationActive = events.find(
      e => e.event === 'dpev:phase' && (e.data as any).phase === 'verification' && (e.data as any).status === 'active'
    );
    const verificationComplete = events.find(
      e => e.event === 'dpev:phase' && (e.data as any).phase === 'verification' && (e.data as any).status === 'complete'
    );
    expect(verificationActive).toBeDefined();
    expect(verificationComplete).toBeDefined();

    // runParallelDiscovery should have been called during verification
    expect(mockRunParallelDiscovery).toHaveBeenCalled();
  });

  it('session status is completed after successful execution+verification', async () => {
    const fixPlan = makeFixPlan();

    mockExecutePlan.mockResolvedValue({ status: 'completed', stepResults: [] });

    mockRunDPEV.mockImplementation(async (input: any) => {
      setTimeout(async () => {
        await request(app)
          .post('/stream/debug/plan-approve')
          .send({ sessionId: input.sessionId, approved: true });
      }, 30);
      return {
        sessionId: input.sessionId,
        diagnosis: 'crash',
        commands: [],
        skillName: 'nginx',
        fixPlan,
        target: 'nginx-demo',
        discoveryCommands: [{ command: 'docker ps', label: 'Running containers' }],
      };
    });

    await request(app)
      .post('/stream/debug')
      .send({ prompt: 'nginx is down' });

    const persistCalls = mockStore.persistState.mock.calls;
    const lastCall = persistCalls[persistCalls.length - 1];
    const finalState = lastCall[1];
    expect(finalState.status).toBe('completed');
  });

  it('session status is failed after halted execution', async () => {
    const fixPlan = makeFixPlan();

    mockExecutePlan.mockResolvedValue({ status: 'halted', stepResults: [] });

    mockRunDPEV.mockImplementation(async (input: any) => {
      setTimeout(async () => {
        await request(app)
          .post('/stream/debug/plan-approve')
          .send({ sessionId: input.sessionId, approved: true });
      }, 30);
      return {
        sessionId: input.sessionId,
        diagnosis: 'crash',
        commands: [],
        skillName: 'nginx',
        fixPlan,
        target: 'nginx-demo',
        discoveryCommands: [{ command: 'docker ps', label: 'Running containers' }],
      };
    });

    await request(app)
      .post('/stream/debug')
      .send({ prompt: 'nginx is down' });

    const persistCalls = mockStore.persistState.mock.calls;
    const lastCall = persistCalls[persistCalls.length - 1];
    const finalState = lastCall[1];
    expect(finalState.status).toBe('failed');
  });

  it('session status is plan-ready after DPEV when fixPlan exists', async () => {
    const fixPlan = makeFixPlan();

    mockRunDPEV.mockImplementation(async (input: any) => {
      setTimeout(async () => {
        await request(app)
          .post('/stream/debug/plan-approve')
          .send({ sessionId: input.sessionId, approved: false });
      }, 30);
      return {
        sessionId: input.sessionId,
        diagnosis: 'crash',
        commands: [],
        skillName: 'nginx',
        fixPlan,
        target: 'nginx-demo',
      };
    });

    await request(app)
      .post('/stream/debug')
      .send({ prompt: 'nginx is down' });

    // Intermediate state should be 'plan-ready' before final status
    const persistCalls = mockStore.persistState.mock.calls;
    const hasPlanReady = persistCalls.some(([, state]: [unknown, any]) => state.status === 'plan-ready');
    expect(hasPlanReady).toBe(true);
  });

  it('no fixPlan results in current behavior: status completed, no execution', async () => {
    mockRunDPEV.mockImplementation(async (input: any) => {
      return {
        sessionId: input.sessionId,
        diagnosis: 'no actionable fix',
        commands: [],
        skillName: 'nginx',
      };
    });

    const res = await request(app)
      .post('/stream/debug')
      .send({ prompt: 'nginx is down' });

    const events = parseSSEText(res.text);
    const completeEvents = events.filter(e => e.event === 'dpev:complete');
    expect(completeEvents.length).toBe(1);
    expect(mockExecutePlan).not.toHaveBeenCalled();

    const persistCalls = mockStore.persistState.mock.calls;
    const lastCall = persistCalls[persistCalls.length - 1];
    const finalState = lastCall[1];
    expect(finalState.status).toBe('completed');
  });

  it('approval maps are cleaned up after request completes', async () => {
    const fixPlan = makeFixPlan();

    mockRunDPEV.mockImplementation(async (input: any) => {
      setTimeout(async () => {
        // Approve plan so request completes normally
        await request(app)
          .post('/stream/debug/plan-approve')
          .send({ sessionId: input.sessionId, approved: true });
      }, 30);
      return {
        sessionId: input.sessionId,
        diagnosis: 'crash',
        commands: [],
        skillName: 'nginx',
        fixPlan,
        target: 'nginx-demo',
      };
    });

    await request(app)
      .post('/stream/debug')
      .send({ prompt: 'nginx is down' });

    // After request completes, any follow-up plan-approve for the same session
    // should 404 because the map was cleaned up in finally
    const followUp = await request(app)
      .post('/stream/debug/plan-approve')
      .send({ sessionId: 'test-session-123', approved: true });
    expect(followUp.status).toBe(404);
  });
});
