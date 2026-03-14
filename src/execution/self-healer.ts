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

  parts.push(
    ``,
    `Generate a corrected command that achieves the same goal. Consider privilege escalation (e.g. -u 0 on docker exec) if the error is permission-related. Output ONLY the corrected command, nothing else.`,
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
 * Self-healing step: retry a failed command with LLM-corrected alternatives.
 *
 * Loop up to maxAttempts times. Each iteration:
 * 1. Check damage budget
 * 2. Ask LLM for corrected command
 * 3. Validate through full safety pipeline
 * 4. Execute corrected command
 * 5. For WRITE/DESTRUCTIVE-risk: verify effect
 * 6. Track attempt and audit log
 */
export async function selfHealStep(
  step: FixStep,
  failedResult: RunResult,
  context: SelfHealContext,
): Promise<SelfHealResult> {
  const attempts: CorrectionAttempt[] = [];
  let currentError = failedResult;
  const stepRisk = context.stepRisk;

  for (let i = 0; i < context.maxAttempts; i++) {
    // 1. Check damage budget
    const cost = context.budget.costFor(stepRisk);
    if (!context.budget.canAfford(cost)) {
      return { status: 'budget_exceeded', attempts, commandUsed: step.command };
    }

    // 2. Build correction prompt (fresh each time, only latest error)
    const prompt = buildCorrectionPrompt({
      originalCommand: step.command,
      stderr: currentError.stderr,
      exitCode: currentError.exitCode,
      stepDescription: context.stepDescription,
      availableTools: context.toolList,
      containerContext: context.containerContext,
      domainKnowledge: context.domainKnowledge,
      rollingContext: context.rollingContext,
    });

    // 3. Call LLM for correction
    const { text } = await generateText({
      model: context.model,
      prompt,
      maxTokens: 500,
    });

    // 4. Parse LLM response
    const correctedCommand = extractCommandFromLLMResponse(text);

    // 5. Validate through full safety pipeline
    const validation = await validateCorrectedCommand(correctedCommand, context);

    if (!validation.allowed) {
      // Safety blocked -- counts as failed attempt
      context.budget.deduct(cost);
      context.auditLogger.logExecution('self_heal_attempt', {
        attempt: i + 1,
        originalCommand: step.command,
        correctedCommand,
        outcome: 'blocked_by_safety',
        reason: validation.reason,
      });
      attempts.push({
        originalCommand: step.command,
        correctedCommand,
        error: { stderr: currentError.stderr, exitCode: currentError.exitCode },
        outcome: 'blocked_by_safety',
      });
      continue;
    }

    const finalCommand = validation.command!;

    // 6. Execute corrected command
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

    // 7. Deduct budget
    context.budget.deduct(cost);

    // 8. Check result
    if (runResult.exitCode === 0) {
      // For WRITE/DESTRUCTIVE-risk: verify effect
      if (stepRisk === 'write' || stepRisk === 'destructive') {
        const verification = await verifyEffect(finalCommand, context);
        if (!verification.verified) {
          // Effect unverified -- continue loop
          context.auditLogger.logExecution('self_heal_attempt', {
            attempt: i + 1,
            originalCommand: step.command,
            correctedCommand: finalCommand,
            outcome: 'effect_unverified',
            reason: verification.reason,
          });
          attempts.push({
            originalCommand: step.command,
            correctedCommand: finalCommand,
            error: { stderr: `Effect verification failed: ${verification.reason}`, exitCode: 1 },
            outcome: 'effect_unverified',
          });
          // Update current error for next iteration
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
        attempt: i + 1,
        originalCommand: step.command,
        correctedCommand: finalCommand,
        outcome: 'success',
      });
      attempts.push({
        originalCommand: step.command,
        correctedCommand: finalCommand,
        error: { stderr: currentError.stderr, exitCode: currentError.exitCode },
        outcome: 'success',
      });
      return { status: 'success', finalResult: runResult, attempts, commandUsed: finalCommand };
    }

    // Failed -- update error context for next attempt
    context.auditLogger.logExecution('self_heal_attempt', {
      attempt: i + 1,
      originalCommand: step.command,
      correctedCommand: finalCommand,
      outcome: 'failed',
      stderr: runResult.stderr,
      exitCode: runResult.exitCode,
    });
    attempts.push({
      originalCommand: step.command,
      correctedCommand: finalCommand,
      error: { stderr: runResult.stderr, exitCode: runResult.exitCode },
      outcome: 'failed',
    });
    currentError = runResult;
  }

  // Exhausted all attempts
  context.auditLogger.logExecution('self_heal_exhausted', {
    originalCommand: step.command,
    attempts: attempts.length,
    attemptHistory: attempts,
  });

  return { status: 'exhausted', attempts, commandUsed: step.command };
}
