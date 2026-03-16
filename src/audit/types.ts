export type AuditEventType =
  | 'decision'
  | 'command_validation'
  | 'approval'
  | 'state_change'
  | 'error'
  | 'session_start'
  | 'session_end'
  | 'skill_selection'
  // Phase 3: Execution engine events
  | 'execution_start'
  | 'execution_complete'
  | 'step_start'
  | 'step_complete'
  | 'step_failed'
  | 'snapshot_captured'
  | 'rollback_start'
  | 'rollback_complete'
  | 'rollback_failed'
  | 'circuit_breaker_triggered'
  | 'damage_budget_exceeded'
  | 'damage_budget_update'
  | 'lock_acquired'
  | 'lock_released'
  | 'lock_conflict'
  | 'lock_override'
  | 'execution_resume'
  | 'discovery_complete'
  | 'context_injection'
  | 'verification'
  | 'self_heal_attempt'
  | 'self_heal_exhausted'
  | 'self_heal_progress'
  | 'config_reverted_after_restart'
  | 'persistence_fix_failed';

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
