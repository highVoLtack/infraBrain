import type { RunResult } from './types.js';
import type { DamageBudget } from './damage-budget.js';

export interface CircuitBreakerResult {
  status: 'success' | 'circuit_open';
  result?: RunResult;
}

export class CircuitBreaker {
  private failures = new Map<number, number>();
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;

  constructor(maxRetries = 3, retryDelayMs = 1000) {
    this.maxRetries = maxRetries;
    this.retryDelayMs = retryDelayMs;
  }

  async execute(
    stepIndex: number,
    fn: () => Promise<RunResult>,
    budget: DamageBudget,
    risk: 'read' | 'write' | 'destructive',
  ): Promise<CircuitBreakerResult> {
    let attempts = 0;

    while (attempts < this.maxRetries) {
      const result = await fn();

      if (result.exitCode === 0) {
        // Success -- reset failure count for this step
        this.failures.set(stepIndex, 0);
        return { status: 'success', result };
      }

      // Failure
      attempts++;
      this.failures.set(stepIndex, attempts);
      budget.deductFailedRetry(risk);

      if (attempts >= this.maxRetries) {
        return { status: 'circuit_open', result };
      }

      // Check if budget is exhausted before retrying
      const retryCost = budget.costFor(risk) * 2; // failed retry cost
      if (!budget.canAfford(retryCost)) {
        return { status: 'circuit_open', result };
      }

      // Wait before retry
      if (this.retryDelayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, this.retryDelayMs));
      }
    }

    // Should not reach here, but safety fallback
    return { status: 'circuit_open' };
  }
}
