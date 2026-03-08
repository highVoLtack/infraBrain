import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createStatusRoute } from '../../src/api/routes/status.js';
import { WriteThrough } from '../../src/state/store.js';
import { initDatabase } from '../../src/state/db.js';
import { InfraBrainConfigSchema } from '../../src/config/types.js';
import type Database from 'better-sqlite3';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
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
    app.use('/status', createStatusRoute({ store, ollamaBaseUrl: 'http://localhost:11434', lockDir, config }));
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('returns 200 with all four sections when Ollama is reachable', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ models: [{ name: 'llama3.3:70b' }] }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const res = await request(app).get('/status');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('ollama');
    expect(res.body.ollama.connected).toBe(true);
    expect(res.body).toHaveProperty('activePlans');
    expect(res.body).toHaveProperty('recentSessions');
    expect(res.body).toHaveProperty('locks');
    expect(Array.isArray(res.body.activePlans)).toBe(true);
    expect(Array.isArray(res.body.recentSessions)).toBe(true);
    expect(Array.isArray(res.body.locks)).toBe(true);
  });

  it('returns ollama disconnected when Ollama is unreachable', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('Connection refused'));
    vi.stubGlobal('fetch', mockFetch);

    const res = await request(app).get('/status');

    expect(res.status).toBe(200);
    expect(res.body.ollama.connected).toBe(false);
    expect(res.body.ollama.error).toBeDefined();
  });

  it('includes Ollama response time and model name when connected', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ models: [{ name: 'llama3.3:70b' }] }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const res = await request(app).get('/status');

    expect(res.body.ollama.connected).toBe(true);
    expect(res.body.ollama.modelName).toBe('llama3.3:70b');
    expect(typeof res.body.ollama.responseTimeMs).toBe('number');
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
