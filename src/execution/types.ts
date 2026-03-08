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
}

export type { FixPlan, FixStep };
