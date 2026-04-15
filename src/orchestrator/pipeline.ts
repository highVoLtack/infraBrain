import type { LLMProvider } from '../llm/types.js';
import type { ModelRole } from '../config/types.js';
import { resolveEmbeddingConfig } from '../config/types.js';
import type { AuditLogger } from '../audit/logger.js';
import type { ValidationResult } from '../safety/types.js';
import type { SkillRegistry } from '../skills/registry.js';
import type { SkillFile } from '../skills/types.js';
import type { WriteThrough } from '../state/store.js';
import type { InfraBrainConfig } from '../config/types.js';
import type { FixPlan, StructuredDiagnosis } from './types.js';
import type { InferenceScheduler } from './inference-scheduler.js';
import type { InferenceTask } from './inference-types.js';
import { checkCache } from '../cache/cache-lookup.js';
import { getCacheStore } from '../cache/lance-store.js';
import type { CacheStore } from '../cache/lance-store.js';
import { DEFAULT_CACHE_CONFIG, DEFAULT_CONFIDENCE_CONFIG } from '../cache/types.js';
import { getIncidentStore } from '../memory/incident-store.js';
import { getEntityStore } from '../memory/entity-store.js';
import { buildWakeUpContext } from '../memory/wake-up.js';
import type { MemoryConfig } from '../memory/types.js';

import { selectSkill } from './router.js';
import { generateFixPlan, generatePlanMarkdown, formatPlanTable } from './planner.js';
import { buildMessages } from './context.js';
import { enforceSkillAllowlist } from '../skills/allowlist.js';
import { extractTarget } from '../cli/approval.js';
import { findDbContainer } from '../execution/runner.js';
import { toolsToRewriteRules } from '../execution/dynamic-rewriter.js';
import { runParallelDiscovery } from './discovery.js';
import { encodeForLLM, measureSavings } from '../llm/toon-encoder.js';
import { ContextManager } from '../context/context-manager.js';
import { filterNoise } from '../context/noise-filter.js';
import {
  enforceDPEVSequence,
  preFilterIfLogHeavy,
  extractCommands,
  extractContainerNames,
  validatePlanNames,
  runDiagnosis,
  type DPEVPhase,
} from './diagnosis.js';

const DEV_MODE = process.env.NODE_ENV !== 'production';

// ---------------------------------------------------------------------------
// Pipeline Types
// ---------------------------------------------------------------------------

export interface DPEVInput {
  prompt: string;
  skillOverride?: string;
  provider: LLMProvider;
  registry?: SkillRegistry;
  auditLogger: AuditLogger;
  validator: (command: string) => ValidationResult;
  store?: WriteThrough;
  config?: InfraBrainConfig;
  sessionId?: string;
  noCache?: boolean;
  /** Optional InferenceScheduler for parallel dispatch. When absent, pipeline uses sequential mode (current behavior). */
  inferenceScheduler?: InferenceScheduler;
  /** Optional event callback for SSE streaming. When provided, pipeline emits events at each phase transition. */
  onEvent?: (event: string, data: unknown) => void;
  /** Optional callback to request cache hit approval from the client. Returns true to use cache, false to re-diagnose. */
  requestCacheApproval?: (provenance: CacheHitProvenance) => Promise<boolean>;
}

export interface CacheHitProvenance {
  similarity: number;
  confidence: number;
  originalSessionId: string;
  originalDate: string;
  skillName: string;
}

export interface DPEVResult {
  sessionId: string;
  skillMessage?: string;
  diagnosis: string;
  structuredDiagnosis?: StructuredDiagnosis;
  commands: Array<{ command: string; riskLevel: string; allowed: boolean; reason?: string }>;
  discovery?: Record<string, string>;
  fixPlan?: FixPlan;
  planMarkdown?: string;
  planTable?: string;
  target?: string;
  skillName: string;
  containers?: string[];
  executeHint?: string;
  hallucinationError?: { violations: string[]; hint: string };
  cacheHit?: CacheHitProvenance;
}

// ---------------------------------------------------------------------------
// Pipeline Orchestrator
// ---------------------------------------------------------------------------

/**
 * Run the full DPEV pipeline: Discovery -> Diagnosis -> Planning.
 *
 * Execution is NOT included -- it remains triggered separately via the /execute route
 * to preserve serial execution with safety gates (EXEC-03).
 *
 * Returns a DPEVResult containing all diagnosis, plan, and command data.
 * If hallucination check fails, returns hallucinationError for the HTTP handler to translate to 422.
 */
export async function runDPEV(input: DPEVInput): Promise<DPEVResult> {
  const {
    prompt,
    skillOverride,
    provider,
    registry,
    auditLogger,
    validator,
  } = input;

  // DPEV sequence tracking
  const completedPhases: DPEVPhase[] = [];

  let systemPrompt = 'You are an infrastructure diagnostic assistant. Analyze the issue and suggest specific commands to investigate or resolve it. Prefix commands with "Command:" on their own line.';

  // Skill selection
  const triageModel = provider.registry?.get?.('triage') ?? provider.model;
  const triageModelId = (triageModel as any)?.modelId ?? 'unknown';
  if (DEV_MODE) console.log(`[TRIAGE] Selecting skill via ${triageModelId}...`);
  const triageStart = Date.now();

  const selection = await selectSkill({
    model: triageModel,
    userInput: prompt,
    registry: registry!,
    skillOverride: skillOverride as string | undefined,
  });
  if (DEV_MODE) console.log(`[TRIAGE] Selected "${selection.skill.frontmatter.name}" in ${((Date.now() - triageStart) / 1000).toFixed(1)}s`);

  const skillMessage = `Using skill: ${selection.skill.frontmatter.name} -- ${selection.reasoning}`;
  auditLogger.logSkillSelection(
    selection.skill.frontmatter.name,
    selection.reasoning,
    !!skillOverride,
  );

  // Routing: resolve preferred_model from skill frontmatter
  const preferredRole = selection.skill.frontmatter.preferred_model as ModelRole | undefined;
  if (preferredRole && preferredRole !== 'default') {
    const resolvedModel = provider.registry.get(preferredRole);
    const defaultModel = provider.registry.getDefault();
    const resolvedId = (resolvedModel as any).modelId ?? 'unknown';
    const defaultId = (defaultModel as any).modelId ?? 'unknown';

    const sameModel = resolvedModel === defaultModel || (resolvedId === defaultId && resolvedId !== 'unknown');

    if (sameModel) {
      console.log(`[ROUTING] WARN: skill "${selection.skill.frontmatter.name}" prefers role "${preferredRole}" but it resolves to default model "${defaultId}". Continuing with default. Configure modelMap.${preferredRole} for optimal results.`);
    } else {
      console.log(`[ROUTING] Skill "${selection.skill.frontmatter.name}" routed to ${preferredRole} model: ${resolvedId} (default: ${defaultId})`);
    }
  }

  // Run parallel discovery commands to get ground truth BEFORE LLM call
  const discoveryCommands = selection.skill.frontmatter.discovery ?? [];
  if (DEV_MODE) console.log(`[DISCOVERY] Running ${discoveryCommands.length} discovery commands...`);
  const discoveryStart = Date.now();
  const { context: discoveryContext, raw: discoveryRaw } = await runParallelDiscovery(discoveryCommands);

  if (DEV_MODE) {
    console.log(`[DISCOVERY] Complete in ${((Date.now() - discoveryStart) / 1000).toFixed(1)}s`);
    const savings = measureSavings(discoveryRaw);
    console.log(`[DEV] TOON Discovery: ${savings.jsonTokens} (JSON) -> ${savings.toonTokens} (TOON) | Saved: ${savings.savingsPercent.toFixed(1)}%`);
  }

  // DPEV: discovery phase complete
  completedPhases.push('discovery');

  // Emit discovery phase events via SSE when streaming
  input.onEvent?.('dpev:phase', { phase: 'discovery', model: triageModelId, status: 'complete' });

  if (discoveryContext) {
    auditLogger.logExecution('discovery_complete', {
      skill: selection.skill.frontmatter.name,
      discoveredData: discoveryRaw,
    });
  }

  // Use skill's system prompt
  const { system } = buildMessages(selection.skill, prompt);
  systemPrompt = system;

  // --- Shared setup for both parallel and sequential paths ---
  const workerModel = provider.registry?.get?.('worker');
  const skillNoisePatterns = selection.skill.frontmatter.noise_patterns ?? [];

  // Extract containers and rewrite rules BEFORE diagnosis so both paths can use them
  const allContainers = extractContainerNames(discoveryRaw);
  const tools = selection.skill.frontmatter.tools;
  const rewriteRules = Array.isArray(tools)
    ? (selection.skill.frontmatter.rewrite_rules ?? [])
    : toolsToRewriteRules(tools);

  // For DB skills, prioritize the DB container at the front of the list
  const dbContainer = findDbContainer(allContainers);
  const targetContainers = dbContainer
    ? [dbContainer, ...allContainers.filter(c => c !== dbContainer)]
    : allContainers;

  // --- Resolve embedding model config (shared by cache check + memory enrichment) ---
  const embCfg = input.config ? resolveEmbeddingConfig(input.config) : { baseURL: 'http://localhost:11434/v1', modelId: 'bge-m3' };
  const embeddingBaseURL = embCfg.baseURL;
  const embeddingModelId = embCfg.modelId;
  const embeddingApiKey = embCfg.apiKey;

  // ContextManager used by both paths
  const contextManager = new ContextManager(
    {
      windowSize: input.config?.contextWindow ?? 32768,
      threshold: 0.83,
      target: 0.60,
      groundTruthCap: 0.20,
    },
    input.config?.sessionDir,
    input.sessionId,
  );

  // ---------------------------------------------------------------------------
  // Determine execution mode: parallel or sequential
  // ---------------------------------------------------------------------------
  let useParallelPath = false;
  if (input.inferenceScheduler) {
    await input.inferenceScheduler.probeBackends();
    const mode = input.inferenceScheduler.getMode();
    useParallelPath = mode === 'parallel';
    if (DEV_MODE) console.log(`[PARALLEL] InferenceScheduler mode: ${mode}`);
  }

  // ---------------------------------------------------------------------------
  // PARALLEL PATH: 9B preprocess + 122B diagnosis run concurrently
  // ---------------------------------------------------------------------------
  let diagnosis: string;
  let structuredDiagnosis: StructuredDiagnosis | undefined;

  if (useParallelPath && input.inferenceScheduler) {
    const scheduler = input.inferenceScheduler;

    // --- Cache check with raw discovery (noise filter hasn't run yet) ---
    if (!input.noCache) {
      let cacheStore: CacheStore | null = null;
      const cacheEnabled = input.config?.cache?.enabled !== false;
      if (cacheEnabled) {
        try {
          cacheStore = getCacheStore(input.config?.cache?.dataDir ?? DEFAULT_CACHE_CONFIG.data_dir);
          await cacheStore.init();
        } catch { cacheStore = null; }
      }

      const cacheResult = await checkCache({
        prompt,
        filteredDiscovery: discoveryRaw,
        store: cacheStore,
        baseURL: embeddingBaseURL,
        modelId: embeddingModelId,
        apiKey: embeddingApiKey,
        cacheConfig: {
          enabled: cacheEnabled,
          similarity_threshold: input.config?.cache?.similarityThreshold ?? DEFAULT_CACHE_CONFIG.similarity_threshold,
          soft_zone_floor: input.config?.cache?.softZoneFloor ?? DEFAULT_CACHE_CONFIG.soft_zone_floor,
          data_dir: input.config?.cache?.dataDir ?? DEFAULT_CACHE_CONFIG.data_dir,
        },
        confidenceConfig: input.config?.cache?.confidenceWeights ?? DEFAULT_CONFIDENCE_CONFIG,
      });

      if (cacheResult.type === 'fast-path') {
        const cachedEntry = cacheResult.hit.entry;
        const cacheProvenance: CacheHitProvenance = {
          similarity: cacheResult.hit.similarity,
          confidence: cacheResult.hit.confidence,
          originalSessionId: cachedEntry.session_id,
          originalDate: cachedEntry.created_at,
          skillName: cachedEntry.skill_name,
        };

        // If requestCacheApproval is provided, ask the client before using cache
        if (input.requestCacheApproval) {
          const useCache = await input.requestCacheApproval(cacheProvenance);
          if (!useCache) {
            input.noCache = true;
            // Fall through to diagnosis path
          } else {
            let cachedFixPlan: FixPlan | undefined;
            try {
              cachedFixPlan = JSON.parse(cachedEntry.fix_plan);
            } catch { /* invalid JSON, skip fix plan */ }

            return {
              sessionId: input.sessionId ?? '',
              skillMessage: `Using skill: ${selection.skill.frontmatter.name} -- ${selection.reasoning}`,
              diagnosis: cachedEntry.diagnosis,
              commands: [],
              ...(Object.keys(discoveryRaw).length > 0 && { discovery: discoveryRaw }),
              ...(cachedFixPlan && { fixPlan: cachedFixPlan }),
              skillName: selection.skill.frontmatter.name,
              ...(targetContainers.length > 0 && { containers: targetContainers }),
              cacheHit: cacheProvenance,
              ...(cachedFixPlan && { executeHint: 'POST /execute with { sessionId, fixPlan, target, adminName, skillName, containers }' }),
            };
          }
        } else {
          let cachedFixPlan: FixPlan | undefined;
          try {
            cachedFixPlan = JSON.parse(cachedEntry.fix_plan);
          } catch { /* invalid JSON, skip fix plan */ }

          return {
            sessionId: input.sessionId ?? '',
            skillMessage: `Using skill: ${selection.skill.frontmatter.name} -- ${selection.reasoning}`,
            diagnosis: cachedEntry.diagnosis,
            commands: [],
            ...(Object.keys(discoveryRaw).length > 0 && { discovery: discoveryRaw }),
            ...(cachedFixPlan && { fixPlan: cachedFixPlan }),
            skillName: selection.skill.frontmatter.name,
            ...(targetContainers.length > 0 && { containers: targetContainers }),
            cacheHit: cacheProvenance,
            ...(cachedFixPlan && { executeHint: 'POST /execute with { sessionId, fixPlan, target, adminName, skillName, containers }' }),
          };
        }
      }

      if (cacheResult.type === 'speculative') {
        if (DEV_MODE) console.log(`[CACHE] Speculative match found -- proceeding to LLM diagnosis`);
      }
    }

    // --- Memory enrichment (before parallel split -- uses embedding, not inference) ---
    const memoryEnabled = input.config?.memory?.enabled !== false;
    if (memoryEnabled) {
      try {
        const memDataDir = input.config?.memory?.dataDir ?? '.infrabrain/memory';
        const incidentStore = getIncidentStore(memDataDir);
        const entityStore = getEntityStore(memDataDir);

        const memoryConfig: MemoryConfig = {
          enabled: true,
          dataDir: memDataDir,
          decayLambda: input.config?.memory?.decayLambda ?? 0.02,
          l2SimilarityThreshold: input.config?.memory?.l2SimilarityThreshold ?? 0.7,
          l2Limit: input.config?.memory?.l2Limit ?? 3,
          tokenBudgets: input.config?.memory?.tokenBudgets ?? { l0: 100, l1: 500, l2l3: 1000 },
        };

        const wakeUp = await buildWakeUpContext({
          currentPrompt: prompt,
          memoryConfig,
          embeddingParams: { baseURL: embeddingBaseURL, modelId: embeddingModelId, apiKey: embeddingApiKey },
          incidentStore,
          entityStore,
        });

        if (wakeUp.pinned || wakeUp.evictable) {
          contextManager.injectMemory(wakeUp.pinned, wakeUp.evictable);
          if (DEV_MODE) console.log(`[MEMORY] Wake-up context injected (pinned: ${wakeUp.pinned.length > 0}, evictable: ${wakeUp.evictable.length > 0})`);
        }
      } catch (memErr) {
        if (DEV_MODE) console.error('[MEMORY] Wake-up context failed:', memErr);
      }
    }

    // DPEV: enforce discovery before diagnosis
    enforceDPEVSequence('diagnosis', completedPhases);

    // Build raw enriched prompt for 122B diagnosis (unfiltered -- 122B can handle noise)
    const rawContextManager = new ContextManager(
      {
        windowSize: input.config?.contextWindow ?? 32768,
        threshold: 0.83,
        target: 0.60,
        groundTruthCap: 0.20,
      },
      input.config?.sessionDir,
      input.sessionId,
    );
    rawContextManager.ingestDiscovery(discoveryRaw);
    const rawContextBlock = rawContextManager.buildContext();
    const rawEnrichedPrompt = rawContextBlock
      ? `${prompt}\n\n${rawContextBlock}\n\nMANDATORY: Use ONLY the container names, IPs, PIDs, and values shown in Ground Truth above. Do NOT invent, guess, or substitute any names.`
      : prompt;
    const { filtered: rawPreFiltered } = preFilterIfLogHeavy(rawEnrichedPrompt);

    if (DEV_MODE) console.log(`[PARALLEL] Dispatching 9B-preprocess and 122B-diagnosis concurrently...`);
    const parallelStart = Date.now();

    // Launch both concurrently via scheduler (unknown type since tasks return different shapes)
    const tasks: InferenceTask<unknown>[] = [
      {
        label: '9B-preprocess',
        role: 'worker' as ModelRole,
        execute: async () => {
          const noiseResult = await filterNoise(discoveryRaw, skillNoisePatterns, workerModel);
          contextManager.ingestDiscovery(noiseResult.filtered);
          const compResult = await contextManager.maybeCompact(workerModel);
          return { noiseResult, contextBlock: contextManager.buildContext(), compResult };
        },
      },
      {
        label: '122B-diagnosis',
        role: (preferredRole ?? 'default') as ModelRole,
        execute: async () => {
          return runDiagnosis({
            prompt: rawPreFiltered,
            systemPrompt,
            discoveryContext,
            provider,
            preferredRole,
            rewriteRules,
            targetContainers,
            auditLogger,
          });
        },
      },
    ];
    const results = await scheduler.runParallel(tasks);

    if (DEV_MODE) console.log(`[PARALLEL] Both tasks settled in ${Date.now() - parallelStart}ms`);

    // Extract results by label
    const preProcessResult = results.find(r => r.label === '9B-preprocess');
    const diagResult = results.find(r => r.label === '122B-diagnosis');

    // 122B diagnosis is REQUIRED -- fail if rejected
    if (!diagResult || diagResult.status === 'rejected') {
      throw new Error(`Diagnosis failed: ${diagResult?.reason ?? 'unknown'}`);
    }
    const diagnosisResult = diagResult.value as { diagnosis: string; structuredDiagnosis?: StructuredDiagnosis; hallucinationError?: { violations: string[]; hint: string } };

    // If hallucination error, return early for HTTP handler to translate to 422
    if (diagnosisResult.hallucinationError) {
      return {
        sessionId: input.sessionId ?? '',
        diagnosis: diagnosisResult.diagnosis,
        commands: [],
        skillName: selection.skill.frontmatter.name,
        hallucinationError: diagnosisResult.hallucinationError,
      };
    }

    diagnosis = diagnosisResult.diagnosis;
    structuredDiagnosis = diagnosisResult.structuredDiagnosis;

    // 9B preprocess is OPTIONAL -- graceful degradation
    if (preProcessResult?.status === 'fulfilled') {
      const ppValue = preProcessResult.value as { noiseResult: { filtered: Record<string, string>; removedCount: number; workerModelUsed: boolean }; contextBlock: string; compResult: unknown };
      if (DEV_MODE) {
        console.log(`[PARALLEL] 9B preprocess succeeded: filtered ${ppValue.noiseResult.removedCount} noise lines`);
      }
      // 9B cleaned context will be used for planning phase enrichment (contextManager already updated)
    } else {
      if (DEV_MODE) console.log(`[PARALLEL] 9B preprocess failed (graceful degradation): ${preProcessResult?.reason ?? 'unknown'}`);
      // Fallback: ingest raw discovery so contextManager has something for planning
      contextManager.ingestDiscovery(discoveryRaw);
    }

  // ---------------------------------------------------------------------------
  // SEQUENTIAL PATH: current behavior unchanged
  // ---------------------------------------------------------------------------
  } else {
    // --- Context Management: noise filter + ContextManager ---
    const { filtered: filteredRaw, removedCount, workerModelUsed } = await filterNoise(discoveryRaw, skillNoisePatterns, workerModel);

    if (DEV_MODE) {
      console.log(`[NOISE] Filtered ${removedCount} noise lines`);
      if (workerModelUsed) console.log(`[NOISE] Worker model used for relevance scoring`);
    }

    contextManager.ingestDiscovery(filteredRaw);

    if (DEV_MODE) {
      const usage = contextManager.getUsage();
      console.log(`[CONTEXT] ${(usage.percentage * 100).toFixed(1)}% used (${usage.tokens} tokens)`);
    }

    const compactionResult = await contextManager.maybeCompact(workerModel);
    if (DEV_MODE && compactionResult) {
      console.log(`[CONTEXT] Compaction fired: ${compactionResult.tokensBefore} -> ${compactionResult.tokensAfter} tokens (${compactionResult.tiersUsed} tiers)`);
    }

    // Build enriched prompt using ContextManager (replaces ad-hoc GROUND TRUTH block)
    let rollingContext = '';
    const idleDetail = discoveryRaw['Idle connections detail'];
    if (idleDetail && idleDetail !== '(empty)') {
      const pids = idleDetail.split('\n')
        .map(line => line.split('|')[0]?.trim())
        .filter(pid => pid && /^\d+$/.test(pid));
      if (pids.length > 0) {
        rollingContext = `\n\n--- ROLLING CONTEXT (from discovery) ---\nIdle connection PIDs found: [${pids.join(', ')}]\nThese PIDs MUST be referenced in the fix plan. Re-query to get fresh PIDs at fix time, but use these as the expected values.\n--- END ROLLING CONTEXT ---`;
      }
    }

    const contextBlock = contextManager.buildContext();
    const enrichedPrompt = contextBlock
      ? `${prompt}\n\n${contextBlock}${rollingContext}\n\nMANDATORY: Use ONLY the container names, IPs, PIDs, and values shown in Ground Truth above. Do NOT invent, guess, or substitute any names.`
      : prompt;

    // Pre-filter log-heavy prompts before LLM call to save tokens
    const { filtered: preFilteredPrompt } = preFilterIfLogHeavy(enrichedPrompt);

    // --- Cache check: between noise filter and diagnosis ---
    if (!input.noCache) {
      let cacheStore: CacheStore | null = null;
      const cacheEnabled = input.config?.cache?.enabled !== false;
      if (cacheEnabled) {
        try {
          cacheStore = getCacheStore(input.config?.cache?.dataDir ?? DEFAULT_CACHE_CONFIG.data_dir);
          await cacheStore.init();
        } catch { cacheStore = null; }
      }

      const cacheResult = await checkCache({
        prompt,
        filteredDiscovery: filteredRaw,
        store: cacheStore,
        baseURL: embeddingBaseURL,
        modelId: embeddingModelId,
        apiKey: embeddingApiKey,
        cacheConfig: {
          enabled: cacheEnabled,
          similarity_threshold: input.config?.cache?.similarityThreshold ?? DEFAULT_CACHE_CONFIG.similarity_threshold,
          soft_zone_floor: input.config?.cache?.softZoneFloor ?? DEFAULT_CACHE_CONFIG.soft_zone_floor,
          data_dir: input.config?.cache?.dataDir ?? DEFAULT_CACHE_CONFIG.data_dir,
        },
        confidenceConfig: input.config?.cache?.confidenceWeights ?? DEFAULT_CONFIDENCE_CONFIG,
      });

      if (cacheResult.type === 'fast-path') {
        const cachedEntry = cacheResult.hit.entry;
        const cacheProvenance: CacheHitProvenance = {
          similarity: cacheResult.hit.similarity,
          confidence: cacheResult.hit.confidence,
          originalSessionId: cachedEntry.session_id,
          originalDate: cachedEntry.created_at,
          skillName: cachedEntry.skill_name,
        };

        // If requestCacheApproval is provided, ask the client before using cache
        if (input.requestCacheApproval) {
          const useCache = await input.requestCacheApproval(cacheProvenance);
          if (!useCache) {
            // User rejected cache -- re-run diagnosis from scratch
            input.noCache = true;
            // Fall through to normal diagnosis path below
          } else {
            // User approved cache -- return cached fix
            let cachedFixPlan: FixPlan | undefined;
            try {
              cachedFixPlan = JSON.parse(cachedEntry.fix_plan);
            } catch { /* invalid JSON, skip fix plan */ }

            return {
              sessionId: input.sessionId ?? '',
              skillMessage: `Using skill: ${selection.skill.frontmatter.name} -- ${selection.reasoning}`,
              diagnosis: cachedEntry.diagnosis,
              commands: [],
              ...(Object.keys(discoveryRaw).length > 0 && { discovery: discoveryRaw }),
              ...(cachedFixPlan && { fixPlan: cachedFixPlan }),
              skillName: selection.skill.frontmatter.name,
              ...(targetContainers.length > 0 && { containers: targetContainers }),
              cacheHit: cacheProvenance,
              ...(cachedFixPlan && { executeHint: 'POST /execute with { sessionId, fixPlan, target, adminName, skillName, containers }' }),
            };
          }
        } else {
          // No requestCacheApproval -- existing behavior: return cached result immediately
          let cachedFixPlan: FixPlan | undefined;
          try {
            cachedFixPlan = JSON.parse(cachedEntry.fix_plan);
          } catch { /* invalid JSON, skip fix plan */ }

          return {
            sessionId: input.sessionId ?? '',
            skillMessage: `Using skill: ${selection.skill.frontmatter.name} -- ${selection.reasoning}`,
            diagnosis: cachedEntry.diagnosis,
            commands: [],
            ...(Object.keys(discoveryRaw).length > 0 && { discovery: discoveryRaw }),
            ...(cachedFixPlan && { fixPlan: cachedFixPlan }),
            skillName: selection.skill.frontmatter.name,
            ...(targetContainers.length > 0 && { containers: targetContainers }),
            cacheHit: cacheProvenance,
            ...(cachedFixPlan && { executeHint: 'POST /execute with { sessionId, fixPlan, target, adminName, skillName, containers }' }),
          };
        }
      }

      if (cacheResult.type === 'speculative') {
        // Speculative: log and proceed to full LLM diagnosis
        // The speculative hit is stored in result for Plan 03 to display
        if (DEV_MODE) console.log(`[CACHE] Speculative match found -- proceeding to LLM diagnosis`);
        // Note: speculative hit provenance will be attached to the final result below
      }

      // Cache miss: proceed normally (existing code path unchanged)
    }
    // Cache write happens in execution route after fix verification -- see storeFixInCache()

    // --- Memory enrichment: wake-up context (non-blocking) ---
    const memoryEnabled = input.config?.memory?.enabled !== false;
    if (memoryEnabled) {
      try {
        const memDataDir = input.config?.memory?.dataDir ?? '.infrabrain/memory';
        const incidentStore = getIncidentStore(memDataDir);
        const entityStore = getEntityStore(memDataDir);

        const memoryConfig: MemoryConfig = {
          enabled: true,
          dataDir: memDataDir,
          decayLambda: input.config?.memory?.decayLambda ?? 0.02,
          l2SimilarityThreshold: input.config?.memory?.l2SimilarityThreshold ?? 0.7,
          l2Limit: input.config?.memory?.l2Limit ?? 3,
          tokenBudgets: input.config?.memory?.tokenBudgets ?? { l0: 100, l1: 500, l2l3: 1000 },
        };

        const wakeUp = await buildWakeUpContext({
          currentPrompt: prompt,
          memoryConfig,
          embeddingParams: { baseURL: embeddingBaseURL, modelId: embeddingModelId, apiKey: embeddingApiKey },
          incidentStore,
          entityStore,
        });

        if (wakeUp.pinned || wakeUp.evictable) {
          contextManager.injectMemory(wakeUp.pinned, wakeUp.evictable);
          if (DEV_MODE) console.log(`[MEMORY] Wake-up context injected (pinned: ${wakeUp.pinned.length > 0}, evictable: ${wakeUp.evictable.length > 0})`);
        }
      } catch (memErr) {
        // Memory unavailable -- proceed without enrichment
        if (DEV_MODE) console.error('[MEMORY] Wake-up context failed:', memErr);
      }
    }

    // DPEV: enforce discovery before diagnosis
    enforceDPEVSequence('diagnosis', completedPhases);

    // Emit diagnosis phase start
    const diagModelId = preferredRole
      ? ((provider.registry?.get?.(preferredRole as ModelRole) as any)?.modelId ?? 'default')
      : ((provider.model as any)?.modelId ?? 'default');
    input.onEvent?.('dpev:phase', { phase: 'diagnosis', model: diagModelId, status: 'active' });

    // Token-by-token streaming: when onEvent is provided, use streamDiagnosis instead of generateCommand
    // to emit individual token chunks via dpev:token events
    if (input.onEvent && provider.streamDiagnosis) {
      let streamedDiagnosis = '';
      for await (const chunk of provider.streamDiagnosis(preFilteredPrompt, systemPrompt)) {
        streamedDiagnosis += chunk;
        input.onEvent('dpev:token', { text: chunk, phase: 'diagnosis' });
      }
      // Use streamed result for diagnosis (structured diagnosis via generateObject still needed for planning)
      // Fall through to runDiagnosis which will use generateCommand for structured output
    }

    // Run diagnosis (always needed for structured output even when streaming)
    const diagnosisResult = await runDiagnosis({
      prompt: preFilteredPrompt,
      systemPrompt,
      discoveryContext,
      provider,
      preferredRole,
      rewriteRules,
      targetContainers,
      auditLogger,
    });

    // If hallucination error, return early for HTTP handler to translate to 422
    if (diagnosisResult.hallucinationError) {
      return {
        sessionId: input.sessionId ?? '',
        diagnosis: diagnosisResult.diagnosis,
        commands: [],
        skillName: selection.skill.frontmatter.name,
        hallucinationError: diagnosisResult.hallucinationError,
      };
    }

    diagnosis = diagnosisResult.diagnosis;
    structuredDiagnosis = diagnosisResult.structuredDiagnosis;
  }

  // DPEV: diagnosis phase complete
  completedPhases.push('diagnosis');

  // Emit diagnosis complete events
  if (structuredDiagnosis) {
    input.onEvent?.('dpev:diagnosis', {
      rootCause: structuredDiagnosis.rootCause,
      correlation: structuredDiagnosis.correlation,
      structuredDiagnosis,
    });
  }
  input.onEvent?.('dpev:phase', { phase: 'diagnosis', model: 'default', status: 'complete' });

  // DPEV: enforce diagnosis before plan
  enforceDPEVSequence('plan', completedPhases);

  // Planning phase
  let fixPlan: FixPlan | undefined;
  let planMarkdown: string | undefined;
  let planTable: string | undefined;

  const planningSkill = registry?.get('planning');
  if (planningSkill) {
    let planStart = Date.now();
    try {
      const planModelId: string = planningSkill.frontmatter.preferred_model
        ? (provider.registry?.get?.(planningSkill.frontmatter.preferred_model as ModelRole) as any)?.modelId ?? planningSkill.frontmatter.preferred_model
        : (provider.model as any)?.modelId ?? 'default';
      if (DEV_MODE) console.log(`[PLANNING] Generating fix plan via ${planModelId}...`);
      planStart = Date.now();

      // Emit planning phase start
      input.onEvent?.('dpev:phase', { phase: 'plan', model: planModelId, status: 'active' });

      // Include discovery context in the diagnosis passed to planner
      const enrichedDiagnosis = discoveryContext
        ? `${diagnosis}\n\n${discoveryContext}`
        : diagnosis;

      fixPlan = await generateFixPlan({
        model: provider.model,
        skill: planningSkill,
        userInput: prompt,
        diagnosis: enrichedDiagnosis,
        discoveryContext: discoveryContext || undefined,
        registry: provider.registry,
      });

      // Apply dynamic rewrite rules to generated fix plan
      if (rewriteRules.length > 0 && targetContainers.length > 0) {
        const { dynamicRewrite } = await import('../execution/dynamic-rewriter.js');
        fixPlan.steps = fixPlan.steps.map(step => ({
          ...step,
          command: dynamicRewrite(step.command, rewriteRules, targetContainers),
        }));
      }

      // Validate plan doesn't contain placeholder names
      const planProblems = validatePlanNames(fixPlan, discoveryRaw);
      if (planProblems.length > 0) {
        auditLogger.logError(`Fix plan contains placeholders: ${planProblems.join('; ')}`);
      }

      planMarkdown = generatePlanMarkdown(fixPlan);
      planTable = formatPlanTable(fixPlan);

      // Emit plan ready and planning phase complete events
      input.onEvent?.('dpev:plan', { fixPlan, planTable });
      input.onEvent?.('dpev:phase', { phase: 'plan', model: planModelId, status: 'complete' });

      if (DEV_MODE) console.log(`[PLANNING] Complete in ${((Date.now() - planStart) / 1000).toFixed(1)}s — ${fixPlan.steps.length} steps`);
    } catch (planErr) {
      if (DEV_MODE) console.log(`[PLANNING] FAILED after ${((Date.now() - planStart) / 1000).toFixed(1)}s: ${(planErr as Error).message}`);
      auditLogger.logError(`Fix plan generation failed: ${(planErr as Error).message}`);
    }
  }

  // Extract and validate commands with per-skill allowlist
  const extractedCommands = extractCommands(diagnosis);
  const commands = extractedCommands.map((cmd) => {
    // Per-skill allowlist check first
    const allowlistResult = enforceSkillAllowlist(cmd, selection.skill);
    if (!allowlistResult.allowed) {
      auditLogger.logCommandValidation(cmd, 'blocked', false, allowlistResult.reason);
      return {
        command: cmd,
        riskLevel: 'blocked' as const,
        allowed: false,
        reason: allowlistResult.reason,
      };
    }

    // Global safety validator
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
    [`Generated ${extractedCommands.length} commands`, `Skill: ${selection.skill.frontmatter.name}`],
    'diagnosis_complete',
  );

  // Extract target: prefer DB container from discovery, fallback to command parsing
  let planTarget: string | undefined;
  if (allContainers.length > 0) {
    planTarget = findDbContainer(allContainers);
  }
  if (!planTarget && fixPlan) {
    const firstWriteStep = fixPlan.steps.find(s => s.risk === 'write' || s.risk === 'destructive');
    if (firstWriteStep) {
      planTarget = extractTarget(firstWriteStep.command);
    }
  }

  return {
    sessionId: input.sessionId ?? '',
    skillMessage,
    diagnosis,
    ...(structuredDiagnosis && { structuredDiagnosis }),
    commands,
    ...(Object.keys(discoveryRaw).length > 0 && { discovery: discoveryRaw }),
    ...(fixPlan && { fixPlan }),
    ...(planMarkdown && { planMarkdown }),
    ...(planTable && { planTable }),
    ...(planTarget && { target: planTarget }),
    skillName: selection.skill.frontmatter.name,
    ...(targetContainers.length > 0 && { containers: targetContainers }),
    ...(fixPlan && { executeHint: 'POST /execute with { sessionId, fixPlan, target, adminName, skillName, containers }' }),
  };
}
