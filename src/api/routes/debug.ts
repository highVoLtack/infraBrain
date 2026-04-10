import { Router } from 'express';
import type { LLMProvider } from '../../llm/types.js';
import type { AuditLogger } from '../../audit/logger.js';
import type { ValidationResult } from '../../safety/types.js';
import type { SkillRegistry } from '../../skills/registry.js';
import type { WriteThrough } from '../../state/store.js';
import type { InfraBrainConfig } from '../../config/types.js';
import { v7 as uuidv7 } from 'uuid';
import { runDPEV } from '../../orchestrator/pipeline.js';
import {
  preFilterIfLogHeavy,
  extractCommands,
} from '../../orchestrator/diagnosis.js';

// Backward-compatible re-exports so existing test imports still work
export { checkForHallucinations, preFilterIfLogHeavy, enforceDPEVSequence } from '../../orchestrator/diagnosis.js';
export type { DPEVPhase } from '../../orchestrator/diagnosis.js';

/**
 * Create the /debug route.
 * Thin HTTP handler that delegates to the DPEV pipeline orchestrator.
 */
export interface DebugRouteDeps {
  store?: WriteThrough;
  config?: InfraBrainConfig;
  sessionId?: string;
}

export function createDebugRoute(
  provider: LLMProvider,
  auditLogger: AuditLogger,
  validator: (command: string) => ValidationResult,
  registry?: SkillRegistry,
  extraDeps?: DebugRouteDeps,
): Router {
  const router = Router();

  router.post('/', async (req, res, next) => {
    try {
      const { prompt, skill: skillOverride, noCache } = req.body ?? {};

      if (!prompt || typeof prompt !== 'string') {
        res.status(400).json({ error: 'prompt is required' });
        return;
      }

      // Auto-detect incomplete sessions for resume prompt
      let incompleteSession: {
        sessionId: string;
        target?: string;
        stoppedAtStep: number;
        totalSteps: number;
        stoppedAt: string;
      } | undefined;

      if (extraDeps?.store && extraDeps?.config) {
        const incomplete = extraDeps.store.getIncompleteSessions(extraDeps.config.resumeWindowMs);
        if (incomplete.length > 0) {
          const first = incomplete[0];
          if (first.resumeMetadata && first.currentPlan) {
            incompleteSession = {
              sessionId: first.sessionId,
              target: first.resumeMetadata.target,
              stoppedAtStep: first.resumeMetadata.lastCompletedStep + 1,
              totalSteps: first.currentPlan.steps.length,
              stoppedAt: first.resumeMetadata.stoppedAt,
            };
          }
        }
      }

      const sessionId = extraDeps?.sessionId ?? uuidv7();

      // Use DPEV pipeline when registry has skills
      if (registry && registry.list().length > 0) {
        try {
          const result = await runDPEV({
            prompt,
            skillOverride: skillOverride as string | undefined,
            provider,
            registry,
            auditLogger,
            validator,
            store: extraDeps?.store,
            config: extraDeps?.config,
            sessionId,
            noCache: noCache === true,
          });

          // Translate hallucinationError to HTTP 422
          if (result.hallucinationError) {
            res.status(422).json({
              error: 'Diagnosis failed sanity check: LLM output contains hallucinated placeholders or example data',
              violations: result.hallucinationError.violations,
              hint: result.hallucinationError.hint,
            });
            return;
          }

          res.json({
            ...result,
            ...(incompleteSession && { incompleteSession }),
          });
          return;
        } catch (skillErr) {
          // Graceful degradation: fall through to direct LLM call
          auditLogger.logError(`Skill selection failed, falling back to direct LLM: ${(skillErr as Error).message}`);
        }
      }

      // Fallback: direct LLM call (no skills loaded or skill selection failed)
      const systemPrompt = 'You are an infrastructure diagnostic assistant. Analyze the issue and suggest specific commands to investigate or resolve it. Prefix commands with "Command:" on their own line.';
      const { filtered: fallbackPrompt } = preFilterIfLogHeavy(prompt);
      const diagnosis = await provider.generateCommand(fallbackPrompt, systemPrompt);

      // Extract and validate commands
      const extractedCommands = extractCommands(diagnosis);
      const commands = extractedCommands.map((cmd) => {
        const result = validator(cmd);
        auditLogger.logCommandValidation(cmd, result.riskLevel, result.allowed, result.reason);
        return {
          command: cmd,
          riskLevel: result.riskLevel,
          allowed: result.allowed,
          reason: result.reason,
        };
      });

      auditLogger.logDecision(
        `Debug request: "${prompt}"`,
        [`Generated ${extractedCommands.length} commands`],
        'diagnosis_complete',
      );

      res.json({ sessionId, diagnosis, commands, ...(incompleteSession && { incompleteSession }) });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
