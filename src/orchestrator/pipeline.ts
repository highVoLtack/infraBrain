import type { LLMProvider } from '../llm/types.js';
import type { ModelRole, ModelMapEntry } from '../config/types.js';
import type { AuditLogger } from '../audit/logger.js';
import type { ValidationResult } from '../safety/types.js';
import type { SkillRegistry } from '../skills/registry.js';
import type { SkillFile } from '../skills/types.js';
import type { WriteThrough } from '../state/store.js';
import type { InfraBrainConfig } from '../config/types.js';
import type { FixPlan, StructuredDiagnosis } from './types.js';
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

  if (discoveryContext) {
    auditLogger.logExecution('discovery_complete', {
      skill: selection.skill.frontmatter.name,
      discoveredData: discoveryRaw,
    });
  }

  // Use skill's system prompt
  const { system } = buildMessages(selection.skill, prompt);
  systemPrompt = system;

  // --- Context Management: noise filter + ContextManager ---
  const workerModel = provider.registry?.get?.('worker');
  const skillNoisePatterns = selection.skill.frontmatter.noise_patterns ?? [];
  const { filtered: filteredRaw, removedCount, workerModelUsed } = await filterNoise(discoveryRaw, skillNoisePatterns, workerModel);

  if (DEV_MODE) {
    console.log(`[NOISE] Filtered ${removedCount} noise lines`);
    if (workerModelUsed) console.log(`[NOISE] Worker model used for relevance scoring`);
  }

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
  const embeddingEntry = input.config?.modelMap?.embedding as ModelMapEntry | undefined;
  const embeddingBaseURL = typeof embeddingEntry === 'object' && embeddingEntry !== null
    ? (embeddingEntry as { baseUrl: string }).baseUrl
    : (input.config?.defaultBaseUrl ?? 'http://localhost:11434/v1');
  const embeddingModelId = typeof embeddingEntry === 'string'
    ? embeddingEntry
    : typeof embeddingEntry === 'object' && embeddingEntry !== null
      ? (embeddingEntry as { model: string }).model
      : 'bge-m3';

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
      cacheConfig: {
        enabled: cacheEnabled,
        similarity_threshold: input.config?.cache?.similarityThreshold ?? DEFAULT_CACHE_CONFIG.similarity_threshold,
        soft_zone_floor: input.config?.cache?.softZoneFloor ?? DEFAULT_CACHE_CONFIG.soft_zone_floor,
        data_dir: input.config?.cache?.dataDir ?? DEFAULT_CACHE_CONFIG.data_dir,
      },
      confidenceConfig: input.config?.cache?.confidenceWeights ?? DEFAULT_CONFIDENCE_CONFIG,
    });

    if (cacheResult.type === 'fast-path') {
      // Fast-path: skip LLM diagnosis entirely, return cached fix
      const cachedEntry = cacheResult.hit.entry;
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
        cacheHit: {
          similarity: cacheResult.hit.similarity,
          confidence: cacheResult.hit.confidence,
          originalSessionId: cachedEntry.session_id,
          originalDate: cachedEntry.created_at,
          skillName: cachedEntry.skill_name,
        },
        ...(cachedFixPlan && { executeHint: 'POST /execute with { sessionId, fixPlan, target, adminName, skillName, containers }' }),
      };
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
        embeddingParams: { baseURL: embeddingBaseURL, modelId: embeddingModelId },
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

  // Run diagnosis
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

  const { diagnosis, structuredDiagnosis } = diagnosisResult;

  // DPEV: diagnosis phase complete
  completedPhases.push('diagnosis');

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
      const planModelId = planningSkill.frontmatter.preferred_model
        ? (provider.registry?.get?.(planningSkill.frontmatter.preferred_model as ModelRole) as any)?.modelId ?? planningSkill.frontmatter.preferred_model
        : (provider.model as any)?.modelId ?? 'default';
      if (DEV_MODE) console.log(`[PLANNING] Generating fix plan via ${planModelId}...`);
      planStart = Date.now();

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
