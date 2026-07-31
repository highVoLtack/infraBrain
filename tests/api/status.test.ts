import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Phase 19.3 Plan 02: /status now aggregates from the cache + memory stores.
// Mock them so the route is exercised without a real LanceDB on disk.
const { getCacheStoreMock, getIncidentStoreMock, getEntityStoreMock } = vi.hoisted(() => ({
  getCacheStoreMock: vi.fn(),
  getIncidentStoreMock: vi.fn(),
  getEntityStoreMock: vi.fn(),
}));
vi.mock('../../src/cache/lance-store.js', () => ({ getCacheStore: getCacheStoreMock }));
vi.mock('../../src/memory/incident-store.js', () => ({ getIncidentStore: getIncidentStoreMock }));
vi.mock('../../src/memory/entity-store.js', () => ({ getEntityStore: getEntityStoreMock }));

import { createStatusRoute } from '../../src/api/routes/status.js';
import { WriteThrough } from '../../src/state/store.js';
import { initDatabase } from '../../src/state/db.js';
import { InfraBrainConfigSchema } from '../../src/config/types.js';
import type Database from 'better-sqlite3';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('GET /status', () => {
  let tmpDir: string;
  let db: Database.Database;
  let store: WriteThrough;
  let lockDir: string;
  let app: express.Express;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'infrabrain-test-'));
    const dbPath = join(tmpDir, 'test.db');
    db = initDatabase(dbPath);
    store = new WriteThrough(db);
    lockDir = join(tmpDir, 'locks');
    mkdirSync(lockDir, { recursive: true });

    const config = InfraBrainConfigSchema.parse({});

    app = express();
    app.use(express.json());
    app.use('/status', createStatusRoute({ store, defaultBaseUrl: 'http://localhost:11434/v1', lockDir, config }));
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('returns 200 with all four sections when backend is reachable', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: 'llama3.3:70b' }] }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const res = await request(app).get('/status');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('backend');
    expect(res.body.backend.connected).toBe(true);
    expect(res.body).toHaveProperty('activePlans');
    expect(res.body).toHaveProperty('recentSessions');
    expect(res.body).toHaveProperty('locks');
    expect(Array.isArray(res.body.activePlans)).toBe(true);
    expect(Array.isArray(res.body.recentSessions)).toBe(true);
    expect(Array.isArray(res.body.locks)).toBe(true);
  });

  it('returns backend disconnected when backend is unreachable', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('Connection refused'));
    vi.stubGlobal('fetch', mockFetch);

    const res = await request(app).get('/status');

    expect(res.status).toBe(200);
    expect(res.body.backend.connected).toBe(false);
    expect(res.body.backend.error).toBeDefined();
  });

  it('includes backend response time and model name when connected', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: 'llama3.3:70b' }] }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const res = await request(app).get('/status');

    expect(res.body.backend.connected).toBe(true);
    expect(res.body.backend.modelName).toBe('llama3.3:70b');
    expect(typeof res.body.backend.responseTimeMs).toBe('number');
  });

  it('returns active sessions from store', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('skip'));
    vi.stubGlobal('fetch', mockFetch);

    // Insert an active session
    const now = new Date().toISOString();
    const state = { sessionId: 'test-1', createdAt: now, updatedAt: now, status: 'active' };
    db.prepare('INSERT INTO sessions (id, state, updated_at) VALUES (?, ?, ?)').run(
      'test-1', JSON.stringify(state), now,
    );

    const res = await request(app).get('/status');
    expect(res.body.activePlans).toHaveLength(1);
    expect(res.body.activePlans[0].sessionId).toBe('test-1');
  });
});

// ---------------------------------------------------------------------------
// Phase 19.3 Plan 02 -- live dashboard sections (TERM-UX05, D-13, D-23)
// ---------------------------------------------------------------------------
describe('/status cache/memory/context/models sections (TERM-UX05, D-13, D-23)', () => {
  let tmpDir: string;
  let db: Database.Database;
  let store: WriteThrough;
  let lockDir: string;
  let memDir: string;
  let app: express.Express;

  function buildApp(configOverrides: Record<string, unknown> = {}) {
    const config = InfraBrainConfigSchema.parse({
      cache: { dataDir: join(tmpDir, 'cache') },
      memory: { dataDir: memDir },
      ...configOverrides,
    });
    const a = express();
    a.use(express.json());
    a.use('/status', createStatusRoute({ store, defaultBaseUrl: 'http://localhost:11434/v1', lockDir, config }));
    return a;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    tmpDir = mkdtempSync(join(tmpdir(), 'infrabrain-status-'));
    db = initDatabase(join(tmpDir, 'test.db'));
    store = new WriteThrough(db);
    lockDir = join(tmpDir, 'locks');
    mkdirSync(lockDir, { recursive: true });
    memDir = join(tmpDir, 'memory');
    mkdirSync(memDir, { recursive: true });

    getCacheStoreMock.mockReturnValue({
      init: vi.fn().mockResolvedValue(undefined),
      listAll: vi.fn().mockResolvedValue([]),
    });
    getIncidentStoreMock.mockReturnValue({
      getStats: vi.fn().mockResolvedValue({ totalIncidents: 0, topDomains: [], successRate: 0 }),
    });
    getEntityStoreMock.mockReturnValue({
      listAll: vi.fn().mockResolvedValue([]),
    });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: 'llama3.3:70b' }] }),
    }));

    app = buildApp();
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('keeps the four pre-existing sections intact', async () => {
    const res = await request(app).get('/status');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('backend');
    expect(res.body).toHaveProperty('activePlans');
    expect(res.body).toHaveProperty('recentSessions');
    expect(res.body).toHaveProperty('locks');
  });

  it('returns a cache section with totalEntries 0 when the store is empty', async () => {
    const res = await request(app).get('/status');

    expect(res.body.cache).toBeDefined();
    expect(res.body.cache.totalEntries).toBe(0);
  });

  it('reports cache.hitRate and cache.avgConfidence as null when no entries exist', async () => {
    const res = await request(app).get('/status');

    expect(res.body.cache.hitRate).toBeNull();
    expect(res.body.cache.avgConfidence).toBeNull();
  });

  it('aggregates totalEntries, hitRate and avgConfidence from the cache rows', async () => {
    getCacheStoreMock.mockReturnValue({
      init: vi.fn().mockResolvedValue(undefined),
      listAll: vi.fn().mockResolvedValue([
        { hit_count: 4, success_count: 2, confidence: 0.8 },
        { hit_count: 6, success_count: 4, confidence: 0.6 },
      ]),
    });
    app = buildApp();

    const res = await request(app).get('/status');

    expect(res.body.cache.totalEntries).toBe(2);
    expect(res.body.cache.hitRate).toBeCloseTo(0.6, 10);
    expect(res.body.cache.avgConfidence).toBeCloseTo(0.7, 10);
  });

  it('exposes the v2.0 memory placeholders as literal nulls (D-23)', async () => {
    const res = await request(app).get('/status');

    expect(res.body.memory).toBeDefined();
    expect(res.body.memory.compressionRatio).toBeNull();
    expect(res.body.memory.totalTokensSaved).toBeNull();
    expect(res.body.memory.distilledEntriesCount).toBeNull();
  });

  it('reports memory.incidentCount from IncidentStore.getStats', async () => {
    getIncidentStoreMock.mockReturnValue({
      getStats: vi.fn().mockResolvedValue({ totalIncidents: 7, topDomains: [], successRate: 50 }),
    });
    app = buildApp();

    const res = await request(app).get('/status');

    expect(res.body.memory.incidentCount).toBe(7);
  });

  it('reports memory.entityCount from EntityStore.listAll', async () => {
    getEntityStoreMock.mockReturnValue({
      listAll: vi.fn().mockResolvedValue([{ id: 'a' }, { id: 'b' }, { id: 'c' }]),
    });
    app = buildApp();

    const res = await request(app).get('/status');

    expect(res.body.memory.entityCount).toBe(3);
  });

  it('reports walSize as 0 B when the WAL file does not exist', async () => {
    const res = await request(app).get('/status');

    expect(res.body.memory.walSize).toBe('0 B');
  });

  it('formats a real WAL file size human-readably', async () => {
    writeFileSync(join(memDir, 'memory.wal.jsonl'), 'x'.repeat(2048));
    app = buildApp();

    const res = await request(app).get('/status');

    expect(res.body.memory.walSize).toBe('2.0 KB');
  });

  it('returns a context section with the configured max token window', async () => {
    const res = await request(app).get('/status');

    expect(res.body.context).toBeDefined();
    expect(res.body.context.maxTokens).toBe(32768);
    expect(res.body.context.currentTokens).toBe(0);
  });

  it('honours a non-default contextWindow', async () => {
    app = buildApp({ contextWindow: 131072 });

    const res = await request(app).get('/status');

    expect(res.body.context.maxTokens).toBe(131072);
  });

  it('returns a models map derived from config.modelMap', async () => {
    const res = await request(app).get('/status');

    expect(res.body.models).toBeDefined();
    expect(res.body.models.triage).toBe('infrabrain');
    expect(res.body.models.worker).toBe('qwen2.5-coder:7b');
    expect(res.body.models.default).toBe('infrabrain');
  });

  it('unwraps object-form modelMap entries to their model id', async () => {
    app = buildApp({
      modelMap: {
        default: 'infrabrain',
        strategic: { model: 'gemini-2.5-pro', baseUrl: 'https://example.test/v1' },
        forensic: 'deepseek-r1:32b',
        worker: 'qwen2.5-coder:7b',
        vision: 'llama3.2-vision',
        triage: 'infrabrain',
        embedding: 'bge-m3',
      },
    });

    const res = await request(app).get('/status');

    expect(res.body.models.strategic).toBe('gemini-2.5-pro');
  });

  it('returns 200 with safe cache defaults when the cache store throws', async () => {
    getCacheStoreMock.mockImplementation(() => { throw new Error('LanceDB unreachable'); });
    app = buildApp();

    const res = await request(app).get('/status');

    expect(res.status).toBe(200);
    expect(res.body.cache.totalEntries).toBe(0);
    expect(res.body.cache.hitRate).toBeNull();
  });

  it('returns 200 with safe memory defaults when the incident store throws', async () => {
    getIncidentStoreMock.mockImplementation(() => { throw new Error('memory dir gone'); });
    app = buildApp();

    const res = await request(app).get('/status');

    expect(res.status).toBe(200);
    expect(res.body.memory.incidentCount).toBe(0);
    expect(res.body.memory.entityCount).toBe(0);
    expect(res.body.memory.walSize).toBe('0 B');
  });

  it('returns 200 when IncidentStore.getStats resolves null', async () => {
    getIncidentStoreMock.mockReturnValue({
      getStats: vi.fn().mockResolvedValue(null),
    });
    app = buildApp();

    const res = await request(app).get('/status');

    expect(res.status).toBe(200);
    expect(res.body.memory.incidentCount).toBe(0);
  });
});
