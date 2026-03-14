import { Router } from 'express';
import { generateObject } from 'ai';
import type { LLMProvider } from '../../llm/types.js';
import type { AuditLogger } from '../../audit/logger.js';
import type { ValidationResult } from '../../safety/types.js';
import type { SkillRegistry } from '../../skills/registry.js';
import type { SkillFile } from '../../skills/types.js';
import type { WriteThrough } from '../../state/store.js';
import type { InfraBrainConfig } from '../../config/types.js';
import { selectSkill } from '../../orchestrator/router.js';
import { generateFixPlan, generatePlanMarkdown, formatPlanTable } from '../../orchestrator/planner.js';
import { enforceSkillAllowlist } from '../../skills/allowlist.js';
import { buildMessages } from '../../orchestrator/context.js';
import type { FixPlan } from '../../orchestrator/types.js';
import { StructuredDiagnosisSchema, type StructuredDiagnosis } from '../../orchestrator/types.js';
import { extractTarget } from '../../cli/approval.js';
import { v7 as uuidv7 } from 'uuid';
import { runCommand, parseCommand, findDbContainer } from '../../execution/runner.js';
import { dynamicRewrite } from '../../execution/dynamic-rewriter.js';
import { encodeForLLM, measureSavings } from '../../llm/toon-encoder.js';
import { parseLog } from '../../log-analysis/parsers/index.js';
import { preFilterLogs, formatForLLM } from '../../log-analysis/filter.js';

const DEV_MODE = process.env.NODE_ENV !== 'production';

/** Max sanity-check retries before giving up */
const MAX_SANITY_RETRIES = 1;

/** Regex matching common log indicators: level keywords and ISO-ish timestamps */
const LOG_INDICATOR = /\b(ERROR|WARN|INFO|DEBUG|FATAL|CRITICAL)\b|\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/i;

/**
 * Patterns that indicate hallucinated/placeholder content in LLM output.
 * If any match, the output fails the sanity check.
 */
const HALLUCINATION_PATTERNS = [
  /<[a-z][a-z0-9_-]*>/i,           // <container-name>, <PID>, etc.
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
const STRICT_GROUNDING_PENALTY = `

CRITICAL RETRY: Your previous response was REJECTED because it contained placeholder names, example output, or hypothetical reasoning. This is your FINAL attempt.

RULES FOR THIS RETRY:
- Every container name, IP, PID, port, and file path MUST come from the GROUND TRUTH section above.
- If you write <anything>, [PID], [IP], or any placeholder, this response will be REJECTED and the system will HALT.
- Do NOT explain what you "would" do. Do ONLY what the data shows.
- Zero examples. Zero hypotheticals. Only real data.`;

/**
 * Sanity-check LLM output for hallucination patterns.
 * Returns list of violations found, empty if clean.
 */
export function checkForHallucinations(text: string): string[] {
  const violations: string[] = [];
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

  // If more unparseable than successfully parsed entries, heuristic failed — fallback
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
 * Run discovery commands and return TOON-encoded context string.
 * These are READ-only commands run before the LLM to prevent hallucination.
 */
async function runDiscovery(skill: SkillFile): Promise<{ context: string; raw: Record<string, string> }> {
  const commands = skill.frontmatter.discovery;
  if (!commands || commands.length === 0) return { context: '', raw: {} };

  const results: Record<string, string> = {};
  const parts: string[] = [];

  for (const { command, label } of commands) {
    const { executable, args } = parseCommand(command);
    const result = await runCommand(executable, args, { timeout: 10_000 });
    const output = result.stdout.trim() || result.stderr.trim() || '(empty)';
    results[label] = output;
    parts.push(`${label}:\n${output}`);
  }

  const context = encodeForLLM(results, 'Discovery (ground truth from live system)');

  if (DEV_MODE) {
    const savings = measureSavings(results);
    console.log(`[DEV] TOON Discovery: ${savings.jsonTokens} (JSON) -> ${savings.toonTokens} (TOON) | Saved: ${savings.savingsPercent.toFixed(1)}%`);
  }

  return { context, raw: results };
}

/**
 * Validate that a fix plan doesn't contain placeholder names.
 * Returns list of problems found.
 */
function validatePlanNames(plan: FixPlan, discoveredNames: Record<string, string>): string[] {
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
function extractCommands(text: string): string[] {
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
function extractContainerNames(discoveryRaw: Record<string, string>): string[] {
  const raw = discoveryRaw['Running containers']
    ?? discoveryRaw['All containers with status']
    ?? '';
  return raw
    .split('\n')
    .map(line => line.trim().split(/\s+/)[0])
    .filter(Boolean);
}

/**
 * Flatten a StructuredDiagnosis into a text diagnosis string
 * for backward compatibility with existing consumers.
 */
function flattenDiagnosis(sd: StructuredDiagnosis): string {
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
 * Create the /debug route.
 * Accepts a prompt, generates a diagnosis via LLM, validates any commands.
 * When a SkillRegistry is provided, uses orchestrator for skill selection and fix plans.
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
      const { prompt, skill: skillOverride } = req.body ?? {};

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

      // Use server's sessionId so audit log entries match the returned ID
      const sessionId = extraDeps?.sessionId ?? uuidv7();
      let skillMessage: string | undefined;
      let fixPlan: FixPlan | undefined;
      let planMarkdown: string | undefined;
      let planTable: string | undefined;

      // Determine system prompt and skill context
      let systemPrompt = 'You are an infrastructure diagnostic assistant. Analyze the issue and suggest specific commands to investigate or resolve it. Prefix commands with "Command:" on their own line.';

      // Skill selection (if registry available and has skills)
      if (registry && registry.list().length > 0) {
        try {
          const selection = await selectSkill({
            model: provider.model,
            userInput: prompt,
            registry,
            skillOverride: skillOverride as string | undefined,
          });

          skillMessage = `Using skill: ${selection.skill.frontmatter.name} -- ${selection.reasoning}`;
          auditLogger.logSkillSelection(
            selection.skill.frontmatter.name,
            selection.reasoning,
            !!skillOverride,
          );

          // Routing enforcement: if skill declares a preferred_model, the registry MUST resolve it
          // to a DIFFERENT model than default. No fallbacks allowed — fail hard with throw.
          const preferredRole = selection.skill.frontmatter.preferred_model;
          if (preferredRole && preferredRole !== 'default') {
            const resolvedModel = provider.registry.get(preferredRole);
            const defaultModel = provider.registry.getDefault();
            const resolvedId = (resolvedModel as any).modelId ?? 'unknown';
            const defaultId = (defaultModel as any).modelId ?? 'unknown';

            // Three-layer check: object identity, modelId comparison, and unknown sentinel
            const sameObject = resolvedModel === defaultModel;
            const sameId = resolvedId === defaultId;
            const isUnknown = resolvedId === 'unknown';

            if (sameObject || (sameId && !isUnknown) || isUnknown) {
              const msg = `ROUTING HALT: skill "${selection.skill.frontmatter.name}" requires role "${preferredRole}" (expected distinct model) but got "${resolvedId}" which matches default "${defaultId}". Configure modelMap.${preferredRole}.`;
              auditLogger.logError(msg);
              console.error(`[ROUTING] ${msg}`);
              res.status(503).json({
                error: msg,
                hint: `Add "${preferredRole}" to your modelMap configuration. This skill cannot run on the default model.`,
                debug: { preferredRole, resolvedId, defaultId, sameObject, sameId },
              });
              return;
            }

            // Log successful routing for debugging
            console.log(`[ROUTING] Skill "${selection.skill.frontmatter.name}" routed to ${preferredRole} model: ${resolvedId} (default: ${defaultId})`);
          }

          // Run discovery commands to get ground truth BEFORE LLM call
          const { context: discoveryContext, raw: discoveryRaw } = await runDiscovery(selection.skill);

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
          // Extract PIDs from idle connections detail for explicit rolling context
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
          const rewriteRules = selection.skill.frontmatter.rewrite_rules ?? [];

          // For DB skills, prioritize the DB container at the front of the list
          const dbContainer = findDbContainer(allContainers);
          const targetContainers = dbContainer
            ? [dbContainer, ...allContainers.filter(c => c !== dbContainer)]
            : allContainers;

          // Generate diagnosis with skill context + discovery data
          // Use preferred_model from skill frontmatter — routing enforcement above ensures it's valid
          let diagnosis: string;
          let structuredDiagnosis: StructuredDiagnosis | undefined;

          // Attempt structured diagnosis via generateObject for skills with discovery data
          if (discoveryContext && preferredRole) {
            try {
              const targetModel = provider.registry.get(preferredRole);
              const { object } = await generateObject({
                model: targetModel,
                schema: StructuredDiagnosisSchema,
                system: systemPrompt,
                prompt: preFilteredPrompt,
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
            } catch (structuredErr) {
              // Fallback to free-text if structured generation fails
              auditLogger.logError(`Structured diagnosis failed, falling back to free-text: ${(structuredErr as Error).message}`);
              diagnosis = await provider.generateCommand(preFilteredPrompt, systemPrompt, preferredRole);
            }
          } else {
            diagnosis = await provider.generateCommand(preFilteredPrompt, systemPrompt, preferredRole);
          }

          // Sanity checker: scan diagnosis for hallucination patterns
          const violations = checkForHallucinations(diagnosis);
          if (violations.length > 0) {
            auditLogger.logError(`Sanity check failed (attempt 1): ${violations.join('; ')}`);

            // Retry once with strict grounding penalty
            const retryPrompt = preFilteredPrompt + STRICT_GROUNDING_PENALTY;
            const retryDiagnosis = await provider.generateCommand(retryPrompt, systemPrompt, preferredRole);
            const retryViolations = checkForHallucinations(retryDiagnosis);

            if (retryViolations.length > 0) {
              // Both attempts failed — return 422
              auditLogger.logError(`Sanity check failed (attempt 2, halting): ${retryViolations.join('; ')}`);
              res.status(422).json({
                error: 'Diagnosis failed sanity check: LLM output contains hallucinated placeholders or example data',
                violations: retryViolations,
                hint: 'The LLM generated placeholder names instead of using real discovery data. This may indicate the model needs more context or a different model role.',
              });
              return;
            }

            // Retry succeeded
            diagnosis = retryDiagnosis;
          }

          // Always attempt fix plan generation from any skill's diagnosis
          const planningSkill = registry.get('planning');
          if (planningSkill) {
            try {
              // Include discovery context in the diagnosis passed to planner
              const enrichedDiagnosis = discoveryContext
                ? `${diagnosis}\n\n${discoveryContext}`
                : diagnosis;

              fixPlan = await generateFixPlan({
                model: provider.model,
                skill: planningSkill,
                userInput: prompt,
                diagnosis: enrichedDiagnosis,
                registry: provider.registry,
              });

              // Apply dynamic rewrite rules to generated fix plan
              if (rewriteRules.length > 0 && targetContainers.length > 0) {
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
            } catch (planErr) {
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
            // Use findDbContainer to pick the DB container (e.g. postgres-demo), not leaky-app
            planTarget = findDbContainer(allContainers);
          }
          if (!planTarget && fixPlan) {
            const firstWriteStep = fixPlan.steps.find(s => s.risk === 'write' || s.risk === 'destructive');
            if (firstWriteStep) {
              planTarget = extractTarget(firstWriteStep.command);
            }
          }

          res.json({
            sessionId,
            skillMessage,
            diagnosis,
            ...(structuredDiagnosis && { structuredDiagnosis }),
            commands,
            ...(Object.keys(discoveryRaw).length > 0 && { discovery: discoveryRaw }),
            ...(fixPlan && { fixPlan }),
            ...(planMarkdown && { planMarkdown }),
            ...(planTable && { planTable }),
            ...(planTarget && { target: planTarget }),
            ...(fixPlan && { executeHint: 'POST /execute with { sessionId, fixPlan, target, adminName }' }),
            ...(incompleteSession && { incompleteSession }),
          });
          return;
        } catch (skillErr) {
          // Graceful degradation: fall through to direct LLM call
          auditLogger.logError(`Skill selection failed, falling back to direct LLM: ${(skillErr as Error).message}`);
        }
      }

      // Fallback: direct LLM call (no skills loaded or skill selection failed)
      // Pre-filter log-heavy prompts before LLM call to save tokens
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
