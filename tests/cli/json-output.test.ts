import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { envelope, errorEnvelope } from '../../src/cli/json-envelope.js';
import { WriteThrough } from '../../src/state/store.js';
import { initDatabase } from '../../src/state/db.js';
import type { SessionState } from '../../src/state/types.js';
import type Database from 'better-sqlite3';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('JsonEnvelope helpers', () => {
  it('envelope() produces correct shape', () => {
    const result = envelope('status', { foo: 1 });
    expect(result).toEqual({
      ok: true,
      command: 'status',
      data: { foo: 1 },
      error: null,
    });
  });

  it('errorEnvelope() produces correct shape', () => {
    const result = errorEnvelope('status', 'fail');
    expect(result).toEqual({
      ok: false,
      command: 'status',
      data: null,
      error: 'fail',
    });
  });

  it('envelope() preserves generic data type', () => {
    const result = envelope('test', { count: 42, items: ['a', 'b'] });
    expect(result.ok).toBe(true);
    expect(result.data.count).toBe(42);
    expect(result.data.items).toEqual(['a', 'b']);
    expect(result.error).toBeNull();
  });
});

describe('WriteThrough session queries', () => {
  let tmpDir: string;
  let db: Database.Database;
  let store: WriteThrough;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'infrabrain-test-'));
    const dbPath = join(tmpDir, 'test.db');
    db = initDatabase(dbPath);
    store = new WriteThrough(db);
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function insertSession(id: string, status: 'active' | 'completed' | 'failed', updatedAt: string): void {
    const sessionDir = join(tmpDir, 'sessions', id);
    mkdirSync(sessionDir, { recursive: true });
    const state: SessionState = {
      sessionId: id,
      createdAt: updatedAt,
      updatedAt,
      status,
    };
    writeFileSync(join(sessionDir, 'state.json'), JSON.stringify(state));
    db.prepare('INSERT OR REPLACE INTO sessions (id, state, updated_at) VALUES (?, ?, ?)').run(
      id,
      JSON.stringify(state),
      updatedAt,
    );
  }

  it('getRecentSessions returns last N sessions ordered by updated_at DESC', () => {
    insertSession('s1', 'completed', '2026-03-01T00:00:00Z');
    insertSession('s2', 'completed', '2026-03-02T00:00:00Z');
    insertSession('s3', 'active', '2026-03-03T00:00:00Z');
    insertSession('s4', 'completed', '2026-03-04T00:00:00Z');
    insertSession('s5', 'failed', '2026-03-05T00:00:00Z');

    const result = store.getRecentSessions(3);
    expect(result).toHaveLength(3);
    expect(result[0].sessionId).toBe('s5');
    expect(result[1].sessionId).toBe('s4');
    expect(result[2].sessionId).toBe('s3');
  });

  it('getIncompleteSessions excludes sessions older than window and completed sessions', () => {
    const now = Date.now();
    const recentTime = new Date(now - 3600000).toISOString(); // 1 hour ago
    const oldTime = new Date(now - 172800000).toISOString(); // 48 hours ago

    insertSession('active-recent', 'active', recentTime);
    insertSession('active-old', 'active', oldTime);
    insertSession('completed-recent', 'completed', recentTime);
    insertSession('failed-recent', 'failed', recentTime);

    const result = store.getIncompleteSessions(86400000); // 24h window
    expect(result).toHaveLength(1);
    expect(result[0].sessionId).toBe('active-recent');
    expect(result[0].status).toBe('active');
  });
});
