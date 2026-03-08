import { generateObject } from 'ai';
import type { LanguageModel } from 'ai';
import chalk from 'chalk';
import type { SkillFile } from '../skills/types.js';
import { FixPlanSchema, type FixPlan } from './types.js';
import { buildMessages } from './context.js';

export interface GenerateFixPlanOptions {
  model: LanguageModel;
  skill: SkillFile;
  userInput: string;
  diagnosis: string;
}

/**
 * Generate a structured fix plan via LLM using the planning skill's context.
 */
export async function generateFixPlan(options: GenerateFixPlanOptions): Promise<FixPlan> {
  const { model, skill, userInput, diagnosis } = options;

  const { system, messages } = buildMessages(skill, userInput);

  // Append diagnosis context to the conversation
  const allMessages = [
    ...messages,
    { role: 'user' as const, content: `Diagnosis:\n${diagnosis}\n\nGenerate a structured fix plan with discrete steps.` },
  ];

  const { object } = await generateObject({
    model,
    schema: FixPlanSchema,
    system,
    messages: allMessages.map((m) => ({ role: m.role, content: m.content })),
  });

  return object;
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
