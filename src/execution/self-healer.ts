import { generateText } from 'ai';
import type { FixStep } from '../orchestrator/types.js';
import type { RunResult, SelfHealResult, SelfHealContext, CorrectionAttempt } from './types.js';
import type { SkillFile } from '../skills/types.js';
import { enforceSkillAllowlist } from '../skills/allowlist.js';
import { validateCommand } from '../safety/validator.js';
import { dynamicRewrite } from './dynamic-rewriter.js';
import { needsShell, runShellCommand, parseCommand } from './runner.js';
import { RiskLevel } from '../safety/types.js';

/**
 * Build a human-readable tool list from a skill's tool declarations.
 * Includes risk level and privilege info so the LLM knows what's available.
 *
 * Example output:
 *   "stat (read), ls (read), chown (write, runs as root via -u 0), chmod (write, runs as root via -u 0)"
 */
export function buildToolListFromSkill(skill: SkillFile): string {
  const tools = skill.frontmatter.tools;
  if (!tools || Array.isArray(tools)) {
    // Legacy string[] format — just list names
    return Array.isArray(tools) ? tools.join(', ') : '';
  }

  return Object.entries(tools)
    .map(([name, decl]) => {
      const parts = [name, `(${decl.risk}`];
      if (decl.user) {
        parts.push(`, runs as root via -u ${decl.user}`);
      }
      if (decl.wrapper) {
        parts.push(`, wrapped`);
      }
      parts.push(')');
      return parts.join('');
    })
    .join(', ');
}

/**
 * Extract domain knowledge sections from a skill's system prompt.
 * Returns relevant sections that help the LLM make better corrections.
 */
export function extractSkillDomainKnowledge(skill: SkillFile): string {
  const systemPrompt = skill.sections.systemPrompt;
  if (!systemPrompt) return '';

  // Extract ## DOMAIN KNOWLEDGE and ## COMMON MISTAKES sections
  const sections: string[] = [];
  const lines = systemPrompt.split('\n');
  let capturing = false;
  let currentSection: string[] = [];

  for (const line of lines) {
    if (/^##\s+(DOMAIN KNOWLEDGE|COMMON MISTAKES)/i.test(line)) {
      if (currentSection.length > 0) {
        sections.push(currentSection.join('\n'));
      }
      currentSection = [line];
      capturing = true;
    } else if (capturing && /^##\s/.test(line) && !/^##\s+(DOMAIN KNOWLEDGE|COMMON MISTAKES)/i.test(line)) {
      sections.push(currentSection.join('\n'));
      currentSection = [];
      capturing = false;
    } else if (capturing) {
      currentSection.push(line);
    }
  }
  if (currentSection.length > 0) {
    sections.push(currentSection.join('\n'));
  }

  return sections.join('\n\n');
}

/**
 * Infer correction hints from stderr patterns.
 * These are agnostic transformation rules: "if error says X, try Y instead".
 * Helps the LLM avoid repeating the same mistake.
 */
export function inferCorrectionHints(stderr: string): string | null {
  const lower = stderr.toLowerCase();
  const hints: string[] = [];

  // "already exists" → use ALTER/UPDATE instead of CREATE/INSERT
  if (lower.includes('already exists')) {
    hints.push('- The resource already exists. Use ALTER/UPDATE/MODIFY instead of CREATE/INSERT/ADD.');
  }
  // Permission denied → privilege escalation
  if (lower.includes('permission denied') || lower.includes('operation not permitted')) {
    hints.push('- Permission denied. Try running with elevated privileges (e.g. -u 0 on docker exec, sudo, or as a different user).');
  }
  // No such file or directory → check parent, use different path
  if (lower.includes('no such file') || lower.includes('not found')) {
    hints.push('- Path does not exist. Check the parent directory, or the resource may not have been created yet.');
  }
  // Connection refused / unreachable → network isolation
  if (lower.includes('connection refused') || lower.includes('name or service not known') || lower.includes('unreachable')) {
    hints.push('- Connection failed. The target may be on a different Docker network. Use `docker network connect` to bridge networks.');
  }
  // TTY error → remove -it flags
  if (lower.includes('not a tty') || lower.includes('input device is not a tty')) {
    hints.push('- TTY error. Remove -it or -t flags from docker exec. Use -i only, or neither.');
  }
  // Syntax / command not found
  if (lower.includes('command not found') || lower.includes('syntax error')) {
    hints.push('- Command not found or syntax error. Check the command exists in the container and the syntax is correct.');
  }

  return hints.length > 0 ? hints.join('\n') : null;
}

/**
 * Build a correction prompt for the LLM given a failed command context.
 * Each prompt is fresh -- no previous attempts included (per user decision).
 * Enriched with skill domain knowledge, tool declarations, and discovery context.
 */
export function buildCorrectionPrompt(ctx: {
  originalCommand: string;
  stderr: string;
  exitCode: number;
  stepDescription: string;
  availableTools: string;
  containerContext: string;
  domainKnowledge?: string;
  rollingContext?: string;
  correctionHistory?: string;
}): string {
  const parts = [
    `The following command failed during execution.`,
    ``,
    `Command: ${ctx.originalCommand}`,
    `Exit code: ${ctx.exitCode}`,
    `Error output:`,
    ctx.stderr,
    ``,
    `Step description: ${ctx.stepDescription}`,
  ];

  if (ctx.correctionHistory) {
    parts.push(``, `Previous correction attempts (do NOT repeat these):`, ctx.correctionHistory);
  }

  if (ctx.availableTools) {
    parts.push(``, `Available tools: ${ctx.availableTools}`);
  }

  parts.push(``, `Environment context:`, ctx.containerContext);

  if (ctx.rollingContext) {
    parts.push(``, `Previous step results:`, ctx.rollingContext);
  }

  if (ctx.domainKnowledge) {
    parts.push(``, `Domain knowledge (from skill):`, ctx.domainKnowledge);
  }

  // Add error-specific correction hints (agnostic, derived from stderr patterns)
  const hints = inferCorrectionHints(ctx.stderr);
  if (hints) {
    parts.push(``, `Correction hints based on error pattern:`, hints);
  }

  parts.push(
    ``,
    `Generate a corrected command that achieves the same goal. Do NOT repeat the same command that already failed. Output ONLY the corrected command, nothing else.`,
  );

  return parts.join('\n');
}

/**
 * Build a prompt asking LLM for a read-only verification command.
 */
export function buildEffectVerificationPrompt(ctx: {
  correctedCommand: string;
  stepDescription: string;
  containerContext: string;
}): string {
  return `The command \`${ctx.correctedCommand}\` was executed to achieve: ${ctx.stepDescription}.

Environment context:
${ctx.containerContext}

Generate a single READ-ONLY verification command that checks whether the intended effect actually happened.
The command must be a read operation (ls, stat, cat, id, etc.) -- never a write.
Output ONLY the verification command, nothing else.`;
}

/**
 * Prose prefixes that indicate LLM explanation rather than a command.
 */
const PROSE_PREFIXES = /^(The|This|I|You|Note|Here|To)\b/i;

/**
 * Extract a clean command from LLM response text.
 * Strips markdown fences, prose prefixes, and whitespace.
 */
export function extractCommandFromLLMResponse(text: string): string {
  let cleaned = text.trim();

  // Strip markdown code fences
  const fenceMatch = cleaned.match(/```(?:\w*)\n([\s\S]*?)```/);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  }

  // Split into lines and find first command-like line
  const lines = cleaned.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  for (const line of lines) {
    // Skip short lines
    if (line.length < 3) continue;
    // Skip prose lines
    if (PROSE_PREFIXES.test(line)) continue;
    // Skip lines ending with colon (likely a label)
    if (line.endsWith(':')) continue;
    return line;
  }

  // Fallback: return full cleaned text
  return cleaned;
}

/**
 * Validate a corrected command through the full safety pipeline:
 * 1. enforceSkillAllowlist
 * 2. validateCommand
 * 3. dynamicRewrite
 */
export async function validateCorrectedCommand(
  command: string,
  context: SelfHealContext,
): Promise<{ allowed: boolean; command?: string; reason?: string }> {
  // Step 1: Skill allowlist
  const allowlistResult = enforceSkillAllowlist(command, context.skill);
  if (!allowlistResult.allowed) {
    return { allowed: false, reason: allowlistResult.reason };
  }

  // Step 2: Safety validator
  const validationResult = validateCommand(command, context.config as any);
  if (!validationResult.allowed) {
    return { allowed: false, reason: validationResult.reason };
  }

  // Step 3: Dynamic rewrite
  const rewritten = dynamicRewrite(validationResult.command, context.rewriteRules, context.containers);

  return { allowed: true, command: rewritten };
}

/**
 * Verify the effect of a corrected command via a read-only check.
 * Only called for WRITE-risk or DESTRUCTIVE-risk steps.
 * Fail-open: if verification command generation or validation fails, return success.
 */
export async function verifyEffect(
  correctedCommand: string,
  context: SelfHealContext,
): Promise<{ verified: boolean; evidence?: string; reason?: string; skipped?: boolean }> {
  // Skip verification for read-risk steps
  if (context.stepRisk === 'read') {
    return { verified: true, skipped: true };
  }

  try {
    // Ask LLM for a verification command
    const prompt = buildEffectVerificationPrompt({
      correctedCommand,
      stepDescription: context.stepDescription,
      containerContext: context.containerContext,
    });

    const { text } = await generateText({
      model: context.model,
      prompt,
      maxTokens: 200,
    });

    const verificationCommand = extractCommandFromLLMResponse(text);

    // Validate verification command through safety pipeline
    const validationResult = validateCommand(verificationCommand);
    if (!validationResult.allowed) {
      // Fail-open: can't validate verification command, skip
      return { verified: true, skipped: true };
    }

    // Verification command must be read-risk only
    if (validationResult.riskLevel !== RiskLevel.READ) {
      // Fail-open: verification command is not read-only, skip
      return { verified: true, skipped: true };
    }

    // Execute verification command
    let verifyResult: RunResult;
    if (needsShell(validationResult.command)) {
      verifyResult = await runShellCommand(validationResult.command, {
        timeout: context.config.execution.commandTimeoutMs,
      });
    } else {
      const parsed = parseCommand(validationResult.command);
      verifyResult = await context.runner.run(parsed.executable, parsed.args, {
        timeout: context.config.execution.commandTimeoutMs,
      });
    }

    if (verifyResult.exitCode === 0 && verifyResult.stdout.trim().length > 0) {
      return { verified: true, evidence: verifyResult.stdout };
    }

    return { verified: false, reason: verifyResult.stderr || 'no output' };
  } catch {
    // Fail-open on any error
    return { verified: true, skipped: true };
  }
}

/**
 * Detect whether the error type changed between two failures.
 * A change means the last correction made progress (e.g. "Permission denied" → "No such file").
 * Uses the first meaningful word/phrase from stderr to classify.
 */
export function errorTypeChanged(prevStderr: string, currentStderr: string): boolean {
  const classify = (stderr: string): string => {
    const lower = stderr.toLowerCase();
    if (lower.includes('permission denied') || lower.includes('operation not permitted')) return 'permission';
    if (lower.includes('no such file') || lower.includes('not found')) return 'not_found';
    if (lower.includes('connection refused') || lower.includes('cannot connect')) return 'connection';
    if (lower.includes('timeout') || lower.includes('timed out')) return 'timeout';
    if (lower.includes('out of memory') || lower.includes('oom')) return 'oom';
    if (lower.includes('disk full') || lower.includes('no space')) return 'disk';
    // Fallback: first 40 chars as fingerprint
    return lower.slice(0, 40).trim();
  };
  return classify(prevStderr) !== classify(currentStderr);
}

/**
 * Self-healing step: retry a failed command with LLM-corrected alternatives.
 *
 * Dynamic error-driven loop:
 * - Tracks the "working command" — starts as the original, evolves as corrections make progress
 * - Detects error-type changes: if the error shifts (e.g. "Permission denied" → "No such file"),
 *   the last correction was partial progress → adopt it as the new base command
 * - Accumulates correction history so the LLM sees what was already tried
 * - Grants bonus attempts when progress is detected (error type changes)
 */
export async function selfHealStep(
  step: FixStep,
  failedResult: RunResult,
  context: SelfHealContext,
): Promise<SelfHealResult> {
  const attempts: CorrectionAttempt[] = [];
  let currentError = failedResult;
  let workingCommand = step.command; // Evolves as corrections make progress
  const stepRisk = context.stepRisk;
  const maxAttempts = context.maxAttempts;
  let attemptsRemaining = maxAttempts;

  while (attemptsRemaining > 0) {
    attemptsRemaining--;

    // 1. Check damage budget
    const cost = context.budget.costFor(stepRisk);
    if (!context.budget.canAfford(cost)) {
      return { status: 'budget_exceeded', attempts, commandUsed: workingCommand };
    }

    // 2. Build correction history summary for the LLM
    const historyLines = attempts
      .filter(a => a.outcome === 'failed')
      .map((a, idx) => `Attempt ${idx + 1}: tried "${a.correctedCommand}" → ${a.error.stderr.split('\n')[0]}`)
      .join('\n');

    // 3. Build correction prompt with evolving command + history
    const prompt = buildCorrectionPrompt({
      originalCommand: workingCommand,
      stderr: currentError.stderr,
      exitCode: currentError.exitCode,
      stepDescription: context.stepDescription,
      availableTools: context.toolList,
      containerContext: context.containerContext,
      domainKnowledge: context.domainKnowledge,
      rollingContext: context.rollingContext,
      correctionHistory: historyLines || undefined,
    });

    // 4. Call LLM for correction
    const { text } = await generateText({
      model: context.model,
      prompt,
      maxTokens: 500,
    });

    // 5. Parse LLM response
    const correctedCommand = extractCommandFromLLMResponse(text);

    // 6. Validate through full safety pipeline
    const validation = await validateCorrectedCommand(correctedCommand, context);

    if (!validation.allowed) {
      // Safety blocked -- counts as failed attempt
      context.budget.deduct(cost);
      context.auditLogger.logExecution('self_heal_attempt', {
        attempt: attempts.length + 1,
        originalCommand: workingCommand,
        correctedCommand,
        outcome: 'blocked_by_safety',
        reason: validation.reason,
      });
      attempts.push({
        originalCommand: workingCommand,
        correctedCommand,
        error: { stderr: currentError.stderr, exitCode: currentError.exitCode },
        outcome: 'blocked_by_safety',
      });
      continue;
    }

    const finalCommand = validation.command!;

    // 7. Execute corrected command
    let runResult: RunResult;
    if (needsShell(finalCommand)) {
      runResult = await runShellCommand(finalCommand, {
        timeout: context.config.execution.commandTimeoutMs,
      });
    } else {
      const parsed = parseCommand(finalCommand);
      runResult = await context.runner.run(parsed.executable, parsed.args, {
        timeout: context.config.execution.commandTimeoutMs,
      });
    }

    // 8. Deduct budget
    context.budget.deduct(cost);

    // 9. Check result
    if (runResult.exitCode === 0) {
      // For WRITE/DESTRUCTIVE-risk: verify effect
      if (stepRisk === 'write' || stepRisk === 'destructive') {
        const verification = await verifyEffect(finalCommand, context);
        if (!verification.verified) {
          context.auditLogger.logExecution('self_heal_attempt', {
            attempt: attempts.length + 1,
            originalCommand: workingCommand,
            correctedCommand: finalCommand,
            outcome: 'effect_unverified',
            reason: verification.reason,
          });
          attempts.push({
            originalCommand: workingCommand,
            correctedCommand: finalCommand,
            error: { stderr: `Effect verification failed: ${verification.reason}`, exitCode: 1 },
            outcome: 'effect_unverified',
          });
          currentError = {
            stdout: '',
            stderr: `Effect verification failed: ${verification.reason}`,
            exitCode: 1,
          };
          continue;
        }
      }

      // Success
      context.auditLogger.logExecution('self_heal_attempt', {
        attempt: attempts.length + 1,
        originalCommand: workingCommand,
        correctedCommand: finalCommand,
        outcome: 'success',
      });
      attempts.push({
        originalCommand: workingCommand,
        correctedCommand: finalCommand,
        error: { stderr: currentError.stderr, exitCode: currentError.exitCode },
        outcome: 'success',
      });
      return { status: 'success', finalResult: runResult, attempts, commandUsed: finalCommand };
    }

    // 10. Failed — check if error type changed (= partial progress)
    const prevStderr = currentError.stderr;
    const madeProgress = errorTypeChanged(prevStderr, runResult.stderr);

    context.auditLogger.logExecution('self_heal_attempt', {
      attempt: attempts.length + 1,
      originalCommand: workingCommand,
      correctedCommand: finalCommand,
      outcome: 'failed',
      stderr: runResult.stderr,
      exitCode: runResult.exitCode,
      errorTypeChanged: madeProgress,
    });
    attempts.push({
      originalCommand: workingCommand,
      correctedCommand: finalCommand,
      error: { stderr: runResult.stderr, exitCode: runResult.exitCode },
      outcome: 'failed',
    });

    if (madeProgress) {
      // The correction changed the error — adopt corrected command as new base
      workingCommand = finalCommand;
      // Grant bonus attempts (up to original max) since we're making progress
      attemptsRemaining = Math.min(attemptsRemaining + Math.ceil(maxAttempts / 2), maxAttempts);
      context.auditLogger.logExecution('self_heal_progress', {
        attempt: attempts.length,
        previousError: prevStderr.split('\n')[0],
        newError: runResult.stderr.split('\n')[0],
        adoptedCommand: finalCommand,
        bonusAttempts: Math.ceil(maxAttempts / 2),
      });
    }

    currentError = runResult;
  }

  // Exhausted all attempts
  context.auditLogger.logExecution('self_heal_exhausted', {
    originalCommand: step.command,
    finalCommand: workingCommand,
    attempts: attempts.length,
    attemptHistory: attempts,
  });

  return { status: 'exhausted', attempts, commandUsed: workingCommand };
}
