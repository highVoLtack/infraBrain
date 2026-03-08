export type AuditEventType =
  | 'decision'
  | 'command_validation'
  | 'approval'
  | 'state_change'
  | 'error'
  | 'session_start'
  | 'session_end'
  | 'skill_selection';

export interface AuditEntry {
  timestamp: string;
  sessionId: string;
  eventType: AuditEventType;
  riskLevel?: string;
  command?: string;
  decision?: string;
  reasoning?: string;
  optionsConsidered?: string[];
  approvalType?: 'auto' | 'y_n' | 'typed_confirmation';
  diffBefore?: string;
  diffAfter?: string;
  metadata?: Record<string, unknown>;
}

export interface StateDiff {
  before: unknown;
  after: unknown;
  changed: boolean;
}
