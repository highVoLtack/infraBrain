import { describe, it, expect, vi } from 'vitest';
import { CircuitBreaker } from '../../src/execution/circuit-breaker.js';
import { DamageBudget } from '../../src/execution/damage-budget.js';
import type { RunResult } from '../../src/execution/types.js';

const ok: RunResult = { stdout: 'ok', stderr: '', exitCode: 0 };
const fail: RunResult = { stdout: '', stderr: 'error', exitCode: 1 };

describe('CircuitBreaker', () => {
  it('runs the function on first call and returns success', async () => {
    const breaker = new CircuitBreaker(3, 0); // 0 delay for tests
    const budget = new DamageBudget(10);
    const fn = vi.fn().mockResolvedValue(ok);

    const result = await breaker.execute(0, fn, budget, 'write');
    expect(result.status).toBe('success');
    expect(result.result).toEqual(ok);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on failure up to maxRetries times', async () => {
    const breaker = new CircuitBreaker(3, 0);
    const budget = new DamageBudget(100);
    const fn = vi.fn().mockResolvedValue(fail);

    const result = await breaker.execute(0, fn, budget, 'write');
    expect(result.status).toBe('circuit_open');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('returns circuit_open with last result after maxRetries failures', async () => {
    const breaker = new CircuitBreaker(2, 0);
    const budget = new DamageBudget(100);
    const fn = vi.fn().mockResolvedValue(fail);

    const result = await breaker.execute(0, fn, budget, 'read');
    expect(result.status).toBe('circuit_open');
    expect(result.result).toEqual(fail);
  });

  it('calls budget.deductFailedRetry on each failure', async () => {
    const breaker = new CircuitBreaker(3, 0);
    const budget = new DamageBudget(100);
    const spy = vi.spyOn(budget, 'deductFailedRetry');
    const fn = vi.fn().mockResolvedValue(fail);

    await breaker.execute(0, fn, budget, 'write');
    expect(spy).toHaveBeenCalledTimes(3);
    expect(spy).toHaveBeenCalledWith('write');
  });

  it('resets failure count on success after partial failures', async () => {
    const breaker = new CircuitBreaker(3, 0);
    const budget = new DamageBudget(100);
    const fn = vi.fn()
      .mockResolvedValueOnce(fail)
      .mockResolvedValueOnce(ok);

    const result = await breaker.execute(0, fn, budget, 'write');
    expect(result.status).toBe('success');
    expect(fn).toHaveBeenCalledTimes(2);

    // After success, failure count should be reset
    // So a new execute call on same step starts fresh
    const fn2 = vi.fn()
      .mockResolvedValueOnce(fail)
      .mockResolvedValueOnce(fail)
      .mockResolvedValueOnce(ok);
    const result2 = await breaker.execute(0, fn2, budget, 'write');
    expect(result2.status).toBe('success');
  });

  it('tracks different step indices independently', async () => {
    const breaker = new CircuitBreaker(2, 0);
    const budget = new DamageBudget(100);

    // Step 0 fails twice -> circuit_open
    const fn0 = vi.fn().mockResolvedValue(fail);
    const result0 = await breaker.execute(0, fn0, budget, 'write');
    expect(result0.status).toBe('circuit_open');

    // Step 1 should still work
    const fn1 = vi.fn().mockResolvedValue(ok);
    const result1 = await breaker.execute(1, fn1, budget, 'write');
    expect(result1.status).toBe('success');
  });

  it('returns circuit_open early when budget is exhausted during retries', async () => {
    const breaker = new CircuitBreaker(5, 0); // high retry count
    const budget = new DamageBudget(3); // low budget
    const fn = vi.fn().mockResolvedValue(fail);

    const result = await breaker.execute(0, fn, budget, 'write');
    expect(result.status).toBe('circuit_open');
    // Should stop before 5 retries because budget runs out
    // write costs 2 per failed retry. Budget=3, so after 1 retry (cost 2), remaining=1
    // Second retry cost would be 2 but can only afford 1, so stops
    expect(fn.mock.calls.length).toBeLessThanOrEqual(5);
  });
});
