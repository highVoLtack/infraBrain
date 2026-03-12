import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WriteThrough } from '../../src/state/store.js';
import { initDatabase } from '../../src/state/db.js';
import { createSession, loadSession } from '../../src/state/session.js';
import type { SessionState } from '../../src/state/types.js';
import type { AuditEntry } from '../../src/audit/types.js';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('Session management', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'infrabrain-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('createSession generates a UUID session ID', () => {
    const session = createSession(tmpDir);
    // UUID v7 format: xxxxxxxx-xxxx-7xxx-xxxx-xxxxxxxxxxxx
    expect(session.sessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
  });

  it('createSession creates session directory with state.json', () => {
    const session = createSession(tmpDir);
    const sessionDir = join(tmpDir, '.infrabrain', 'sessions', session.sessionId);
    expect(existsSync(join(sessionDir, 'state.json'))).toBe(true);
  });

  it('createSession creates audit.jsonl file', () => {
    const session = createSession(tmpDir);
    const sessionDir = join(tmpDir, '.infrabrain', 'sessions', session.sessionId);
    expect(existsSync(join(sessionDir, 'audit.jsonl'))).toBe(true);
  });

  it('createSession creates diffs/ directory', () => {
    const session = createSession(tmpDir);
    const sessionDir = join(tmpDir, '.infrabrain', 'sessions', session.sessionId);
    expect(existsSync(join(sessionDir, 'diffs'))).toBe(true);
  });

  it('session directory structure matches expected path', () => {
    const session = createSession(tmpDir);
    const sessionDir = join(tmpDir, '.infrabrain', 'sessions', session.sessionId);
    expect(existsSync(sessionDir)).toBe(true);
  });

  it('loadSession reads state.json from session directory', () => {
    const created = createSession(tmpDir);
    const sessionDir = join(tmpDir, '.infrabrain', 'sessions', created.sessionId);
    const loaded = loadSession(sessionDir);
    expect(loaded.sessionId).toBe(created.sessionId);
    expect(loaded.status).toBe('active');
  });
});

describe('WriteThrough', () => {
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

  it('persistState writes to both file and SQLite', () => {
    const session = createSession(tmpDir);
    const sessionDir = join(tmpDir, '.infrabrain', 'sessions', session.sessionId);

    const updatedState: SessionState = {
      ...session,
      status: 'completed',
      updatedAt: new Date().toISOString(),
    };

    store.persistState(sessionDir, updatedState);

    // Check file
    const fileContent = JSON.parse(readFileSync(join(sessionDir, 'state.json'), 'utf-8'));
    expect(fileContent.status).toBe('completed');

    // Check SQLite
    const row = db.prepare('SELECT state FROM sessions WHERE id = ?').get(updatedState.sessionId) as { state: string };
    const dbState = JSON.parse(row.state);
    expect(dbState.status).toBe('completed');
  });

  it('persistState file content matches SQLite content', () => {
    const session = createSession(tmpDir);
    const sessionDir = join(tmpDir, '.infrabrain', 'sessions', session.sessionId);

    store.persistState(sessionDir, session);

    const fileContent = readFileSync(join(sessionDir, 'state.json'), 'utf-8');
    const row = db.prepare('SELECT state FROM sessions WHERE id = ?').get(session.sessionId) as { state: string };

    // Both should contain equivalent JSON
    expect(JSON.parse(fileContent)).toEqual(JSON.parse(row.state));
  });

  it('appendAudit appends JSONL to audit.jsonl and inserts into audit_log', () => {
    const session = createSession(tmpDir);
    const sessionDir = join(tmpDir, '.infrabrain', 'sessions', session.sessionId);

    // Must persist session first so FK constraint is satisfied
    store.persistState(sessionDir, session);

    const entry: AuditEntry = {
      timestamp: new Date().toISOString(),
      sessionId: session.sessionId,
      eventType: 'decision',
      reasoning: 'test reasoning',
      decision: 'test decision',
    };

    store.appendAudit(sessionDir, entry);

    // Check file
    const fileContent = readFileSync(join(sessionDir, 'audit.jsonl'), 'utf-8').trim();
    const parsed = JSON.parse(fileContent);
    expect(parsed.eventType).toBe('decision');
    expect(parsed.reasoning).toBe('test reasoning');

    // Check SQLite
    const row = db.prepare('SELECT * FROM audit_log WHERE session_id = ?').get(session.sessionId) as {
      event_type: string;
      reasoning: string;
    };
    expect(row.event_type).toBe('decision');
    expect(row.reasoning).toBe('test reasoning');
  });

  it('appendAudit with metadata persists JSON and round-trips through queryAuditLog', () => {
    const session = createSession(tmpDir);
    const sessionDir = join(tmpDir, '.infrabrain', 'sessions', session.sessionId);
    store.persistState(sessionDir, session);

    const metadata = { stepIndex: 0, command: 'echo hi' };
    const entry: AuditEntry = {
      timestamp: new Date().toISOString(),
      sessionId: session.sessionId,
      eventType: 'step_complete',
      metadata,
    };

    store.appendAudit(sessionDir, entry);

    const results = store.queryAuditLog({ sessionId: session.sessionId });
    expect(results).toHaveLength(1);
    expect(results[0].metadata).toEqual(metadata);
  });

  it('appendAudit without metadata stores null and queryAuditLog returns undefined', () => {
    const session = createSession(tmpDir);
    const sessionDir = join(tmpDir, '.infrabrain', 'sessions', session.sessionId);
    store.persistState(sessionDir, session);

    const entry: AuditEntry = {
      timestamp: new Date().toISOString(),
      sessionId: session.sessionId,
      eventType: 'decision',
      decision: 'approve',
    };

    store.appendAudit(sessionDir, entry);

    const results = store.queryAuditLog({ sessionId: session.sessionId });
    expect(results).toHaveLength(1);
    expect(results[0].metadata).toBeUndefined();
  });

  it('queryAuditLog returns parsed metadata object (not raw string)', () => {
    const session = createSession(tmpDir);
    const sessionDir = join(tmpDir, '.infrabrain', 'sessions', session.sessionId);
    store.persistState(sessionDir, session);

    const metadata = { nested: { key: 'value' }, count: 42 };
    const entry: AuditEntry = {
      timestamp: new Date().toISOString(),
      sessionId: session.sessionId,
      eventType: 'step_complete',
      metadata,
    };

    store.appendAudit(sessionDir, entry);

    const results = store.queryAuditLog({ sessionId: session.sessionId });
    expect(results[0].metadata).toEqual(metadata);
    expect(typeof results[0].metadata).toBe('object');
    expect(typeof results[0].metadata).not.toBe('string');
  });
});
