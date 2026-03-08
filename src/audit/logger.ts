import type { WriteThrough } from '../state/store.js';
import type { AuditEntry, AuditEventType } from './types.js';

export class AuditLogger {
  private store: WriteThrough;
  private sessionId: string;
  private sessionDir: string;

  constructor(store: WriteThrough, sessionId: string, sessionDir: string) {
    this.store = store;
    this.sessionId = sessionId;
    this.sessionDir = sessionDir;
  }

  logDecision(reasoning: string, optionsConsidered: string[], chosen: string): void {
    this.log({
      eventType: 'decision',
      reasoning,
      optionsConsidered,
      decision: chosen,
    });
  }

  logCommandValidation(command: string, riskLevel: string, allowed: boolean, reason?: string): void {
    this.log({
      eventType: 'command_validation',
      command,
      riskLevel,
      decision: allowed ? 'allowed' : 'blocked',
      reasoning: reason,
    });
  }

  logApproval(command: string, approved: boolean, approvalType: 'auto' | 'y_n' | 'typed_confirmation'): void {
    this.log({
      eventType: 'approval',
      command,
      decision: approved ? 'approved' : 'rejected',
      approvalType,
    });
  }

  logStateDiff(before: unknown, after: unknown): void {
    const beforeStr = JSON.stringify(before);
    const afterStr = JSON.stringify(after);
    const changed = beforeStr !== afterStr;

    this.log({
      eventType: 'state_change',
      diffBefore: beforeStr,
      diffAfter: afterStr,
      metadata: { changed },
    });
  }

  logSkillSelection(skillName: string, reasoning: string, override: boolean): void {
    this.log({
      eventType: 'skill_selection',
      reasoning,
      metadata: { skillName, reasoning, override },
    });
  }

  logError(error: string, context?: Record<string, unknown>): void {
    this.log({
      eventType: 'error',
      reasoning: error,
      metadata: context,
    });
  }

  logExecution(eventType: AuditEventType, details: Record<string, unknown>): void {
    this.log({
      eventType,
      metadata: details,
    });
  }

  private log(fields: Partial<AuditEntry> & { eventType: AuditEventType }): void {
    const entry: AuditEntry = {
      timestamp: new Date().toISOString(),
      sessionId: this.sessionId,
      ...fields,
    };
    this.store.appendAudit(this.sessionDir, entry);
  }
}
