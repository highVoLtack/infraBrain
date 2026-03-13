import chalk from 'chalk';
import { join } from 'node:path';
import type { FixPlan } from '../orchestrator/types.js';
import type { ExecutionDeps, ExecutionResult, StepResult } from './types.js';
import { CircuitBreaker } from './circuit-breaker.js';
import { DamageBudget } from './damage-budget.js';
import { RollingContext } from './context-builder.js';
import { captureSnapshot } from './snapshot.js';
import { rollbackStep } from './rollback.js';
import { parseCommand, needsShell } from './runner.js';
import { acquireLock, releaseLock, promptLockOverride } from '../locks/manager.js';

/**
 * Execute a fix plan with full safety pipeline:
 * lock acquire -> for each step (budget check -> snapshot -> approval -> execute -> budget deduct -> context update) -> lock release
 */
export interface ResumeOptions {
  startFromStep?: number;
  skipFailedStep?: boolean;
}

export async function executePlan(
  plan: FixPlan,
  target: string,
  deps: ExecutionDeps,
  options?: ResumeOptions,
): Promise<ExecutionResult> {
  const stepResults: StepResult[] = [];
  const lockDir = join(deps.sessionDir, '..', '..', 'locks');
  let lockAcquired = false;

  try {
    // 1. Acquire lock on target
    const lockResult = acquireLock(target, lockDir, {
      sessionId: deps.sessionId,
      adminName: 'admin',
      pid: process.pid,
      planSummary: plan.summary,
    }, deps.config.locks.staleTimeoutMs);

    if (lockResult.status === 'locked' || lockResult.status === 'stale') {
      // Show lock conflict and prompt for override
      if (deps.readline && lockResult.existing) {
        const override = await promptLockOverride(lockResult.existing, deps.readline);
        if (!override) {
          deps.auditLogger.logExecution('lock_conflict', { target, existingSession: lockResult.existing?.sessionId });
          return { status: 'rejected', reason: 'lock_conflict', stepResults };
        }
        // Force override: delete existing lock and re-acquire
        releaseLock(target, lockDir);
        acquireLock(target, lockDir, {
          sessionId: deps.sessionId,
          adminName: 'admin',
          pid: process.pid,
          planSummary: plan.summary,
        }, deps.config.locks.staleTimeoutMs);
        deps.auditLogger.logExecution('lock_override', { target, overriddenSession: lockResult.existing?.sessionId });
      } else {
        deps.auditLogger.logExecution('lock_conflict', { target, existingSession: lockResult.existing?.sessionId });
        return { status: 'rejected', reason: 'lock_conflict', stepResults };
      }
    }

    lockAcquired = true;
    deps.auditLogger.logExecution('lock_acquired', { target });

    // 2. Log resume event if resuming
    const startFrom = options?.startFromStep ?? 0;
    const skipFailed = options?.skipFailedStep ?? false;

    if (startFrom > 0) {
      deps.auditLogger.logExecution('execution_resume', {
        resumingFrom: startFrom,
        totalSteps: plan.steps.length,
      });
    }

    // Log execution start
    deps.auditLogger.logExecution('execution_start', {
      planSummary: plan.summary,
      target,
      stepCount: plan.steps.length,
    });

    // 3. Create safety modules
    const breaker = new CircuitBreaker(
      deps.config.circuitBreaker.maxRetries,
      deps.config.circuitBreaker.retryDelayMs,
    );
    const budget = new DamageBudget(deps.config.damageBudget.maxPoints);
    const context = new RollingContext(deps.config.tokenBudgets.diagnosis);

    // 4. Execute each step
    for (let i = 0; i < plan.steps.length; i++) {
      // Skip completed steps on resume
      const skipThisStep = i < startFrom || (skipFailed && i === startFrom);
      if (skipThisStep) {
        stepResults.push({ stepIndex: i, status: 'skipped', retries: 0, damageCost: 0 });
        continue;
      }

      const step = plan.steps[i];

      // Inject rolling context for steps after step 0
      const currentContext = context.getContext();
      if (deps.onBeforeStep && currentContext && i > 0) {
        await deps.onBeforeStep(i, currentContext);
      }

      const cost = budget.costFor(step.risk);

      // a. Check damage budget
      if (!budget.canAfford(cost)) {
        // Rollback current step
        await rollbackStep(step, undefined, {
          runner: deps.runner,
          auditLogger: deps.auditLogger,
          config: deps.config,
        });

        deps.auditLogger.logExecution('damage_budget_exceeded', {
          stepIndex: i,
          budgetRemaining: budget.remaining,
          budgetTotal: budget.total,
          cost,
        });

        console.log(chalk.red.bold(`DAMAGE BUDGET EXCEEDED: Step ${i} requires ${cost} points but only ${budget.remaining}/${budget.total} remaining. Plan halted.`));

        return {
          status: 'halted',
          reason: 'damage_budget_exceeded',
          stoppedAt: i,
          stepResults,
          rollingContext: context.getContext() || undefined,
        };
      }

      // b. Capture snapshot for non-READ steps
      let snapshot = undefined;
      if (step.risk !== 'read') {
        snapshot = await captureSnapshot(step, deps.runner, deps.sessionDir, i) ?? undefined;
      }

      // c. Request approval
      const approval = await deps.requestApproval(step.command, step.risk);
      if (!approval.approved) {
        return {
          status: 'rejected',
          reason: 'approval_rejected',
          stoppedAt: i,
          stepResults,
          rollingContext: context.getContext() || undefined,
        };
      }

      // d. Shell mode warning
      if (needsShell(step.command)) {
        console.log(chalk.yellow(`WARNING: Command uses shell mode: ${step.command}`));
      }

      // e. Execute via circuit breaker
      const { executable, args } = parseCommand(step.command);
      const cbResult = await breaker.execute(
        i,
        () => deps.runner.run(executable, args, {
          timeout: deps.config.execution.commandTimeoutMs,
          maxBuffer: deps.config.execution.maxBufferBytes,
        }),
        budget,
        step.risk,
      );

      if (cbResult.status === 'circuit_open') {
        // Rollback failing step
        await rollbackStep(step, snapshot, {
          runner: deps.runner,
          auditLogger: deps.auditLogger,
          config: deps.config,
        });

        deps.auditLogger.logExecution('circuit_breaker_triggered', {
          stepIndex: i,
          command: step.command,
          maxRetries: deps.config.circuitBreaker.maxRetries,
        });

        console.log(chalk.red.bold(`CIRCUIT BREAKER: Step ${i} failed after ${deps.config.circuitBreaker.maxRetries} retries. Plan halted.`));

        stepResults.push({
          stepIndex: i,
          status: 'failed',
          runResult: cbResult.result,
          retries: deps.config.circuitBreaker.maxRetries,
          damageCost: 0,
        });

        return {
          status: 'halted',
          reason: 'circuit_breaker',
          stoppedAt: i,
          stepResults,
          rollingContext: context.getContext() || undefined,
        };
      }

      // f. Success: deduct from budget and log
      budget.deduct(cost);

      deps.auditLogger.logExecution('step_complete', {
        stepIndex: i,
        command: step.command,
        exitCode: cbResult.result!.exitCode,
      });

      console.log(chalk.dim(`Budget: ${budget.spent}/${budget.total} used`));

      stepResults.push({
        stepIndex: i,
        status: 'success',
        runResult: cbResult.result,
        retries: 0,
        damageCost: cost,
      });

      // g. Add result to rolling context
      if (cbResult.result) {
        context.addStepResult(i, step, cbResult.result);
      }
    }

    // 5. Log execution complete
    deps.auditLogger.logExecution('execution_complete', {
      planSummary: plan.summary,
      target,
      stepsCompleted: stepResults.length,
    });

    return { status: 'completed', stepResults, rollingContext: context.getContext() || undefined };
  } finally {
    // 6. Always release lock
    if (lockAcquired) {
      releaseLock(target, lockDir);
      deps.auditLogger.logExecution('lock_released', { target });
    }
  }
}
