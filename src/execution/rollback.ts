import type { FixStep, RunResult, SnapshotRecord } from './types.js';
import { parseCommand } from './runner.js';
import type { AuditEventType } from '../audit/types.js';

export interface RollbackResult {
  success: boolean;
  error?: string;
}

export interface RollbackDeps {
  runner: {
    run: (executable: string, args: string[], options: { timeout: number; maxBuffer?: number }) => Promise<RunResult>;
  };
  auditLogger: {
    logExecution: (eventType: AuditEventType, details: Record<string, unknown>) => void;
  };
  config: {
    execution: { commandTimeoutMs: number; maxBufferBytes: number };
  };
}

/**
 * Execute rollback for a failing step.
 * Auto-approved (no HITL gate) per user decision: "Rollback commands are auto-approved
 * since the admin already approved the plan."
 *
 * On failure: logs CRITICAL event, does NOT retry.
 */
export async function rollbackStep(
  step: FixStep,
  snapshot: SnapshotRecord | undefined,
  deps: RollbackDeps,
): Promise<RollbackResult> {
  const rollbackCommand = step.rollback;
  const { executable, args } = parseCommand(rollbackCommand);

  // Log rollback start
  deps.auditLogger.logExecution('rollback_start', {
    command: rollbackCommand,
    originalCommand: step.command,
    stepDescription: step.description,
    hasSnapshot: !!snapshot,
  });

  // Execute rollback command (no approval gate)
  const result = await deps.runner.run(executable, args, {
    timeout: deps.config.execution.commandTimeoutMs,
    maxBuffer: deps.config.execution.maxBufferBytes,
  });

  if (result.exitCode !== 0) {
    // CRITICAL: rollback failed
    deps.auditLogger.logExecution('rollback_failed', {
      severity: 'CRITICAL',
      command: rollbackCommand,
      originalCommand: step.command,
      exitCode: result.exitCode,
      stderr: result.stderr,
      stdout: result.stdout,
      snapshotState: snapshot?.output,
    });

    return {
      success: false,
      error: result.stderr || result.stdout || `Rollback command exited with code ${result.exitCode}`,
    };
  }

  // Log rollback complete
  deps.auditLogger.logExecution('rollback_complete', {
    command: rollbackCommand,
    originalCommand: step.command,
  });

  return { success: true };
}
