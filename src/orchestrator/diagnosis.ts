import { generateObject } from 'ai';
import type { LLMProvider } from '../llm/types.js';
import type { ModelRole } from '../config/types.js';
import type { AuditLogger } from '../audit/logger.js';
import type { RewriteRule } from '../execution/dynamic-rewriter.js';
import { dynamicRewrite } from '../execution/dynamic-rewriter.js';
import { StructuredDiagnosisSchema, type StructuredDiagnosis, type FixPlan } from './types.js';
import { parseLog } from '../log-analysis/parsers/index.js';
import { preFilterLogs, formatForLLM } from '../log-analysis/filter.js';

const DEV_MODE = process.env.NODE_ENV !== 'production';

/** Max sanity-check retries before giving up */
const MAX_SANITY_RETRIES = 1;

// ---------------------------------------------------------------------------
// DPEV Phase Sequencing
// ---------------------------------------------------------------------------

/** DPEV phase ordering for sequence enforcement */
export type DPEVPhase = 'discovery' | 'diagnosis' | 'plan' | 'execution' | 'verification';

const DPEV_ORDER: DPEVPhase[] = ['discovery', 'diagnosis', 'plan', 'execution', 'verification'];

/**
 * Enforce DPEV sequence ordering. Throws if attempting to start a phase
 * before all prior phases have completed.
 */
export function enforceDPEVSequence(current: DPEVPhase, completed: DPEVPhase[]): void {
  const currentIdx = DPEV_ORDER.indexOf(current);
  for (let i = 0; i < currentIdx; i++) {
    if (!completed.includes(DPEV_ORDER[i])) {
      throw new Error(
        `DPEV VIOLATION: Cannot start "${current}" before "${DPEV_ORDER[i]}" completes`
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Regex matching common log indicators: level keywords and ISO-ish timestamps */
const LOG_INDICATOR = /\b(ERROR|WARN|INFO|DEBUG|FATAL|CRITICAL)\b|\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/i;

/**
 * Docker-legitimate angle-bracket terms that should NOT trigger hallucination detection.
 * These appear in real Docker output (docker images, docker history, docker inspect).
 */
const DOCKER_LEGITIMATE_TAGS = new Set([
  'none', 'missing', 'local', 'original-image', 'no-value',
]);

/**
 * Patterns that indicate hallucinated/placeholder content in LLM output.
 * If any match, the output fails the sanity check.
 * NOTE: Angle-bracket patterns are handled separately in checkForHallucinations
 * to allow Docker-legitimate tags through.
 */
const HALLUCINATION_PATTERNS = [
  /\[PID\]/i,                       // [PID] placeholder
  /\[IP\]/i,                        // [IP] placeholder
  /\bExample Output\b/i,            // "Example Output" header
  /\bAssume the following\b/i,      // hypothetical preamble
  /\bFor example\b/i,               // example reasoning
  /\bHypothetically\b/i,            // hypothetical reasoning
  /\bLet's say\b/i,                 // hypothetical reasoning
  /\bSample output\b/i,             // sample output header
];

/** Strict grounding penalty prompt appended on sanity-check retry */
export const STRICT_GROUNDING_PENALTY = `

CRITICAL RETRY: Your previous response was REJECTED because it contained placeholder names, example output, or hypothetical reasoning. This is your FINAL attempt.

RULES FOR THIS RETRY:
- Every container name, IP, PID, port, and file path MUST come from the GROUND TRUTH section above.
- If you write <anything>, [PID], [IP], or any placeholder, this response will be REJECTED and the system will HALT.
- Do NOT explain what you "would" do. Do ONLY what the data shows.
- Zero examples. Zero hypotheticals. Only real data.`;

// ---------------------------------------------------------------------------
// Utility Functions
// ---------------------------------------------------------------------------

/**
 * Sanity-check LLM output for hallucination patterns.
 * Returns list of violations found, empty if clean.
 *
 * Angle-bracket tags are checked separately: Docker-legitimate tags
 * (e.g. <none>, <missing>) are whitelisted and do not trigger violations.
 */
export function checkForHallucinations(text: string): string[] {
  const violations: string[] = [];

  // Check angle-bracket tags with Docker whitelist
  const angleBracketPattern = /<([a-z][a-z0-9_-]*)>/gi;
  let abMatch;
  while ((abMatch = angleBracketPattern.exec(text)) !== null) {
    const tagContent = abMatch[1].toLowerCase();
    if (!DOCKER_LEGITIMATE_TAGS.has(tagContent)) {
      violations.push(`Found hallucination pattern: "${abMatch[0]}"`);
    }
  }

  // Check remaining patterns (non-angle-bracket)
  for (const pattern of HALLUCINATION_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      violations.push(`Found hallucination pattern: "${match[0]}"`);
    }
  }
  return violations;
}

/**
 * Detect log-heavy prompts and pre-filter them using the log-analysis pipeline.
 * - Fewer than 5 lines: not log-heavy
 * - Fewer than 3 lines matching log indicators: not log-heavy
 * - If parseLog returns more unparseable than entries: fallback to raw prompt
 * - Otherwise: context lines + pre-filtered formatted logs
 */
export function preFilterIfLogHeavy(prompt: string): { filtered: string; wasFiltered: boolean } {
  const lines = prompt.split('\n');

  // Too few lines to be a log dump
  if (lines.length < 5) {
    return { filtered: prompt, wasFiltered: false };
  }

  // Count lines with log indicators
  const indicatorCount = lines.filter(line => LOG_INDICATOR.test(line)).length;
  if (indicatorCount < 3) {
    return { filtered: prompt, wasFiltered: false };
  }

  // Separate context lines from log-like lines
  const contextLines: string[] = [];
  const logLines: string[] = [];
  for (const line of lines) {
    if (LOG_INDICATOR.test(line)) {
      logLines.push(line);
    } else {
      contextLines.push(line);
    }
  }

  // Parse the log-like lines
  const parsed = parseLog(logLines.join('\n'));

  // If more unparseable than successfully parsed entries, heuristic failed -- fallback
  if (parsed.unparseable.length > parsed.entries.length) {
    return { filtered: prompt, wasFiltered: false };
  }

  // Pre-filter and format for LLM
  const result = preFilterLogs({ entries: parsed.entries });
  const formatted = formatForLLM(result.filtered);

  // Reassemble: context lines + pre-filtered logs
  const parts: string[] = [];
  if (contextLines.length > 0) {
    parts.push(contextLines.join('\n'));
  }
  parts.push('Pre-filtered logs:');
  parts.push(formatted);

  return { filtered: parts.join('\n'), wasFiltered: true };
}

/**
 * Flatten a StructuredDiagnosis into a text diagnosis string
 * for backward compatibility with existing consumers.
 */
export function flattenDiagnosis(sd: StructuredDiagnosis): string {
  const lines: string[] = [];
  for (const step of sd.steps) {
    lines.push(`Step ${step.step}: ${step.label}`);
    lines.push(`Command: ${step.command}`);
    lines.push(`Output: ${step.output}`);
    lines.push(`Finding: ${step.finding}`);
    lines.push('');
  }
  lines.push(`Root Cause: ${sd.rootCause}`);
  lines.push(`Correlation: ${sd.correlation}`);
  lines.push('');
  lines.push('Fix Plan:');
  for (let i = 0; i < sd.fixPlan.length; i++) {
    const step = sd.fixPlan[i];
    lines.push(`${i + 1}. Command: \`${step.command}\` | Risk: ${step.risk} | Expected: ${step.expected}`);
  }
  return lines.join('\n');
}

/**
 * Validate that a fix plan doesn't contain placeholder names.
 * Returns list of problems found.
 */
export function validatePlanNames(plan: FixPlan, discoveredNames: Record<string, string>): string[] {
  const problems: string[] = [];
  const placeholderPattern = /<[^>]+>/;

  for (const step of plan.steps) {
    if (placeholderPattern.test(step.command)) {
      problems.push(`Step "${step.command}" contains placeholder <...>. Must use actual names from discovery.`);
    }
  }

  return problems;
}

/**
 * Extract shell commands from LLM text output.
 * Looks for lines starting with common command patterns or
 * lines prefixed with "Command:" or code blocks.
 */
export function extractCommands(text: string): string[] {
  const commands: string[] = [];
  const lines = text.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();

    // Match "Command: <command>" pattern
    const cmdMatch = trimmed.match(/^Command:\s*(.+)$/i);
    if (cmdMatch) {
      commands.push(cmdMatch[1].trim());
      continue;
    }

    // Match "$ <command>" pattern (shell prompt style)
    const shellMatch = trimmed.match(/^\$\s+(.+)$/);
    if (shellMatch) {
      commands.push(shellMatch[1].trim());
      continue;
    }

    // Match "`<command>`" inline code pattern
    const inlineMatch = trimmed.match(/^`([^`]+)`$/);
    if (inlineMatch) {
      commands.push(inlineMatch[1].trim());
    }
  }

  return commands;
}

/**
 * Extract container names from discovery output, handling both key formats:
 * - "Running containers": simple name list from `docker ps --format "{{.Names}}"`
 * - "All containers with status": `name status` pairs from `docker ps -a --format "{{.Names}} {{.Status}}"`
 */
export function extractContainerNames(discoveryRaw: Record<string, string>): string[] {
  const raw = discoveryRaw['Running containers']
    ?? discoveryRaw['All containers with status']
    ?? '';
  return raw
    .split('\n')
    .map(line => line.trim().split(/\s+/)[0])
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Diagnosis Orchestration
// ---------------------------------------------------------------------------

export interface DiagnosisInput {
  prompt: string;               // pre-filtered prompt
  systemPrompt: string;
  discoveryContext: string;
  provider: LLMProvider;
  preferredRole?: ModelRole;
  rewriteRules: RewriteRule[];
  targetContainers: string[];
  auditLogger: AuditLogger;
}

export interface DiagnosisResult {
  diagnosis: string;
  structuredDiagnosis?: StructuredDiagnosis;
  hallucinationError?: { violations: string[]; hint: string };
}

/**
 * Run the diagnosis phase of the DPEV pipeline.
 *
 * Attempts structured diagnosis via generateObject when discoveryContext exists
 * and preferredRole is set. Falls back to free-text on structured failure.
 * Runs hallucination check on free-text diagnosis with one retry using
 * STRICT_GROUNDING_PENALTY. Returns hallucinationError instead of sending
 * HTTP 422 (the HTTP handler translates this).
 */
export async function runDiagnosis(input: DiagnosisInput): Promise<DiagnosisResult> {
  const {
    prompt,
    systemPrompt,
    discoveryContext,
    provider,
    preferredRole,
    rewriteRules,
    targetContainers,
    auditLogger,
  } = input;

  let diagnosis: string;
  let structuredDiagnosis: StructuredDiagnosis | undefined;

  // Attempt structured diagnosis via generateObject for skills with discovery data
  if (discoveryContext && preferredRole) {
    let diagStart = Date.now();
    try {
      const targetModel = provider.registry.get(preferredRole);
      const diagModelId = (targetModel as any)?.modelId ?? preferredRole;
      if (DEV_MODE) console.log(`[DIAGNOSIS] Calling ${diagModelId} (structured object)...`);
      diagStart = Date.now();
      const { object } = await generateObject({
        model: targetModel,
        schema: StructuredDiagnosisSchema,
        system: systemPrompt,
        prompt,
      });
      // Apply dynamic rewrite rules to structured diagnosis fix plan
      if (rewriteRules.length > 0 && targetContainers.length > 0) {
        object.fixPlan = object.fixPlan.map(step => ({
          ...step,
          command: dynamicRewrite(step.command, rewriteRules, targetContainers),
        }));
      }
      structuredDiagnosis = object;
      diagnosis = flattenDiagnosis(object);
      if (DEV_MODE) console.log(`[DIAGNOSIS] Complete in ${((Date.now() - diagStart) / 1000).toFixed(1)}s — root cause: ${object.rootCause.slice(0, 80)}`);
    } catch (structuredErr) {
      // Fallback to free-text if structured generation fails
      if (DEV_MODE) console.log(`[DIAGNOSIS] Structured failed after ${((Date.now() - diagStart) / 1000).toFixed(1)}s, falling back to free-text...`);
      auditLogger.logError(`Structured diagnosis failed, falling back to free-text: ${(structuredErr as Error).message}`);
      diagnosis = await provider.generateCommand(prompt, systemPrompt, preferredRole);
    }
  } else {
    diagnosis = await provider.generateCommand(prompt, systemPrompt, preferredRole);
  }

  // Sanity checker: only for free-text diagnosis (structured is Zod-validated)
  if (!structuredDiagnosis) {
    const violations = checkForHallucinations(diagnosis);
    if (violations.length > 0) {
      if (DEV_MODE) console.log(`[SANITY] Hallucination detected: ${violations.join('; ')} — retrying with grounding penalty...`);
      auditLogger.logError(`Sanity check failed (attempt 1): ${violations.join('; ')}`);

      // Retry once with strict grounding penalty
      const sanityStart = Date.now();
      const retryPrompt = prompt + STRICT_GROUNDING_PENALTY;
      const retryDiagnosis = await provider.generateCommand(retryPrompt, systemPrompt, preferredRole);
      const retryViolations = checkForHallucinations(retryDiagnosis);
      if (DEV_MODE) console.log(`[SANITY] Retry complete in ${((Date.now() - sanityStart) / 1000).toFixed(1)}s — ${retryViolations.length > 0 ? 'STILL FAILED' : 'passed'}`);

      if (retryViolations.length > 0) {
        // Both attempts failed -- return hallucinationError for HTTP handler to translate to 422
        auditLogger.logError(`Sanity check failed (attempt 2, halting): ${retryViolations.join('; ')}`);
        return {
          diagnosis,
          hallucinationError: {
            violations: retryViolations,
            hint: 'The LLM generated placeholder names instead of using real discovery data. This may indicate the model needs more context or a different model role.',
          },
        };
      }

      // Retry succeeded
      diagnosis = retryDiagnosis;
    }
  }

  return { diagnosis, structuredDiagnosis };
}
