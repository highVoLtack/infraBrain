import type Database from 'better-sqlite3';
import { writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SessionState } from './types.js';
import type { AuditEntry } from '../audit/types.js';

export interface AuditQueryFilters {
  sessionId?: string;
  eventType?: string;
  riskLevel?: string;
  since?: string;
  until?: string;
  limit?: number;
}

export class WriteThrough {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /**
   * Write state to both file (source of truth) and SQLite (queryable index).
   * File is written first -- if file and SQLite diverge, file wins.
   */
  persistState(sessionDir: string, state: SessionState): void {
    // File write first (source of truth)
    writeFileSync(
      join(sessionDir, 'state.json'),
      JSON.stringify(state, null, 2)
    );

    // SQLite index update (synchronous, same tick)
    const stmt = this.db.prepare(
      'INSERT OR REPLACE INTO sessions (id, state, updated_at) VALUES (?, ?, ?)'
    );
    stmt.run(state.sessionId, JSON.stringify(state), new Date().toISOString());
  }

  /**
   * Append audit entry to both JSONL file and SQLite audit_log table.
   */
  /**
   * Get the most recent sessions ordered by updated_at descending.
   */
  getRecentSessions(limit: number = 3): SessionState[] {
    const rows = this.db
      .prepare('SELECT state FROM sessions ORDER BY updated_at DESC LIMIT ?')
      .all(limit) as Array<{ state: string }>;
    return rows.map((row) => JSON.parse(row.state) as SessionState);
  }

  /**
   * Get active (incomplete) sessions within a time window.
   * Filters by status='active' in the JSON state column and updated_at within windowMs.
   */
  getIncompleteSessions(windowMs: number = 86400000): SessionState[] {
    const cutoff = new Date(Date.now() - windowMs).toISOString();
    const rows = this.db
      .prepare(
        `SELECT state FROM sessions
         WHERE json_extract(state, '$.status') = 'active'
         AND updated_at >= ?
         ORDER BY updated_at DESC`,
      )
      .all(cutoff) as Array<{ state: string }>;
    return rows.map((row) => JSON.parse(row.state) as SessionState);
  }

  /**
   * Query audit log with parameterized filters (AND logic).
   * Returns entries ordered by timestamp DESC with configurable limit.
   */
  queryAuditLog(filters: AuditQueryFilters): AuditEntry[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filters.sessionId) {
      conditions.push('session_id = ?');
      params.push(filters.sessionId);
    }
    if (filters.eventType) {
      conditions.push('event_type = ?');
      params.push(filters.eventType);
    }
    if (filters.riskLevel) {
      conditions.push('risk_level = ?');
      params.push(filters.riskLevel);
    }
    if (filters.since) {
      conditions.push('timestamp >= ?');
      params.push(filters.since);
    }
    if (filters.until) {
      conditions.push('timestamp <= ?');
      params.push(filters.until);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = filters.limit ?? 20;
    params.push(limit);

    const sql = `SELECT * FROM audit_log ${where} ORDER BY timestamp DESC LIMIT ?`;
    const rows = this.db.prepare(sql).all(...params) as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      timestamp: row.timestamp as string,
      sessionId: row.session_id as string,
      eventType: row.event_type as string,
      riskLevel: (row.risk_level as string) ?? undefined,
      command: (row.command as string) ?? undefined,
      decision: (row.decision as string) ?? undefined,
      reasoning: (row.reasoning as string) ?? undefined,
      diffBefore: (row.diff_before as string) ?? undefined,
      diffAfter: (row.diff_after as string) ?? undefined,
    })) as AuditEntry[];
  }

  appendAudit(sessionDir: string, entry: AuditEntry): void {
    // Append to JSONL file
    appendFileSync(
      join(sessionDir, 'audit.jsonl'),
      JSON.stringify(entry) + '\n'
    );

    // Insert into SQLite audit_log
    const stmt = this.db.prepare(`
      INSERT INTO audit_log (session_id, timestamp, event_type, risk_level, command, decision, reasoning, diff_before, diff_after)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      entry.sessionId,
      entry.timestamp,
      entry.eventType,
      entry.riskLevel ?? null,
      entry.command ?? null,
      entry.decision ?? null,
      entry.reasoning ?? null,
      entry.diffBefore ?? null,
      entry.diffAfter ?? null
    );
  }
}
