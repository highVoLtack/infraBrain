import type { FixStep, RunResult } from './types.js';
import { estimateTokens } from '../llm/token-budget.js';

interface StepEntry {
  stepIndex: number;
  step: FixStep;
  result: RunResult;
}

/**
 * Rolling LLM context builder that tracks step results and automatically
 * compresses older entries when approaching token budget limits.
 */
export class RollingContext {
  private entries: StepEntry[] = [];
  private readonly tokenBudget: number;

  constructor(tokenBudget: number) {
    this.tokenBudget = tokenBudget;
  }

  /**
   * Add a step result to the rolling context.
   */
  addStepResult(stepIndex: number, step: FixStep, result: RunResult): void {
    this.entries.push({ stepIndex, step, result });
  }

  /**
   * Build context string from all step results.
   * If total estimated tokens exceed 80% of budget, compresses older results
   * while keeping the most recent 2 steps in full detail.
   *
   * Full format:
   *   ## Step {N}: {description}
   *   Command: {command}
   *   Exit code: {exitCode}
   *   Output:
   *   {stdout}
   *   Errors:
   *   {stderr}
   *
   * Compressed format:
   *   Step {N} ({description}): {OK|FAILED} - {first 100 chars of stdout}
   */
  getContext(): string {
    if (this.entries.length === 0) return '';

    // First try all full format
    const allFull = this.entries.map(e => this.formatFull(e)).join('\n\n');
    const estimatedTotal = estimateTokens(allFull);

    if (estimatedTotal <= this.tokenBudget * 0.8) {
      return allFull;
    }

    // Need compression: keep last 2 full, compress the rest
    const keepFullCount = Math.min(2, this.entries.length);
    const compressCount = this.entries.length - keepFullCount;

    const parts: string[] = [];

    // Compressed older entries
    for (let i = 0; i < compressCount; i++) {
      parts.push(this.formatCompressed(this.entries[i]));
    }

    // Full recent entries
    for (let i = compressCount; i < this.entries.length; i++) {
      parts.push(this.formatFull(this.entries[i]));
    }

    return parts.join('\n\n');
  }

  private formatFull(entry: StepEntry): string {
    const { stepIndex, step, result } = entry;
    let output = `## Step ${stepIndex}: ${step.description}\nCommand: ${step.command}\nExit code: ${result.exitCode}\nOutput:\n${result.stdout}`;

    if (result.stderr) {
      output += `\nErrors:\n${result.stderr}`;
    }

    return output;
  }

  private formatCompressed(entry: StepEntry): string {
    const { stepIndex, step, result } = entry;
    const status = result.exitCode === 0 ? 'OK' : 'FAILED';
    const firstChunk = result.stdout.slice(0, 100) || 'no output';
    return `Step ${stepIndex} (${step.description}): ${status} - ${firstChunk}`;
  }
}
