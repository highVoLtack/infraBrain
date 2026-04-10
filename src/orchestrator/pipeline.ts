import type { LLMProvider } from '../llm/types.js';
import type { ModelRole } from '../config/types.js';
import type { AuditLogger } from '../audit/logger.js';
import type { ValidationResult } from '../safety/types.js';
import type { SkillRegistry } from '../skills/registry.js';
import type { SkillFile } from '../skills/types.js';
import type { WriteThrough } from '../state/store.js';
import type { InfraBrainConfig } from '../config/types.js';
import type { FixPlan, StructuredDiagnosis } from './types.js';

import { selectSkill } from './router.js';
import { generateFixPlan, generatePlanMarkdown, formatPlanTable } from './planner.js';
import { buildMessages } from './context.js';
import { enforceSkillAllowlist } from '../skills/allowlist.js';
import { extractTarget } from '../cli/approval.js';
import { findDbContainer } from '../execution/runner.js';
import { toolsToRewriteRules } from '../execution/dynamic-rewriter.js';
import { runParallelDiscovery } from './discovery.js';
import { encodeForLLM, measureSavings } from '../llm/toon-encoder.js';
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

  // Build enriched prompt with discovery context injected as GROUND TRUTH
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

  const enrichedPrompt = discoveryContext
    ? `${prompt}\n\n--- GROUND TRUTH - USE ONLY THESE NAMES ---\n${discoveryContext}\n--- END GROUND TRUTH ---${rollingContext}\n\nMANDATORY: Use ONLY the container names, IPs, PIDs, and values shown in GROUND TRUTH above. Do NOT invent, guess, or substitute any names. If a value is not in GROUND TRUTH, run a command to discover it.`
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
