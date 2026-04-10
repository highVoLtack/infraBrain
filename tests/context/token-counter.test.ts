import { describe, it, expect } from 'vitest';
import { countTokens, getTokenizer } from '../../src/context/token-counter.js';
import { estimateTokens } from '../../src/llm/token-budget.js';

describe('countTokens', () => {
  it('returns an integer > 0 for "hello world"', () => {
    const result = countTokens('hello world');
    expect(result).toBeGreaterThan(0);
    expect(Number.isInteger(result)).toBe(true);
  });

  it('returns 0 for empty string', () => {
    expect(countTokens('')).toBe(0);
  });

  it('produces different result than estimateTokens heuristic for mixed ASCII/non-ASCII content', () => {
    const mixed = 'Hello 世界! こんにちは Docker container_name_123 🚀';
    const accurate = countTokens(mixed);
    const heuristic = estimateTokens(mixed);
    expect(accurate).not.toBe(heuristic);
  });
});

describe('getTokenizer', () => {
  it('returns same instance on repeated calls (singleton)', () => {
    const first = getTokenizer();
    const second = getTokenizer();
    expect(first).toBe(second);
  });
});

describe('Context types', () => {
  it('Observation type has required fields', async () => {
    const { type: _check } = await import('../../src/context/types.js');
    // Import check - if types are wrong, TypeScript compilation fails
    const obs: import('../../src/context/types.js').Observation = {
      id: 'test-1',
      content: 'test content',
      tokens: 10,
      timestamp: Date.now(),
      source: 'test',
      isNoise: false,
    };
    expect(obs.id).toBe('test-1');
    expect(obs.content).toBe('test content');
    expect(obs.tokens).toBe(10);
    expect(typeof obs.timestamp).toBe('number');
    expect(obs.source).toBe('test');
    expect(obs.isNoise).toBe(false);
  });

  it('PinnedFact type has required fields', async () => {
    const fact: import('../../src/context/types.js').PinnedFact = {
      id: 'pin-1',
      type: 'container',
      value: 'nginx-proxy',
      tokens: 5,
      pinnedAt: Date.now(),
    };
    expect(fact.id).toBe('pin-1');
    expect(['container', 'port', 'ip', 'error_code', 'custom']).toContain(fact.type);
    expect(fact.value).toBe('nginx-proxy');
    expect(fact.tokens).toBe(5);
    expect(typeof fact.pinnedAt).toBe('number');
  });

  it('ContextManagerConfig has required fields with defaults', async () => {
    const config: import('../../src/context/types.js').ContextManagerConfig = {
      windowSize: 32768,
      threshold: 0.83,
      target: 0.60,
      groundTruthCap: 0.20,
    };
    expect(config.windowSize).toBe(32768);
    expect(config.threshold).toBe(0.83);
    expect(config.target).toBe(0.60);
    expect(config.groundTruthCap).toBe(0.20);
  });
});
