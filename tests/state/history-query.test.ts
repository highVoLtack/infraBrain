import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { initDatabase } from '../../src/state/db.js';
import { WriteThrough } from '../../src/state/store.js';
import { parseTimeInput } from '../../src/cli/time-parser.js';
import type { AuditEntry } from '../../src/audit/types.js';
import express from 'express';
import request from 'supertest';

// ---------- parseTimeInput tests ----------

describe('parseTimeInput', () => {
  it('parses ISO 8601 string and returns it as ISO', () => {
    const result = parseTimeInput('2026-03-08T12:00:00.000Z');
    expect(result).toBe('2026-03-08T12:00:00.000Z');
  });

  it('parses "1h ago" to approximately 1 hour before now', () => {
    const before = Date.now() - 3600000 - 1000; // 1h + 1s buffer
    const result = parseTimeInput('1h ago');
    const parsed = new Date(result).getTime();
    const after = Date.now() - 3600000 + 1000; // 1h - 1s buffer
    expect(parsed).toBeGreaterThan(before);
    expect(parsed).toBeLessThan(after);
  });

  it('parses "30m ago" to approximately 30 minutes before now', () => {
    const before = Date.now() - 1800000 - 1000;
    const result = parseTimeInput('30m ago');
    const parsed = new Date(result).getTime();
    const after = Date.now() - 1800000 + 1000;
    expect(parsed).toBeGreaterThan(before);
    expect(parsed).toBeLessThan(after);
  });

  it('parses "2d ago" to approximately 2 days before now', () => {
    const before = Date.now() - 172800000 - 1000;
    const result = parseTimeInput('2d ago');
    const parsed = new Date(result).getTime();
    const after = Date.now() - 172800000 + 1000;
    expect(parsed).toBeGreaterThan(before);
    expect(parsed).toBeLessThan(after);
  });

  it('throws on garbage input', () => {
    expect(() => parseTimeInput('garbage')).toThrow('Invalid time input');
  });

  it('parses relative time without "ago" suffix', () => {
    const result = parseTimeInput('5s');
    const parsed = new Date(result).getTime();
    expect(parsed).toBeGreaterThan(Date.now() - 6000);
    expect(parsed).toBeLessThan(Date.now());
  });
});

// ---------- queryAuditLog tests ----------

describe('queryAuditLog', () => {
  let db: Database.Database;
  let store: WriteThrough;

  const sampleEntries: AuditEntry[] = [
    { timestamp: '2026-03-08T10:00:00.000Z', sessionId: 'sess-1', eventType: 'decision', riskLevel: 'read', command: 'systemctl status nginx', decision: 'Check nginx', reasoning: 'Service might be down' },
    { timestamp: '2026-03-08T10:01:00.000Z', sessionId: 'sess-1', eventType: 'command_validation', riskLevel: 'write', command: 'systemctl restart nginx' },
    { timestamp: '2026-03-08T10:02:00.000Z', sessionId: 'sess-1', eventType: 'approval', riskLevel: 'destructive', command: 'rm -rf /tmp/cache' },
    { timestamp: '2026-03-08T10:03:00.000Z', sessionId: 'sess-2', eventType: 'decision', riskLevel: 'read', command: 'docker ps' },
    { timestamp: '2026-03-08T10:04:00.000Z', sessionId: 'sess-2', eventType: 'error', command: 'docker restart app' },
    { timestamp: '2026-03-08T10:05:00.000Z', sessionId: 'sess-2', eventType: 'approval', riskLevel: 'write', command: 'docker compose up -d' },
    { timestamp: '2026-03-08T10:06:00.000Z', sessionId: 'sess-3', eventType: 'session_start' },
    { timestamp: '2026-03-08T10:07:00.000Z', sessionId: 'sess-3', eventType: 'skill_selection', riskLevel: 'read' },
    { timestamp: '2026-03-08T10:08:00.000Z', sessionId: 'sess-3', eventType: 'execution_start', riskLevel: 'write', command: 'apt update' },
    { timestamp: '2026-03-08T10:09:00.000Z', sessionId: 'sess-3', eventType: 'execution_complete', riskLevel: 'read', command: 'apt list --upgradable' },
    { timestamp: '2026-03-08T10:10:00.000Z', sessionId: 'sess-3', eventType: 'session_end' },
  ];

  beforeEach(() => {
    db = initDatabase(':memory:');
    store = new WriteThrough(db);

    // Insert sessions first (foreign key)
    const insertSession = db.prepare('INSERT OR IGNORE INTO sessions (id, state, updated_at) VALUES (?, ?, ?)');
    insertSession.run('sess-1', '{}', '2026-03-08T10:00:00.000Z');
    insertSession.run('sess-2', '{}', '2026-03-08T10:03:00.000Z');
    insertSession.run('sess-3', '{}', '2026-03-08T10:06:00.000Z');

    // Insert audit entries directly into DB (bypass file write)
    const insertAudit = db.prepare(`
      INSERT INTO audit_log (session_id, timestamp, event_type, risk_level, command, decision, reasoning, diff_before, diff_after)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const entry of sampleEntries) {
      insertAudit.run(
        entry.sessionId,
        entry.timestamp,
        entry.eventType,
        entry.riskLevel ?? null,
        entry.command ?? null,
        entry.decision ?? null,
        entry.reasoning ?? null,
        entry.diffBefore ?? null,
        entry.diffAfter ?? null,
      );
    }
  });

  afterEach(() => {
    db.close();
  });

  it('returns last 20 entries by default (ordered by timestamp DESC)', () => {
    const results = store.queryAuditLog({});
    expect(results.length).toBe(11); // all entries, less than 20
    expect(results[0].timestamp).toBe('2026-03-08T10:10:00.000Z');
    expect(results[results.length - 1].timestamp).toBe('2026-03-08T10:00:00.000Z');
  });

  it('filters by sessionId', () => {
    const results = store.queryAuditLog({ sessionId: 'sess-2' });
    expect(results.length).toBe(3);
    expect(results.every(r => r.sessionId === 'sess-2')).toBe(true);
  });

  it('filters by eventType', () => {
    const results = store.queryAuditLog({ eventType: 'approval' });
    expect(results.length).toBe(2);
    expect(results.every(r => r.eventType === 'approval')).toBe(true);
  });

  it('filters by riskLevel', () => {
    const results = store.queryAuditLog({ riskLevel: 'destructive' });
    expect(results.length).toBe(1);
    expect(results[0].command).toBe('rm -rf /tmp/cache');
  });

  it('filters by eventType AND riskLevel (AND logic)', () => {
    const results = store.queryAuditLog({ eventType: 'approval', riskLevel: 'write' });
    expect(results.length).toBe(1);
    expect(results[0].command).toBe('docker compose up -d');
  });

  it('filters by since/until time range', () => {
    const results = store.queryAuditLog({
      since: '2026-03-08T10:03:00.000Z',
      until: '2026-03-08T10:06:00.000Z',
    });
    // Entries at 10:03, 10:04, 10:05, 10:06
    expect(results.length).toBe(4);
  });

  it('respects limit parameter', () => {
    const results = store.queryAuditLog({ limit: 5 });
    expect(results.length).toBe(5);
  });

  it('combines multiple filters with AND logic', () => {
    const results = store.queryAuditLog({
      sessionId: 'sess-1',
      riskLevel: 'read',
    });
    expect(results.length).toBe(1);
    expect(results[0].eventType).toBe('decision');
  });

  it('returns camelCase properties', () => {
    const results = store.queryAuditLog({ limit: 1 });
    expect(results[0]).toHaveProperty('sessionId');
    expect(results[0]).toHaveProperty('eventType');
    expect(results[0]).toHaveProperty('riskLevel');
  });
});

// ---------- GET /history route tests ----------

describe('GET /history', () => {
  let app: express.Express;
  let mockStore: { queryAuditLog: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    const { createHistoryRoute } = await import('../../src/api/routes/history.js');
    mockStore = {
      queryAuditLog: vi.fn().mockReturnValue([
        { timestamp: '2026-03-08T10:00:00.000Z', sessionId: 'sess-1', eventType: 'decision', riskLevel: 'read', command: 'test cmd' },
      ]),
    };
    app = express();
    app.use('/history', createHistoryRoute({ store: mockStore as any }));
  });

  it('returns audit entries with default limit', async () => {
    const res = await request(app).get('/history');
    expect(res.status).toBe(200);
    expect(res.body.entries).toHaveLength(1);
    expect(res.body.count).toBe(1);
  });

  it('passes filters from query params to store', async () => {
    await request(app).get('/history?type=approval&risk=destructive');
    expect(mockStore.queryAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'approval',
        riskLevel: 'destructive',
      }),
    );
  });

  it('passes session filter', async () => {
    await request(app).get('/history?session=sess-1');
    expect(mockStore.queryAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'sess-1',
      }),
    );
  });

  it('passes limit filter', async () => {
    await request(app).get('/history?limit=50');
    expect(mockStore.queryAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        limit: 50,
      }),
    );
  });
});
