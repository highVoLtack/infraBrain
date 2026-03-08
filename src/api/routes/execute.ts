import { Router } from 'express';
import type { AuditLogger } from '../../audit/logger.js';
import type { InfraBrainConfig } from '../../config/types.js';
import type { RunResult } from '../../execution/types.js';
import { FixPlanSchema } from '../../orchestrator/types.js';
import { executePlan } from '../../execution/executor.js';
import { runCommand, parseCommand } from '../../execution/runner.js';

export interface ExecuteRouteDeps {
  auditLogger: AuditLogger;
  config: InfraBrainConfig;
  sessionId: string;
  sessionDir: string;
}

/**
 * Create the /execute route.
 * POST / accepts { sessionId, fixPlan, target, adminName } and runs the plan.
 */
export function createExecuteRoute(deps: ExecuteRouteDeps): Router {
  const router = Router();

  router.post('/', async (req, res, next) => {
    try {
      const { sessionId, fixPlan, target, adminName } = req.body ?? {};

      // Validate input
      if (!sessionId || typeof sessionId !== 'string') {
        res.status(400).json({ error: 'sessionId is required' });
        return;
      }
      if (!target || typeof target !== 'string') {
        res.status(400).json({ error: 'target is required' });
        return;
      }
      if (!adminName || typeof adminName !== 'string') {
        res.status(400).json({ error: 'adminName is required' });
        return;
      }

      // Validate fixPlan against schema
      const planResult = FixPlanSchema.safeParse(fixPlan);
      if (!planResult.success) {
        res.status(400).json({ error: 'Invalid fixPlan', details: planResult.error.issues });
        return;
      }

      // Log execution start
      deps.auditLogger.logExecution('execution_start', {
        sessionId,
        target,
        adminName,
        planSummary: planResult.data.summary,
      });

      // Build runner from real command execution
      const runner = {
        run: (executable: string, args: string[], options: { timeout: number; maxBuffer?: number }): Promise<RunResult> => {
          return runCommand(executable, args, options);
        },
      };

      // Execute the plan (auto-approve all in API mode since approval happened upstream)
      const result = await executePlan(planResult.data, target, {
        runner,
        requestApproval: async () => ({ approved: true }),
        auditLogger: deps.auditLogger,
        config: deps.config,
        sessionId: deps.sessionId,
        sessionDir: deps.sessionDir,
      });

      // Log execution complete
      deps.auditLogger.logExecution('execution_complete', {
        sessionId,
        target,
        status: result.status,
        stepsCompleted: result.stepResults.length,
      });

      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
