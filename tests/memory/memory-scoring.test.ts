import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { computeMemoryScore } from '../../src/memory/memory-scoring.js';

describe('computeMemoryScore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('at lambda=0.02: 7-day-old incident scores ~0.87 recency', () => {
    const now = new Date('2026-04-14T12:00:00Z');
    vi.setSystemTime(now);

    const createdAt = new Date(now.getTime() - 7 * 86_400_000).toISOString();
    const result = computeMemoryScore(0.8, createdAt, { decayLambda: 0.02 });

    // exp(-0.02 * 7) = exp(-0.14) ~= 0.8694
    expect(result.recencyScore).toBeCloseTo(0.8694, 3);
  });

  it('at lambda=0.02: 30-day-old incident scores ~0.55 recency', () => {
    const now = new Date('2026-04-14T12:00:00Z');
    vi.setSystemTime(now);

    const createdAt = new Date(now.getTime() - 30 * 86_400_000).toISOString();
    const result = computeMemoryScore(0.8, createdAt, { decayLambda: 0.02 });

    // exp(-0.02 * 30) = exp(-0.6) ~= 0.5488
    expect(result.recencyScore).toBeCloseTo(0.5488, 3);
  });

  it('at lambda=0.02: 90-day-old incident scores ~0.17 recency', () => {
    const now = new Date('2026-04-14T12:00:00Z');
    vi.setSystemTime(now);

    const createdAt = new Date(now.getTime() - 90 * 86_400_000).toISOString();
    const result = computeMemoryScore(0.8, createdAt, { decayLambda: 0.02 });

    // exp(-0.02 * 90) = exp(-1.8) ~= 0.1653
    expect(result.recencyScore).toBeCloseTo(0.1653, 3);
  });

  it('combines similarity and recency with configurable weights', () => {
    const now = new Date('2026-04-14T12:00:00Z');
    vi.setSystemTime(now);

    const createdAt = now.toISOString(); // 0 days ago => recency = 1.0
    const similarity = 0.9;

    // Default weights: w_sim=0.6, w_rec=0.4
    const result = computeMemoryScore(similarity, createdAt, { decayLambda: 0.02 });
    expect(result.recencyScore).toBeCloseTo(1.0, 3);
    expect(result.score).toBeCloseTo(0.6 * 0.9 + 0.4 * 1.0, 3); // 0.54 + 0.4 = 0.94

    // Custom weights
    const custom = computeMemoryScore(similarity, createdAt, {
      decayLambda: 0.02,
      w_sim: 0.8,
      w_rec: 0.2,
    });
    expect(custom.score).toBeCloseTo(0.8 * 0.9 + 0.2 * 1.0, 3); // 0.72 + 0.2 = 0.92
  });

  it('zero-day-old incident has recency score of 1.0', () => {
    const now = new Date('2026-04-14T12:00:00Z');
    vi.setSystemTime(now);

    const result = computeMemoryScore(0.5, now.toISOString(), { decayLambda: 0.02 });
    expect(result.recencyScore).toBeCloseTo(1.0, 5);
  });

  it('negative age (future date) clamps to 0 days', () => {
    const now = new Date('2026-04-14T12:00:00Z');
    vi.setSystemTime(now);

    const futureDate = new Date(now.getTime() + 86_400_000).toISOString();
    const result = computeMemoryScore(0.5, futureDate, { decayLambda: 0.02 });
    // Math.max(0, ...) should clamp to 0 days => recency = 1.0
    expect(result.recencyScore).toBeCloseTo(1.0, 5);
  });
});
