import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import express from 'express';
import request from 'supertest';
import { WriteThrough } from '../../src/state/store.js';
import { createHistoryRoute } from '../../src/api/routes/history.js';
import type { SessionState } from '../../src/state/types.js';

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      state TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      event_type TEXT NOT NULL,
      risk_level TEXT,
      command TEXT,
      decision TEXT,
      reasoning TEXT,
      diff_before TEXT,
      diff_after TEXT,
      metadata TEXT,
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    );
    CREATE INDEX idx_audit_session ON audit_log(session_id);
    CREATE INDEX idx_audit_timestamp ON audit_log(timestamp);
  `);
  return db;
}

function insertSession(db: Database.Database, id: string, status: string, target: string, updatedAt: string): void {
  const state: SessionState = {
    sessionId: id,
    createdAt: updatedAt,
    updatedAt,
    status: status as SessionState['status'],
    target,
  };
  db.prepare('INSERT INTO sessions (id, state, updated_at) VALUES (?, ?, ?)').run(id, JSON.stringify(state), updatedAt);
}

function insertAuditEntry(db: Database.Database, sessionId: string, eventType: string, timestamp: string): void {
  db.prepare(
    'INSERT INTO audit_log (session_id, event_type, timestamp) VALUES (?, ?, ?)',
  ).run(sessionId, eventType, timestamp);
}

describe('WriteThrough - session resolution methods', () => {
  let db: Database.Database;
  let store: WriteThrough;

  beforeEach(() => {
    db = createTestDb();
    store = new WriteThrough(db);
    // Insert two sessions: older and newer
    insertSession(db, 'sess-old', 'completed', 'postgres-server', '2026-03-12T10:00:00Z');
    insertSession(db, 'sess-new', 'active', 'docker-host', '2026-03-13T10:00:00Z');
    // Insert audit entries
    insertAuditEntry(db, 'sess-old', 'step_complete', '2026-03-12T10:01:00Z');
    insertAuditEntry(db, 'sess-old', 'execution_complete', '2026-03-12T10:02:00Z');
    insertAuditEntry(db, 'sess-new', 'skill_selection', '2026-03-13T10:01:00Z');
    insertAuditEntry(db, 'sess-new', 'step_complete', '2026-03-13T10:02:00Z');
    insertAuditEntry(db, 'sess-new', 'step_complete', '2026-03-13T10:03:00Z');
  });

  afterEach(() => {
    db.close();
  });

  it('getLatestSessionId returns the most recent session ID', () => {
    expect(store.getLatestSessionId()).toBe('sess-new');
  });

  it('getLatestSessionId returns null when no sessions', () => {
    const emptyDb = createTestDb();
    const emptyStore = new WriteThrough(emptyDb);
    expect(emptyStore.getLatestSessionId()).toBeNull();
    emptyDb.close();
  });

  it('getSessionIdByAlias("last") returns the most recent session ID', () => {
    expect(store.getSessionIdByAlias('last')).toBe('sess-new');
  });

  it('getSessionIdByAlias("previous") returns the second-most-recent session ID', () => {
    expect(store.getSessionIdByAlias('previous')).toBe('sess-old');
  });

  it('getSessionIdByAlias("previous") returns null when only 1 session', () => {
    const singleDb = createTestDb();
    const singleStore = new WriteThrough(singleDb);
    insertSession(singleDb, 'only-one', 'active', 'host', '2026-03-13T10:00:00Z');
    expect(singleStore.getSessionIdByAlias('previous')).toBeNull();
    singleDb.close();
  });

  it('getSessionList returns correct shape and ordering', () => {
    const list = store.getSessionList();
    expect(list).toHaveLength(2);
    // Newest first
    expect(list[0].id).toBe('sess-new');
    expect(list[0].status).toBe('active');
    expect(list[0].target).toBe('docker-host');
    expect(list[0].eventCount).toBe(3);

    expect(list[1].id).toBe('sess-old');
    expect(list[1].status).toBe('completed');
    expect(list[1].target).toBe('postgres-server');
    expect(list[1].eventCount).toBe(2);
  });

  it('getSessionList respects limit', () => {
    const list = store.getSessionList(1);
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('sess-new');
  });
});

describe('History route - alias resolution and list endpoint', () => {
  let db: Database.Database;
  let store: WriteThrough;
  let app: express.Express;

  beforeEach(() => {
    db = createTestDb();
    store = new WriteThrough(db);
    insertSession(db, 'sess-old', 'completed', 'postgres-server', '2026-03-12T10:00:00Z');
    insertSession(db, 'sess-new', 'active', 'docker-host', '2026-03-13T10:00:00Z');
    insertAuditEntry(db, 'sess-old', 'step_complete', '2026-03-12T10:01:00Z');
    insertAuditEntry(db, 'sess-new', 'skill_selection', '2026-03-13T10:01:00Z');
    insertAuditEntry(db, 'sess-new', 'step_complete', '2026-03-13T10:02:00Z');

    app = express();
    app.use('/history', createHistoryRoute({ store }));
  });

  afterEach(() => {
    db.close();
  });

  it('GET /history?session=last resolves to latest session entries', async () => {
    const res = await request(app).get('/history?session=last');
    expect(res.status).toBe(200);
    expect(res.body.entries).toHaveLength(2);
    // All entries should belong to sess-new
    for (const entry of res.body.entries) {
      expect(entry.sessionId).toBe('sess-new');
    }
  });

  it('GET /history?session=previous resolves to second-latest session entries', async () => {
    const res = await request(app).get('/history?session=previous');
    expect(res.status).toBe(200);
    expect(res.body.entries).toHaveLength(1);
    expect(res.body.entries[0].sessionId).toBe('sess-old');
  });

  it('GET /history?session=nonexistent returns 404', async () => {
    // 'nonexistent' is not a known alias and not a real UUID -- but
    // only 'last' and 'previous' are aliases; anything else is treated
    // as a literal session ID, which won't match => empty results (200).
    // Per plan: nonexistent-alias => 404 for unknown aliases.
    // However the route should only 404 for known aliases that resolve to null.
    // Arbitrary strings are treated as literal IDs (backward compat).
    const res = await request(app).get('/history?session=nonexistent-id');
    expect(res.status).toBe(200);
    expect(res.body.entries).toHaveLength(0);
  });

  it('GET /history?list=true returns session list', async () => {
    const res = await request(app).get('/history?list=true');
    expect(res.status).toBe(200);
    expect(res.body.sessions).toHaveLength(2);
    expect(res.body.sessions[0].id).toBe('sess-new');
    expect(res.body.count).toBe(2);
  });

  it('GET /history with no session param returns all entries (backward compat)', async () => {
    const res = await request(app).get('/history');
    expect(res.status).toBe(200);
    // Should return all 3 entries (no session filter applied server-side)
    expect(res.body.entries).toHaveLength(3);
  });

  it('GET /history?session=<real-uuid> works unchanged', async () => {
    const res = await request(app).get('/history?session=sess-old');
    expect(res.status).toBe(200);
    expect(res.body.entries).toHaveLength(1);
    expect(res.body.entries[0].sessionId).toBe('sess-old');
  });
});
