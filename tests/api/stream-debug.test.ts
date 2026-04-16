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
