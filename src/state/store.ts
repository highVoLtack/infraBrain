import type Database from 'better-sqlite3';
import { writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SessionState } from './types.js';
import type { AuditEntry } from '../audit/types.js';

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
