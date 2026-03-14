import type { FixPlan, FixStep } from '../orchestrator/types.js';
import type { InfraBrainConfig } from '../config/types.js';
import type { AuditEventType } from '../audit/types.js';
import type { Interface as ReadlineInterface } from 'node:readline/promises';

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface StepResult {
  stepIndex: number;
  status: 'success' | 'failed' | 'skipped';
  runResult?: RunResult;
  retries: number;
  damageCost: number;
}

export interface ExecutionResult {
  status: 'completed' | 'halted' | 'rejected';
  reason?: string;
  stoppedAt?: number;
  stepResults: StepResult[];
  rollingContext?: string;  // Accumulated context from completed steps
}

export interface SnapshotRecord {
  stepIndex: number;
  command: string;
  snapshotCommand: string;
  output: string;
  capturedAt: string;
}

export interface ExecutionDeps {
  runner: {
    run: (executable: string, args: string[], options: { timeout: number; maxBuffer?: number }) => Promise<RunResult>;
  };
  requestApproval: (command: string, risk: FixStep['risk']) => Promise<{ approved: boolean }>;
  auditLogger: {
    logExecution: (eventType: AuditEventType, details: Record<string, unknown>) => void;
  };
  config: InfraBrainConfig;
  readline?: ReadlineInterface;
  sessionId: string;
  sessionDir: string;
  onBeforeStep?: (stepIndex: number, rollingContext: string) => Promise<void>;
}

export interface CorrectionAttempt {
  originalCommand: string;
  correctedCommand: string;
  error: { stderr: string; exitCode: number };
  outcome: 'success' | 'failed' | 'blocked_by_safety' | 'effect_unverified';
}

export interface SelfHealResult {
  status: 'success' | 'exhausted' | 'budget_exceeded';
  finalResult?: RunResult;
  attempts: CorrectionAttempt[];
  commandUsed: string;
}

export interface SelfHealContext {
  maxAttempts: number;
  budget: import('../execution/damage-budget.js').DamageBudget;
  model: import('ai').LanguageModel;
  skill: import('../skills/types.js').SkillFile;
  runner: {
    run: (executable: string, args: string[], options: { timeout: number; maxBuffer?: number }) => Promise<RunResult>;
  };
  rewriteRules: import('../execution/dynamic-rewriter.js').RewriteRule[];
  containers: string[];
  config: InfraBrainConfig;
  auditLogger: {
    logExecution: (eventType: import('../audit/types.js').AuditEventType, details: Record<string, unknown>) => void;
  };
  stepDescription: string;
  toolList: string;
  containerContext: string;
  stepRisk: 'read' | 'write' | 'destructive';
}

export type { FixPlan, FixStep };
