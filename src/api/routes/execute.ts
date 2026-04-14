import { Router } from 'express';
import type { AuditLogger } from '../../audit/logger.js';
import type { InfraBrainConfig, ModelMapEntry } from '../../config/types.js';
import type { RunResult } from '../../execution/types.js';
import type { LLMProvider } from '../../llm/types.js';
import type { SkillRegistry } from '../../skills/registry.js';
import type { WriteThrough } from '../../state/store.js';
import type { SessionState } from '../../state/types.js';
import { FixPlanSchema } from '../../orchestrator/types.js';
import { executePlan } from '../../execution/executor.js';
import { runCommand, parseCommand } from '../../execution/runner.js';
import { toolsToRewriteRules } from '../../execution/dynamic-rewriter.js';
import { storeFixInCache, recordFixOutcome } from '../../cache/cache-lookup.js';
import { getCacheStore } from '../../cache/lance-store.js';
import { DEFAULT_CACHE_CONFIG } from '../../cache/types.js';
import { getIncidentStore } from '../../memory/incident-store.js';
import { getEntityStore } from '../../memory/entity-store.js';
import { getMemoryWAL } from '../../memory/wal.js';
import { extractEntitiesForGraph } from '../../memory/entity-extractor.js';
import { formatIncidentEmbeddingInput } from '../../memory/memory-search.js';
import { generateEmbedding } from '../../cache/embedder.js';

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
      // Self-healer uses strategic model for corrections — needs reasoning ability
      // to understand errors and generate alternative commands (worker models lack this)
      const correctionModel = deps.provider?.registry?.get?.('strategic')
        ?? deps.provider?.registry?.get?.('default')
        ?? undefined;
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
          correctionModelRole: 'strategic',
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

      // Cache write: store successful fix and record outcome
      // Cache operations are non-critical -- wrapped in try-catch to never affect execution response
      try {
        const cacheEnabled = deps.config.cache?.enabled !== false;
        if (cacheEnabled) {
          const cacheDataDir = deps.config.cache?.dataDir ?? DEFAULT_CACHE_CONFIG.data_dir;
          const cacheStore = getCacheStore(cacheDataDir);
          await cacheStore.init();

          // Resolve embedding model config
          const embeddingEntry = deps.config.modelMap?.embedding as ModelMapEntry | undefined;
          const embeddingBaseURL = typeof embeddingEntry === 'object' && embeddingEntry !== null
            ? (embeddingEntry as { baseUrl: string }).baseUrl
            : (deps.config.defaultBaseUrl ?? 'http://localhost:11434/v1');
          const embeddingModelId = typeof embeddingEntry === 'string'
            ? embeddingEntry
            : typeof embeddingEntry === 'object' && embeddingEntry !== null
              ? (embeddingEntry as { model: string }).model
              : 'bge-m3';

          // Store successful fix in cache for future lookups
          if (result.status === 'completed' && skillName) {
            await storeFixInCache({
              prompt: req.body.prompt ?? '',
              filteredDiscovery: discoveryContext ?? {},
              diagnosis: req.body.diagnosis ?? '',
              fixPlan: planResult.data,
              skillName: String(skillName),
              sessionId: String(sessionId),
              store: cacheStore,
              baseURL: embeddingBaseURL,
              modelId: embeddingModelId,
            });
          }

          // Record fix outcome if a cache entry was used (passed through from cacheHit)
          const cacheEntryId = req.body.cacheEntryId;
          if (cacheEntryId && typeof cacheEntryId === 'string') {
            await recordFixOutcome(cacheStore, cacheEntryId, result.status === 'completed');
          }
        }
      } catch (cacheErr) {
        // Cache write failure is non-critical -- log and continue
        if (process.env.NODE_ENV !== 'production') {
          console.error('[CACHE] Post-execution cache write failed:', cacheErr);
        }
      }

      // Memory filing: store incident after successful execution (MEM-01)
      // Memory operations are non-critical -- wrapped in try-catch per CONTEXT.md constraint
      try {
        const memoryEnabled = deps.config.memory?.enabled !== false;
        if (memoryEnabled && result.status === 'completed') {
          const memDataDir = deps.config.memory?.dataDir ?? '.infrabrain/memory';
          const incidentStore = getIncidentStore(memDataDir);
          const entityStore = getEntityStore(memDataDir);
          const wal = getMemoryWAL(memDataDir);

          // Resolve embedding params (same pattern as cache block above)
          const embeddingEntry = deps.config.modelMap?.embedding as ModelMapEntry | undefined;
          const memEmbeddingBaseURL = typeof embeddingEntry === 'object' && embeddingEntry !== null
            ? (embeddingEntry as { baseUrl: string }).baseUrl
            : (deps.config.defaultBaseUrl ?? 'http://localhost:11434/v1');
          const memEmbeddingModelId = typeof embeddingEntry === 'string'
            ? embeddingEntry
            : typeof embeddingEntry === 'object' && embeddingEntry !== null
              ? (embeddingEntry as { model: string }).model
              : 'bge-m3';

          // Use structured rootCause from DPEVResult when available.
          // req.body.diagnosis is the full free-text diagnosis -- use it for the diagnosis field.
          // structuredDiagnosis.rootCause is a one-sentence root cause -- use it for root_cause field.
          // Fallback: planResult.data.summary (fix description) if no structured diagnosis provided.
          const structuredDiag = req.body.structuredDiagnosis;
          const rootCause = structuredDiag?.rootCause ?? planResult.data.summary;
          const diagnosisText = req.body.diagnosis ?? '';
          const services = req.body.containers ? JSON.stringify(req.body.containers) : '[]';

          // Format for embedding: rootCause and diagnosis are now semantically distinct
          const embeddingText = formatIncidentEmbeddingInput(rootCause, services, diagnosisText);
          const vector = await generateEmbedding(embeddingText, memEmbeddingBaseURL, memEmbeddingModelId);

          if (vector) {
            // WAL first, then store (MEM-09: audit trail before mutation)
            wal.append({
              type: 'incident_add',
              timestamp: new Date().toISOString(),
              sessionId: String(sessionId),
              details: { skillName: String(skillName), outcome: result.status },
            });

            const incidentId = await incidentStore.add({
              session_id: String(sessionId),
              wing: 'wing_incidents',
              prompt: req.body.prompt ?? '',
              diagnosis: diagnosisText,
              root_cause: rootCause,
              fix_summary: planResult.data.summary,
              outcome: result.status as 'completed' | 'halted' | 'failed',
              skill_name: String(skillName),
              created_at: new Date().toISOString(),
              containers: JSON.stringify(req.body.containers ?? []),
              services: services,
              error_codes: '[]',
              expert_domain: '',
            }, vector);

            // Extract and file entities for knowledge graph (MEM-03, MEM-06)
            if (incidentId) {
              const discoveryCtx = req.body.discoveryContext ?? {};
              const entities = extractEntitiesForGraph(
                typeof discoveryCtx === 'object' ? discoveryCtx : {},
                diagnosisText,
                incidentId,
              );

              for (const entity of entities) {
                wal.append({
                  type: 'entity_add',
                  timestamp: new Date().toISOString(),
                  sessionId: String(sessionId),
                  details: { entityType: entity.entity_type, entityValue: entity.entity_value, incidentId },
                });

                // Embed entity with context for richer vectors (per RESEARCH.md open question 2)
                const entityText = `${entity.entity_type}: ${entity.entity_value} (${entity.relationship_type} incident)`;
                const entityVector = await generateEmbedding(entityText, memEmbeddingBaseURL, memEmbeddingModelId);
                if (entityVector) {
                  await entityStore.add(entity, entityVector);
                }
              }
            }
          }
        }
      } catch (memErr) {
        // Memory filing failure is non-critical -- log and continue
        if (process.env.NODE_ENV !== 'production') {
          console.error('[MEMORY] Incident filing failed:', memErr);
        }
      }

      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
