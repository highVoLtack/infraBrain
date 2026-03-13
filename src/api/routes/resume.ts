import { Router } from 'express';
import type { WriteThrough } from '../../state/store.js';
import type { InfraBrainConfig } from '../../config/types.js';
import type { AuditLogger } from '../../audit/logger.js';
import type { LLMProvider } from '../../llm/types.js';
import type { RunResult } from '../../execution/types.js';
import { executePlan, type ResumeOptions } from '../../execution/executor.js';
import { runCommand } from '../../execution/runner.js';
import type { FixPlan } from '../../orchestrator/types.js';

export interface ResumeRouteDeps {
  store: WriteThrough;
  config: InfraBrainConfig;
  auditLogger: AuditLogger;
  sessionId: string;
  sessionDir: string;
  provider?: LLMProvider;
}

/**
 * Create the /resume route.
 * Accepts { sessionId, action: 'retry' | 'skip' } to resume an interrupted fix plan.
 */
export function createResumeRoute(deps: ResumeRouteDeps): Router {
  const router = Router();

  router.post('/', async (req, res, next) => {
    try {
      const { sessionId, action } = req.body ?? {};

      if (!sessionId || typeof sessionId !== 'string') {
        res.status(400).json({ error: 'sessionId is required' });
        return;
      }

      if (!action || (action !== 'retry' && action !== 'skip')) {
        res.status(400).json({ error: 'action must be "retry" or "skip"' });
        return;
      }

      // Load session
      const session = deps.store.getSessionById(sessionId);
      if (!session) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }

      // Check if session is resumable
      if (!session.resumeMetadata || !session.currentPlan) {
        res.status(400).json({ error: 'No resumable plan in session' });
        return;
      }

      // Check for stale session
      let warning: string | undefined;
      const stoppedAtMs = new Date(session.resumeMetadata.stoppedAt).getTime();
      const ageMs = Date.now() - stoppedAtMs;
      if (ageMs > deps.config.resumeWindowMs) {
        const ageHours = Math.round(ageMs / 3600000);
        const ageStr = ageHours >= 24 ? `${Math.round(ageHours / 24)}d` : `${ageHours}h`;
        warning = `This plan is ${ageStr} old. Infrastructure state may have changed.`;
      }

      // Determine resume point
      const startFromStep = session.resumeMetadata.lastCompletedStep + 1;
      const skipFailedStep = action === 'skip';
      const target = session.resumeMetadata.target ?? 'unknown';

      // Convert session plan steps to FixPlan format for executor
      const fixPlan: FixPlan = {
        summary: session.currentPlan.description,
        steps: session.currentPlan.steps.map((step) => ({
          command: step.command,
          description: step.description,
          rollback: '',
          risk: (step.riskLevel ?? 'read') as 'read' | 'write' | 'destructive',
        })),
        complexity: 'moderate',
      };

      const resumeOptions: ResumeOptions = { startFromStep, skipFailedStep };

      // Build runner from real command execution (same pattern as execute route)
      const runner = {
        run: (executable: string, args: string[], options: { timeout: number; maxBuffer?: number }): Promise<RunResult> => {
          return runCommand(executable, args, options);
        },
      };

      // Build onBeforeStep callback for rolling context injection when provider exists
      const onBeforeStep = deps.provider
        ? async (stepIndex: number, rollingContext: string): Promise<void> => {
            deps.auditLogger.logExecution('context_injection', {
              stepIndex,
              contextLength: rollingContext.length,
              contextPreview: rollingContext.substring(0, 200),
              resumed: true,
            });
          }
        : undefined;

      // Execute with resume
      const result = await executePlan(fixPlan, target, {
        runner,
        requestApproval: async () => ({ approved: true }),
        auditLogger: deps.auditLogger as any,
        config: deps.config,
        sessionId: deps.sessionId,
        sessionDir: deps.sessionDir,
        onBeforeStep,
      }, resumeOptions);

      const response: Record<string, unknown> = {
        status: result.status,
        sessionId,
        resumedFrom: startFromStep,
        action,
        stepResults: result.stepResults,
        session: {
          sessionId: session.sessionId,
          currentPlan: session.currentPlan,
          resumeMetadata: session.resumeMetadata,
          status: session.status,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
        },
      };

      if (warning) {
        response.warning = warning;
      }

      res.json(response);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
