import chalk from 'chalk';
import { join } from 'node:path';
import type { FixPlan } from '../orchestrator/types.js';
import type { ExecutionDeps, ExecutionResult, StepResult } from './types.js';
import { CircuitBreaker } from './circuit-breaker.js';
import { DamageBudget } from './damage-budget.js';
import { RollingContext } from './context-builder.js';
import { captureSnapshot } from './snapshot.js';
import { rollbackStep } from './rollback.js';
import { parseCommand, needsShell, runShellCommand } from './runner.js';
import { selfHealStep, buildToolListFromSkill, extractSkillDomainKnowledge } from './self-healer.js';
import { isConfigModification, isRestartStep, verifyPersistence } from './persistence-verification.js';
import type { ConfigModificationRecord } from './persistence-verification.js';
import type { SelfHealContext } from './types.js';
import { acquireLock, releaseLock, promptLockOverride } from '../locks/manager.js';
import { sanitizeDockerExec } from '../safety/validator.js';

const DEV_MODE = process.env.NODE_ENV !== 'production';

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
    const configModifications: ConfigModificationRecord[] = [];

    // 4. Execute each step
    for (let i = 0; i < plan.steps.length; i++) {
      // Skip completed steps on resume
      const skipThisStep = i < startFrom || (skipFailed && i === startFrom);
      if (skipThisStep) {
        stepResults.push({ stepIndex: i, status: 'skipped', retries: 0, damageCost: 0 });
        continue;
      }

      const rawStep = plan.steps[i];
      // Sanitize command before execution (strip -it/-t flags from docker exec)
      const step = { ...rawStep, command: sanitizeDockerExec(rawStep.command) };

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

      // e. Execute command (first attempt)
      let firstResult;
      if (needsShell(step.command)) {
        firstResult = await runShellCommand(step.command, {
          timeout: deps.config.execution.commandTimeoutMs,
          maxBuffer: deps.config.execution.maxBufferBytes,
        });
      } else {
        const { executable, args } = parseCommand(step.command);
        firstResult = await deps.runner.run(executable, args, {
          timeout: deps.config.execution.commandTimeoutMs,
          maxBuffer: deps.config.execution.maxBufferBytes,
        });
      }

      // f. Handle result
      let finalResult = firstResult;
      let commandUsed = step.command;
      const hasSelfHealingDeps = deps.correctionModel && deps.skill;

      if (firstResult.exitCode !== 0 && hasSelfHealingDeps) {
        // Self-healing path: LLM-corrected retries
        // Build rich context from skill + discovery + rolling context
        const toolList = buildToolListFromSkill(deps.skill!);
        const domainKnowledge = extractSkillDomainKnowledge(deps.skill!);

        // Build container context from discovery data if available, else just names
        const discoveryParts: string[] = [];
        if (deps.discoveryContext && Object.keys(deps.discoveryContext).length > 0) {
          for (const [label, value] of Object.entries(deps.discoveryContext)) {
            discoveryParts.push(`${label}: ${value}`);
          }
        } else if ((deps.containers ?? []).length > 0) {
          discoveryParts.push(`Containers: ${(deps.containers ?? []).join(', ')}`);
        } else {
          discoveryParts.push('No containers discovered');
        }
        const containerContext = discoveryParts.join('\n');

        const healContext: SelfHealContext = {
          maxAttempts: deps.config.selfHealing?.maxAttempts ?? 5,
          budget,
          model: deps.correctionModel!,
          modelId: (deps.correctionModel as any)?.modelId ?? 'unknown',
          modelRole: deps.correctionModelRole ?? 'worker',
          skill: deps.skill!,
          runner: deps.runner,
          rewriteRules: deps.rewriteRules ?? [],
          containers: deps.containers ?? [],
          config: deps.config,
          auditLogger: deps.auditLogger,
          stepDescription: step.description,
          toolList,
          containerContext,
          stepRisk: step.risk,
          domainKnowledge: domainKnowledge || undefined,
          rollingContext: context.getContext() || undefined,
        };

        const healModelId = (deps.correctionModel as any)?.modelId ?? 'unknown';
        if (DEV_MODE) console.log(`[SELF-HEAL] Step ${i} failed, calling ${healModelId} for correction (max ${healContext.maxAttempts} attempts)...`);
        const healStart = Date.now();
        const healResult = await selfHealStep(step, firstResult, healContext);
        if (DEV_MODE) console.log(`[SELF-HEAL] ${healResult.status} in ${((Date.now() - healStart) / 1000).toFixed(1)}s — ${healResult.attempts.length} attempts`);

        if (healResult.status === 'success') {
          finalResult = healResult.finalResult!;
          commandUsed = healResult.commandUsed;
        } else {
          // Self-healing exhausted or budget exceeded -- rollback and halt
          await rollbackStep(step, snapshot, {
            runner: deps.runner,
            auditLogger: deps.auditLogger,
            config: deps.config,
          });

          const haltReason = healResult.status === 'budget_exceeded'
            ? 'self_heal_budget_exceeded'
            : 'self_heal_exhausted';

          deps.auditLogger.logExecution('self_heal_exhausted', {
            stepIndex: i,
            command: step.command,
            attempts: healResult.attempts.length,
            attemptHistory: healResult.attempts,
            escalation: healResult.escalation,
          });

          console.log(chalk.red.bold(`SELF-HEALING ${healResult.status.toUpperCase()}: Step ${i} failed after ${healResult.attempts.length} correction attempts. Plan halted.`));
          if (healResult.escalation) {
            console.log(chalk.yellow.bold(`\n⚡ ESCALATION NEEDED: ${healResult.escalation.reason}`));
            console.log(chalk.yellow(`   Model used: ${healResult.escalation.modelUsed}`));
            console.log(chalk.yellow(`   Suggestion: retry with "${healResult.escalation.suggestedRole}" model for better reasoning`));
            if (healResult.escalation.lastErrors.length > 0) {
              console.log(chalk.yellow(`   Last errors:`));
              for (const err of healResult.escalation.lastErrors) {
                console.log(chalk.yellow(`     - ${err}`));
              }
            }
          }

          stepResults.push({
            stepIndex: i,
            status: 'failed',
            runResult: healResult.finalResult ?? firstResult,
            retries: healResult.attempts.length,
            damageCost: 0,
          });

          return {
            status: 'halted',
            reason: haltReason,
            stoppedAt: i,
            stepResults,
            rollingContext: context.getContext() || undefined,
            escalation: healResult.escalation,
          };
        }
      } else if (firstResult.exitCode !== 0) {
        // Fallback: CircuitBreaker path (no self-healing deps)
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

        finalResult = cbResult.result!;
      }

      // g. Success: deduct from budget and log
      budget.deduct(cost);

      deps.auditLogger.logExecution('step_complete', {
        stepIndex: i,
        command: commandUsed,
        exitCode: finalResult.exitCode,
      });

      console.log(chalk.dim(`Budget: ${budget.spent}/${budget.total} used`));

      // g2. Track config modifications for post-restart verification
      if (isConfigModification(commandUsed)) {
        configModifications.push({ stepIndex: i, command: commandUsed, stepDescription: step.description });
      }

      // g3. On restart step, verify tracked config modifications persisted
      if (isRestartStep(commandUsed) && configModifications.length > 0 && hasSelfHealingDeps) {
        const delayMs = deps.config.selfHealing?.restartVerificationDelayMs ?? 3000;
        if (DEV_MODE) console.log(`[SELF-HEAL] Restart detected — verifying ${configModifications.length} config change(s) persist after ${delayMs}ms...`);

        // Build healContext mirroring the self-healing path above
        const toolList = buildToolListFromSkill(deps.skill!);
        const domainKnowledge = extractSkillDomainKnowledge(deps.skill!);
        const discoveryParts: string[] = [];
        if (deps.discoveryContext && Object.keys(deps.discoveryContext).length > 0) {
          for (const [label, value] of Object.entries(deps.discoveryContext)) {
            discoveryParts.push(`${label}: ${value}`);
          }
        } else if ((deps.containers ?? []).length > 0) {
          discoveryParts.push(`Containers: ${(deps.containers ?? []).join(', ')}`);
        } else {
          discoveryParts.push('No containers discovered');
        }
        const containerContext = discoveryParts.join('\n');

        const healContext: SelfHealContext = {
          maxAttempts: deps.config.selfHealing?.maxAttempts ?? 5,
          budget,
          model: deps.correctionModel!,
          modelId: (deps.correctionModel as any)?.modelId ?? 'unknown',
          modelRole: deps.correctionModelRole ?? 'worker',
          skill: deps.skill!,
          runner: deps.runner,
          rewriteRules: deps.rewriteRules ?? [],
          containers: deps.containers ?? [],
          config: deps.config,
          auditLogger: deps.auditLogger,
          stepDescription: step.description,
          toolList,
          containerContext,
          stepRisk: step.risk,
          domainKnowledge: domainKnowledge || undefined,
          rollingContext: context.getContext() || undefined,
        };

        const persistResults = await verifyPersistence(configModifications, healContext, delayMs);
        const reverted = persistResults.filter(r => r.reverted);

        if (reverted.length > 0) {
          if (DEV_MODE) console.log(`[SELF-HEAL] ${reverted.length} config change(s) REVERTED after restart — re-executing through self-healer...`);

          for (const rev of reverted) {
            deps.auditLogger.logExecution('config_reverted_after_restart', {
              stepIndex: rev.configMod.stepIndex,
              command: rev.configMod.command,
            });

            // Re-execute the config modification step through self-healer
            const reStep = {
              ...plan.steps[rev.configMod.stepIndex],
              command: rev.configMod.command,
              description: `${rev.configMod.stepDescription} (RETRY: previous change reverted after container restart — use persistent approach e.g. sed -i, write to config file directly)`,
            };
            const reResult = await selfHealStep(
              reStep,
              { stdout: '', stderr: 'Config change reverted after container restart', exitCode: 1 },
              healContext,
            );

            if (reResult.status !== 'success') {
              // Log but don't halt — the original step already succeeded, this is a bonus verification
              if (DEV_MODE) console.log(`[SELF-HEAL] Persistence fix FAILED for step ${rev.configMod.stepIndex} — fix may not survive restart`);
              deps.auditLogger.logExecution('persistence_fix_failed', {
                stepIndex: rev.configMod.stepIndex,
                command: rev.configMod.command,
                attempts: reResult.attempts.length,
              });
            } else {
              if (DEV_MODE) console.log(`[SELF-HEAL] Persistence fix SUCCESS for step ${rev.configMod.stepIndex}`);
            }
          }

          // Clear config modifications after handling
          configModifications.length = 0;
        }
      }

      stepResults.push({
        stepIndex: i,
        status: 'success',
        runResult: finalResult,
        retries: 0,
        damageCost: cost,
      });

      // h. Add result to rolling context (use actual command, not original)
      const contextStep = commandUsed !== step.command
        ? { ...step, command: commandUsed }
        : step;
      context.addStepResult(i, contextStep, finalResult);
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
