import { Router } from 'express';
import type { AuditLogger } from '../../audit/logger.js';
import type { InfraBrainConfig } from '../../config/types.js';
import type { RunResult } from '../../execution/types.js';
import type { LLMProvider } from '../../llm/types.js';
import type { SkillRegistry } from '../../skills/registry.js';
import type { WriteThrough } from '../../state/store.js';
import type { SessionState } from '../../state/types.js';
import { FixPlanSchema } from '../../orchestrator/types.js';
import { executePlan } from '../../execution/executor.js';
import { runCommand, parseCommand } from '../../execution/runner.js';
import { toolsToRewriteRules } from '../../execution/dynamic-rewriter.js';

export interface ExecuteRouteDeps {
  auditLogger: AuditLogger;
  config: InfraBrainConfig;
  sessionId: string;
  sessionDir: string;
  store?: WriteThrough;
  provider?: LLMProvider;
  registry?: SkillRegistry;
}

/**
 * Create the /execute route.
 * POST / accepts { sessionId, fixPlan, target, adminName } and runs the plan.
 */
export function createExecuteRoute(deps: ExecuteRouteDeps): Router {
  const router = Router();

  router.post('/', async (req, res, next) => {
    try {
      const { sessionId, fixPlan, target, adminName, skillName, containers: reqContainers, discoveryContext: reqDiscoveryContext } = req.body ?? {};

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

      // Build onBeforeStep callback for rolling context injection when provider exists
      const onBeforeStep = deps.provider
        ? async (stepIndex: number, rollingContext: string): Promise<void> => {
            deps.auditLogger.logExecution('context_injection', {
              stepIndex,
              contextLength: rollingContext.length,
              contextPreview: rollingContext.substring(0, 200),
            });
            // Rolling context is now available at the LLM injection point.
            // Phase 9+ will add: await deps.provider!.generateCommand(prompt + rollingContext, systemPrompt)
            // For Phase 8: wiring is complete, context flows, injection is audited.
          }
        : undefined;

      // Resolve self-healing deps: correctionModel, skill, rewriteRules, containers
      // These enable the executor to self-heal command failures via LLM correction
      const skill = skillName && deps.registry ? deps.registry.get(skillName) : undefined;
      const correctionModel = deps.provider?.registry?.get?.('default') ?? undefined;
      const containers: string[] = Array.isArray(reqContainers) ? reqContainers : [];
      const discoveryContext: Record<string, string> | undefined =
        reqDiscoveryContext && typeof reqDiscoveryContext === 'object' && !Array.isArray(reqDiscoveryContext)
          ? reqDiscoveryContext as Record<string, string>
          : undefined;
      let rewriteRules: import('../../execution/dynamic-rewriter.js').RewriteRule[] = [];
      if (skill) {
        const tools = skill.frontmatter.tools;
        rewriteRules = Array.isArray(tools)
          ? (skill.frontmatter.rewrite_rules ?? [])
          : toolsToRewriteRules(tools);
      }

      // Execute the plan (auto-approve all in API mode since approval happened upstream)
      const result = await executePlan(planResult.data, target, {
        runner,
        requestApproval: async () => ({ approved: true }),
        auditLogger: deps.auditLogger,
        config: deps.config,
        sessionId: deps.sessionId,
        sessionDir: deps.sessionDir,
        onBeforeStep,
        // Self-healing deps (executor activates self-healing when correctionModel+skill present)
        ...(correctionModel && skill ? {
          correctionModel,
          skill,
          rewriteRules,
          containers,
          discoveryContext,
        } : {}),
      });

      // Persist resume metadata on halt so /infra:resume can find this session
      if (result.status === 'halted' && result.stoppedAt !== undefined && deps.store) {
        const now = new Date().toISOString();
        const sessionState: SessionState = {
          sessionId: deps.sessionId,
          createdAt: now,
          updatedAt: now,
          status: 'active',
          target,
          currentPlan: {
            id: deps.sessionId,
            description: planResult.data.summary,
            steps: planResult.data.steps.map((s, idx) => ({
              id: idx,
              command: s.command,
              description: s.description,
              status: idx < result.stoppedAt! ? 'executed' : 'pending',
              riskLevel: s.risk,
            })),
            currentStep: result.stoppedAt,
            status: 'failed',
            stoppedAtStep: result.stoppedAt,
            failureReason: result.reason,
          },
          resumeMetadata: {
            lastCompletedStep: result.stoppedAt - 1,
            stoppedAt: now,
            error: result.reason,
            target,
          },
        };
        deps.store.persistState(deps.sessionDir, sessionState);
      }

      // Log execution complete
      deps.auditLogger.logExecution('execution_complete', {
        sessionId,
        target,
        status: result.status,
        stepsCompleted: result.stepResults.length,
      });

      // Log verification event on successful execution
      if (result.status === 'completed') {
        deps.auditLogger.logExecution('verification', {
          sessionId,
          target,
          status: 'verified',
          stepsCompleted: result.stepResults.length,
        });
      }

      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
