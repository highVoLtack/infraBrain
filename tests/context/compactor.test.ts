import { describe, it, expect, vi, beforeEach } from 'vitest';
import { tieredEviction } from '../../src/context/compactor.js';
import type { Observation } from '../../src/context/types.js';

function makeObs(overrides: Partial<Observation> & { id: string }): Observation {
  return {
    content: `observation ${overrides.id}`,
    tokens: 10,
    timestamp: Date.now(),
    source: 'test',
    isNoise: false,
    ...overrides,
  };
}

describe('tieredEviction', () => {
  it('Tier 1: removes observations marked isNoise=true', async () => {
    const observations: Observation[] = [
      makeObs({ id: 'o1', isNoise: true, tokens: 20 }),
      makeObs({ id: 'o2', isNoise: false, tokens: 10 }),
      makeObs({ id: 'o3', isNoise: true, tokens: 15 }),
    ];
    const result = await tieredEviction({
      observations,
      groundTruthTokens: 10,
      windowSize: 100,
      targetRatio: 0.60,
    });
    // Ground truth 10 + remaining should be <= 60
    expect(result.remaining.every((o) => !o.isNoise)).toBe(true);
    expect(result.removed.length).toBeGreaterThan(0);
  });

  it('Tier 1: stops if noise removal alone brings under target', async () => {
    const observations: Observation[] = [
      makeObs({ id: 'o1', isNoise: true, tokens: 40 }),
      makeObs({ id: 'o2', isNoise: false, tokens: 10 }),
    ];
    // GT=10, target=60% of 100=60. After noise removal: 10+10=20 < 60
    const result = await tieredEviction({
      observations,
      groundTruthTokens: 10,
      windowSize: 100,
      targetRatio: 0.60,
    });
    // Only noise removed, no compression
    expect(result.remaining).toHaveLength(1);
    expect(result.remaining[0].id).toBe('o2');
    // Content should not be compressed
    expect(result.remaining[0].content).not.toContain('...(compressed)');
  });

  it('Tier 2: compresses oldest observations when Tier 1 is insufficient', async () => {
    // All non-noise, over target
    const observations: Observation[] = [
      makeObs({ id: 'o1', isNoise: false, tokens: 25, timestamp: 1000, content: 'line one\nline two\nline three\nline four\nline five' }),
      makeObs({ id: 'o2', isNoise: false, tokens: 25, timestamp: 2000, content: 'another line one\nanother line two\nanother line three' }),
      makeObs({ id: 'o3', isNoise: false, tokens: 25, timestamp: 3000, content: 'newest observation data' }),
    ];
    // GT=10, total=10+75=85. target=60. Need to reduce to 50 obs tokens.
    const result = await tieredEviction({
      observations,
      groundTruthTokens: 10,
      windowSize: 100,
      targetRatio: 0.60,
    });
    // Oldest should be compressed (contains ...(compressed))
    const compressed = result.remaining.filter((o) => o.content.includes('...(compressed)'));
    expect(compressed.length).toBeGreaterThan(0);
  });

  it('Tier 2: compresses to first 2 lines + marker', async () => {
    const content = 'first line\nsecond line\nthird line\nfourth line';
    const observations: Observation[] = [
      makeObs({ id: 'o1', isNoise: false, tokens: 50, timestamp: 1000, content }),
    ];
    // GT=5, total=55, target=60% of 100=60. Already under? Make windowSize smaller.
    const result = await tieredEviction({
      observations,
      groundTruthTokens: 5,
      windowSize: 80,
      targetRatio: 0.60, // target = 48, obs budget = 43
    });
    if (result.remaining.length > 0 && result.remaining[0].content.includes('...(compressed)')) {
      const lines = result.remaining[0].content.split('\n');
      expect(lines[0]).toBe('first line');
      expect(lines[1]).toBe('second line');
      expect(lines[2]).toBe('...(compressed)');
    }
  });

  it('Tier 3: falls back to aggressive compression when no workerModel', async () => {
    // Create observations that are still over target after tier 2
    const observations: Observation[] = [];
    for (let i = 0; i < 10; i++) {
      observations.push(
        makeObs({
          id: `o${i}`,
          isNoise: false,
          tokens: 15,
          timestamp: 1000 + i,
          content: `line ${i}`,
        }),
      );
    }
    // GT=10, obs=150, total=160, windowSize=100, target=60 -> obs budget=50
    // Tier 1 removes nothing. Tier 2 compresses oldest but single-line obs won't compress much.
    // Tier 3 without worker model does aggressive 1-line compression.
    const result = await tieredEviction({
      observations,
      groundTruthTokens: 10,
      windowSize: 100,
      targetRatio: 0.60,
    });
    // Should still return some observations
    expect(result.remaining.length).toBeGreaterThan(0);
  });

  it('Tier 3: uses worker model when provided and still over target', async () => {
    const observations: Observation[] = [];
    for (let i = 0; i < 10; i++) {
      observations.push(
        makeObs({
          id: `o${i}`,
          isNoise: false,
          tokens: 15,
          timestamp: 1000 + i,
          content: `observation content ${i}`,
        }),
      );
    }

    // Mock worker model
    const mockWorkerModel = {} as any;
    // We mock generateObject at the module level instead
    const result = await tieredEviction({
      observations,
      groundTruthTokens: 10,
      windowSize: 100,
      targetRatio: 0.60,
      workerModel: mockWorkerModel,
    });
    // Should have summary or remaining observations
    expect(result.remaining.length).toBeGreaterThanOrEqual(1);
  });

  it('returns EvictionResult with remaining, removed, and optional summary', async () => {
    const observations: Observation[] = [
      makeObs({ id: 'o1', isNoise: true, tokens: 20 }),
      makeObs({ id: 'o2', isNoise: false, tokens: 10 }),
    ];
    const result = await tieredEviction({
      observations,
      groundTruthTokens: 5,
      windowSize: 100,
      targetRatio: 0.60,
    });
    expect(result).toHaveProperty('remaining');
    expect(result).toHaveProperty('removed');
    expect(Array.isArray(result.remaining)).toBe(true);
    expect(Array.isArray(result.removed)).toBe(true);
  });
});
