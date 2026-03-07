import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  estimateTokens,
  checkBudget,
  trackUsage,
  type BudgetCheck,
} from '../../src/llm/token-budget.js';
import type { TaskBudget, TokenUsage } from '../../src/llm/types.js';

describe('estimateTokens', () => {
  it('returns approximately 2-3 for "hello world" (4-chars-per-token heuristic)', () => {
    const result = estimateTokens('hello world');
    // "hello world" = 11 chars, 11/4 = 2.75, ceil = 3
    expect(result).toBeGreaterThanOrEqual(2);
    expect(result).toBeLessThanOrEqual(3);
  });

  it('returns 0 for empty string', () => {
    const result = estimateTokens('');
    expect(result).toBe(0);
  });

  it('handles non-ASCII text with adjusted factor', () => {
    // CJK characters should use ~2 chars per token
    const cjkText = '\u4f60\u597d\u4e16\u754c'; // 4 CJK characters
    const result = estimateTokens(cjkText);
    // 4 chars / 2 = 2 tokens
    expect(result).toBeGreaterThanOrEqual(2);
  });
});

describe('checkBudget', () => {
  it('returns allowed: true when under budget', () => {
    const budget: TaskBudget = { maxTokens: 100, taskType: 'diagnosis' };
    const result = checkBudget('short prompt', 'system', budget);

    expect(result.allowed).toBe(true);
    expect(result.estimatedTokens).toBeGreaterThan(0);
    expect(result.budgetTokens).toBe(100);
    expect(result.overflow).toBeUndefined();
  });

  it('returns allowed: false when exceeding budget', () => {
    const budget: TaskBudget = { maxTokens: 5, taskType: 'diagnosis' };
    // Create a long prompt that exceeds 5 tokens
    const longPrompt = 'a'.repeat(100);
    const result = checkBudget(longPrompt, 'system prompt', budget);

    expect(result.allowed).toBe(false);
    expect(result.estimatedTokens).toBeGreaterThan(5);
    expect(result.budgetTokens).toBe(5);
    expect(result.overflow).toBeDefined();
    expect(result.overflow).toBeGreaterThan(0);
  });
});

describe('trackUsage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('logs warning when actual tokens exceed 80% of budget', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});

    const usage: TokenUsage = { promptTokens: 90, completionTokens: 10, totalTokens: 100 };
    const budget: TaskBudget = { maxTokens: 100, taskType: 'diagnosis' };

    trackUsage(usage, budget);

    expect(warnSpy).toHaveBeenCalled();
    expect(debugSpy).toHaveBeenCalled();
  });

  it('does not warn when under 80% threshold', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});

    const usage: TokenUsage = { promptTokens: 50, completionTokens: 10, totalTokens: 60 };
    const budget: TaskBudget = { maxTokens: 100, taskType: 'diagnosis' };

    trackUsage(usage, budget);

    expect(warnSpy).not.toHaveBeenCalled();
    expect(debugSpy).toHaveBeenCalled();
  });
});
