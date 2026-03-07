import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initDatabase } from '../../src/state/db.js';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('initDatabase', () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'infrabrain-test-'));
    dbPath = join(tmpDir, 'test.db');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates sessions table with correct columns', () => {
    const db = initDatabase(dbPath);
    const columns = db.pragma('table_info(sessions)') as Array<{ name: string; type: string }>;
    const columnNames = columns.map((c) => c.name);

    expect(columnNames).toContain('id');
    expect(columnNames).toContain('state');
    expect(columnNames).toContain('created_at');
    expect(columnNames).toContain('updated_at');

    db.close();
  });

  it('creates audit_log table with correct columns', () => {
    const db = initDatabase(dbPath);
    const columns = db.pragma('table_info(audit_log)') as Array<{ name: string; type: string }>;
    const columnNames = columns.map((c) => c.name);

    expect(columnNames).toContain('id');
    expect(columnNames).toContain('session_id');
    expect(columnNames).toContain('timestamp');
    expect(columnNames).toContain('event_type');
    expect(columnNames).toContain('risk_level');
    expect(columnNames).toContain('command');
    expect(columnNames).toContain('decision');
    expect(columnNames).toContain('reasoning');
    expect(columnNames).toContain('diff_before');
    expect(columnNames).toContain('diff_after');

    db.close();
  });

  it('sets WAL journal mode', () => {
    const db = initDatabase(dbPath);
    const result = db.pragma('journal_mode') as Array<{ journal_mode: string }>;
    expect(result[0].journal_mode).toBe('wal');
    db.close();
  });

  it('sets NORMAL synchronous mode', () => {
    const db = initDatabase(dbPath);
    const result = db.pragma('synchronous') as Array<{ synchronous: number }>;
    // synchronous = NORMAL is value 1
    expect(result[0].synchronous).toBe(1);
    db.close();
  });

  it('is idempotent (calling twice does not error)', () => {
    const db1 = initDatabase(dbPath);
    db1.close();

    // Should not throw
    const db2 = initDatabase(dbPath);
    const columns = db2.pragma('table_info(sessions)') as Array<{ name: string }>;
    expect(columns.length).toBeGreaterThan(0);
    db2.close();
  });
});
