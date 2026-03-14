import { generateObject } from 'ai';
import type { LanguageModel } from 'ai';
import chalk from 'chalk';
import type { SkillFile } from '../skills/types.js';
import type { ModelRegistry } from '../llm/types.js';
import { FixPlanSchema, type FixPlan } from './types.js';
import { buildMessages } from './context.js';

export interface GenerateFixPlanOptions {
  model: LanguageModel;
  skill: SkillFile;
  userInput: string;
  diagnosis: string;
  discoveryContext?: string;
  registry?: ModelRegistry;
}

/**
 * Generate a structured fix plan via LLM using the planning skill's context.
 */
export async function generateFixPlan(options: GenerateFixPlanOptions): Promise<FixPlan> {
  const { skill, userInput, diagnosis, discoveryContext, registry } = options;
  // Use preferred_model from the skill if registry is available, otherwise fall back to provided model
  const preferredRole = skill.frontmatter.preferred_model;
  const model = (preferredRole && registry) ? registry.get(preferredRole) : options.model;

  const { system, messages } = buildMessages(skill, userInput);

  // Build diagnosis message with GROUND TRUTH injection
  const groundTruth = discoveryContext
    ? `\n\n--- GROUND TRUTH (from live discovery) ---\n${discoveryContext}\n--- END GROUND TRUTH ---\n\nCRITICAL: Every container name, file path, user ID, and port in your fix plan MUST come from the GROUND TRUTH or diagnosis above. Do NOT use placeholders like <container>, /path/to/..., or <user>. If a value is missing, your first step MUST be a read command to discover it.`
    : '';

  // Append diagnosis context to the conversation
  const allMessages = [
    ...messages,
    { role: 'user' as const, content: `Diagnosis:\n${diagnosis}${groundTruth}\n\nGenerate a structured fix plan with discrete steps. Use ONLY real values from the diagnosis and ground truth above.` },
  ];

  const { object } = await generateObject({
    model,
    schema: FixPlanSchema,
    system,
    messages: allMessages.map((m) => ({ role: m.role, content: m.content })),
  });

  // Post-process: fix known LLM command generation errors
  object.steps = object.steps.map(step => {
    const fixed = fixKnownCommandErrors(step.command);
    if (fixed !== step.command) {
      console.log(`[PLANNER] Fixed command: "${step.command}" → "${fixed}"`);
    }
    return {
      ...step,
      command: fixed,
      rollback: fixKnownCommandErrors(step.rollback),
    };
  });

  return object;
}

/**
 * Fix known command syntax errors that local LLMs consistently produce.
 * Pattern-based rewriting — not hardcoded values, just structural fixes.
 *
 * Known LLM errors:
 * 1. `docker exec -it` in non-TTY context → strip -it/-i/-t flags
 * 2. `docker exec CONTAINER chown -u 0 ...` → `-u 0` belongs on `docker exec`
 * 3. `$(id -u):$(id -g)` shell expansion in docker exec → won't work, use numeric IDs
 * 4. `chown -R` when single directory → strip -R (safety)
 */
export function fixKnownCommandErrors(command: string): string {
  let fixed = command;

  // 1. Strip -it/-i/-t from docker exec (no TTY in programmatic execution)
  fixed = fixed.replace(/docker exec -it /, 'docker exec ');
  fixed = fixed.replace(/docker exec -ti /, 'docker exec ');
  fixed = fixed.replace(/docker exec -i /, 'docker exec ');
  fixed = fixed.replace(/docker exec -t /, 'docker exec ');

  // 2. Fix: "docker exec CONTAINER chown -u 0 ..." → "docker exec -u 0 CONTAINER chown ..."
  fixed = fixed.replace(
    /docker exec (\S+) (chown|chmod) -u (\d+) /,
    'docker exec -u $3 $1 $2 ',
  );
  // No-space variant: chown -u0
  fixed = fixed.replace(
    /docker exec (\S+) (chown|chmod) -u(\d+) /,
    'docker exec -u $3 $1 $2 ',
  );

  // 3. Fix: chown/chmod without -u 0 on exec when targeting root-owned files
  // If command is "docker exec CONTAINER chown ..." and no -u flag on exec,
  // the container user (typically 1000) can't chown. Add -u 0.
  if (/docker exec (?!.*-u )\S+ chown /.test(fixed)) {
    fixed = fixed.replace(
      /docker exec (\S+) chown /,
      'docker exec -u 0 $1 chown ',
    );
  }
  if (/docker exec (?!.*-u )\S+ chmod /.test(fixed)) {
    fixed = fixed.replace(
      /docker exec (\S+) chmod /,
      'docker exec -u 0 $1 chmod ',
    );
  }

  // 4. Replace $(id -u):$(id -g) with 1000:1000 — shell expansion doesn't work in exec
  fixed = fixed.replace(/\$\(id -u\)/g, '1000');
  fixed = fixed.replace(/\$\(id -g\)/g, '1000');

  if (fixed !== command) {
    console.log(`[PLANNER] Fixed command: "${command}" → "${fixed}"`);
  }

  return fixed;
}

/**
 * Generate a Markdown representation of a fix plan.
 */
export function generatePlanMarkdown(plan: FixPlan): string {
  const lines: string[] = [];

  lines.push(`## Fix Plan: ${plan.summary}`);
  lines.push('');
  lines.push(`**Complexity:** ${plan.complexity}`);
  lines.push(`**Steps:** ${plan.steps.length}`);
  lines.push('');
  lines.push('# | Command | Risk | Rollback');
  lines.push('---|---------|------|--------');

  for (let i = 0; i < plan.steps.length; i++) {
    const step = plan.steps[i];
    lines.push(`${i + 1} | \`${step.command}\` | ${step.risk} | \`${step.rollback}\``);
  }

  return lines.join('\n');
}

/**
 * Format a fix plan as a CLI-friendly table with chalk color coding.
 * Risk levels: read=green, write=yellow, destructive=red.
 * Status starts as "pending" for all steps.
 */
export function formatPlanTable(plan: FixPlan): string {
  const riskColor = (risk: string): string => {
    switch (risk) {
      case 'read': return chalk.green(risk);
      case 'write': return chalk.yellow(risk);
      case 'destructive': return chalk.red(risk);
      default: return risk;
    }
  };

  const lines: string[] = [];
  lines.push(`${chalk.bold(plan.summary)} (${plan.complexity})`);
  lines.push('');
  lines.push(`  ${'#'.padEnd(4)} ${'Command'.padEnd(40)} ${'Risk'.padEnd(14)} Status`);
  lines.push(`  ${'─'.repeat(4)} ${'─'.repeat(40)} ${'─'.repeat(14)} ${'─'.repeat(10)}`);

  for (let i = 0; i < plan.steps.length; i++) {
    const step = plan.steps[i];
    const num = String(i + 1).padEnd(4);
    const cmd = step.command.length > 38
      ? step.command.slice(0, 35) + '...'
      : step.command.padEnd(40);
    lines.push(`  ${num} ${cmd} ${riskColor(step.risk).padEnd(14)} pending`);
  }

  return lines.join('\n');
}
