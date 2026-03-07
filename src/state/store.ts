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
