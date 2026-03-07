import type { TaskBudget, TokenUsage } from './types.js';

export interface BudgetCheck {
  allowed: boolean;
  estimatedTokens: number;
  budgetTokens: number;
  overflow?: number;
}

/**
 * Estimate token count for a text string.
 * Uses 4-chars-per-token heuristic for ASCII, 2-chars-per-token for non-ASCII.
 */
export function estimateTokens(text: string): number {
  if (text.length === 0) return 0;

  let asciiChars = 0;
  let nonAsciiChars = 0;

  for (const char of text) {
    if (char.charCodeAt(0) <= 127) {
      asciiChars++;
    } else {
      nonAsciiChars++;
    }
  }

  const asciiTokens = asciiChars / 4;
  const nonAsciiTokens = nonAsciiChars / 2;

  return Math.ceil(asciiTokens + nonAsciiTokens);
}

/**
 * Check whether a prompt + system prompt fit within a task's token budget.
 */
export function checkBudget(
  prompt: string,
  systemPrompt: string,
  budget: TaskBudget,
): BudgetCheck {
  const estimatedTokens = estimateTokens(prompt + systemPrompt);

  if (estimatedTokens <= budget.maxTokens) {
    return {
      allowed: true,
      estimatedTokens,
      budgetTokens: budget.maxTokens,
    };
  }

  return {
    allowed: false,
    estimatedTokens,
    budgetTokens: budget.maxTokens,
    overflow: estimatedTokens - budget.maxTokens,
  };
}

/**
 * Track actual token usage from an AI SDK response and warn when approaching budget.
 */
export function trackUsage(actual: TokenUsage, budget: TaskBudget): void {
  const threshold = budget.maxTokens * 0.8;

  console.debug(
    `[TokenBudget] ${budget.taskType}: ${actual.promptTokens} prompt + ${actual.completionTokens} completion = ${actual.totalTokens} total (budget: ${budget.maxTokens})`,
  );

  if (actual.promptTokens > threshold) {
    console.warn(
      `[TokenBudget] WARNING: ${budget.taskType} prompt tokens (${actual.promptTokens}) exceeded 80% of budget (${budget.maxTokens}). Consider reducing prompt size.`,
    );
  }
}
