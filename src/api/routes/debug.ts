import { Router } from 'express';
import type { LLMProvider } from '../../llm/types.js';
import type { AuditLogger } from '../../audit/logger.js';
import type { ValidationResult } from '../../safety/types.js';
import type { SkillRegistry } from '../../skills/registry.js';
import type { WriteThrough } from '../../state/store.js';
import type { InfraBrainConfig } from '../../config/types.js';
import { selectSkill } from '../../orchestrator/router.js';
import { generateFixPlan, generatePlanMarkdown, formatPlanTable } from '../../orchestrator/planner.js';
import { enforceSkillAllowlist } from '../../skills/allowlist.js';
import { buildMessages } from '../../orchestrator/context.js';
import type { FixPlan } from '../../orchestrator/types.js';
import { extractTarget } from '../../cli/approval.js';
import { v7 as uuidv7 } from 'uuid';
import { runCommand, parseCommand } from '../../execution/runner.js';
import { encodeForLLM, measureSavings } from '../../llm/toon-encoder.js';
import { parseLog } from '../../log-analysis/parsers/index.js';
import { preFilterLogs, formatForLLM } from '../../log-analysis/filter.js';

const DEV_MODE = process.env.NODE_ENV !== 'production';

/** Regex matching common log indicators: level keywords and ISO-ish timestamps */
const LOG_INDICATOR = /\b(ERROR|WARN|INFO|DEBUG|FATAL|CRITICAL)\b|\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/i;

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
 * Discovery commands that the orchestrator runs automatically before LLM diagnosis.
 * These provide ground truth so the LLM doesn't hallucinate container/network names.
 */
const DISCOVERY_COMMANDS: Record<string, { command: string; label: string }[]> = {
  'nginx-troubleshoot': [
    { command: 'docker ps --format "{{.Names}}"', label: 'Running containers' },
    { command: 'docker network ls --format "{{.Name}}"', label: 'Docker networks' },
  ],
};

/**
 * Run discovery commands and return TOON-encoded context string.
 * These are READ-only commands run before the LLM to prevent hallucination.
 */
async function runDiscovery(skillName: string): Promise<{ context: string; raw: Record<string, string> }> {
  const commands = DISCOVERY_COMMANDS[skillName];
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

          // Run discovery commands to get ground truth BEFORE LLM call
          const { context: discoveryContext, raw: discoveryRaw } = await runDiscovery(selection.skill.frontmatter.name);

          if (discoveryContext) {
            auditLogger.logExecution('discovery_complete', {
              skill: selection.skill.frontmatter.name,
              discoveredData: discoveryRaw,
            });
          }

          // Use skill's system prompt
          const { system } = buildMessages(selection.skill, prompt);
          systemPrompt = system;

          // Build enriched prompt with discovery context injected
          const enrichedPrompt = discoveryContext
            ? `${prompt}\n\n${discoveryContext}\n\nIMPORTANT: Use ONLY the container and network names shown above. Do NOT invent names.`
            : prompt;

          // Pre-filter log-heavy prompts before LLM call to save tokens
          const { filtered: preFilteredPrompt, wasFiltered: logWasFiltered } = preFilterIfLogHeavy(enrichedPrompt);

          // Generate diagnosis with skill context + discovery data
          // Use preferred_model from skill frontmatter if specified, otherwise default
          const preferredRole = selection.skill.frontmatter.preferred_model;
          const diagnosis = await provider.generateCommand(preFilteredPrompt, systemPrompt, preferredRole);

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

          // Extract target from first WRITE/DESTRUCTIVE step for downstream execution
          let planTarget: string | undefined;
          if (fixPlan) {
            const firstWriteStep = fixPlan.steps.find(s => s.risk === 'write' || s.risk === 'destructive');
            if (firstWriteStep) {
              planTarget = extractTarget(firstWriteStep.command);
            }
          }

          res.json({
            sessionId,
            skillMessage,
            diagnosis,
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
