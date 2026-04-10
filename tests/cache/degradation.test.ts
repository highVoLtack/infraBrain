import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies
vi.mock('../../src/cache/embedder.js', () => ({
  formatEmbeddingInput: vi.fn().mockReturnValue('formatted'),
  generateEmbedding: vi.fn(),
}));
vi.mock('../../src/cache/confidence.js', () => ({
  computeConfidence: vi.fn().mockReturnValue(0.88),
}));

import { checkCache, storeFixInCache, recordFixOutcome } from '../../src/cache/cache-lookup.js';
import { runStartupInvalidation } from '../../src/cache/invalidation.js';
import { generateEmbedding } from '../../src/cache/embedder.js';
import type { CacheConfig, ConfidenceConfig } from '../../src/cache/types.js';

const defaultCacheConfig: CacheConfig = {
  enabled: true,
  similarity_threshold: 0.85,
  soft_zone_floor: 0.75,
  data_dir: '.infrabrain/cache',
};

const defaultConfidenceConfig: ConfidenceConfig = {
  w_sim: 0.5,
  w_rec: 0.3,
  w_suc: 0.2,
  decayLambda: 0.1,
};

describe('graceful degradation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('checkCache with null store returns miss', async () => {
    const result = await checkCache({
      prompt: 'nginx is down',
      filteredDiscovery: {},
      store: null,
      baseURL: 'http://localhost:11434/v1',
      modelId: 'bge-m3',
      cacheConfig: defaultCacheConfig,
      confidenceConfig: defaultConfidenceConfig,
    });

    expect(result.type).toBe('miss');
  });

  it('checkCache with disabled cache returns miss', async () => {
    const result = await checkCache({
      prompt: 'nginx is down',
      filteredDiscovery: {},
      store: {} as any,
      baseURL: 'http://localhost:11434/v1',
      modelId: 'bge-m3',
      cacheConfig: { ...defaultCacheConfig, enabled: false },
      confidenceConfig: defaultConfidenceConfig,
    });

    expect(result.type).toBe('miss');
  });

  it('checkCache with embedding failure returns miss', async () => {
    vi.mocked(generateEmbedding).mockResolvedValue(null);

    const store = {
      search: vi.fn(),
      updateStats: vi.fn(),
    };

    const result = await checkCache({
      prompt: 'nginx is down',
      filteredDiscovery: {},
      store: store as any,
      baseURL: 'http://localhost:11434/v1',
      modelId: 'bge-m3',
      cacheConfig: defaultCacheConfig,
      confidenceConfig: defaultConfidenceConfig,
    });

    expect(result.type).toBe('miss');
    expect(store.search).not.toHaveBeenCalled();
  });

  it('storeFixInCache with null store does not throw', async () => {
    await expect(storeFixInCache({
      prompt: 'test',
      filteredDiscovery: {},
      diagnosis: 'test',
      fixPlan: { summary: 'Test', steps: [], complexity: 'simple' as const },
      skillName: 'test',
      sessionId: 'sess-001',
      store: null,
      baseURL: 'http://localhost:11434/v1',
      modelId: 'bge-m3',
    })).resolves.not.toThrow();
  });

  it('runStartupInvalidation with null store does not throw', async () => {
    await expect(runStartupInvalidation(null, '/nonexistent', '/nonexistent/hashes.json'))
      .resolves.not.toThrow();
  });

  it('recordFixOutcome with null store does not throw', async () => {
    await expect(recordFixOutcome(null, 'entry-1', true)).resolves.not.toThrow();
  });

  it('checkCache handles store.search throwing', async () => {
    vi.mocked(generateEmbedding).mockResolvedValue(new Array(1024).fill(0.1));

    const store = {
      search: vi.fn().mockRejectedValue(new Error('search failed')),
      updateStats: vi.fn(),
    };

    const result = await checkCache({
      prompt: 'nginx is down',
      filteredDiscovery: {},
      store: store as any,
      baseURL: 'http://localhost:11434/v1',
      modelId: 'bge-m3',
      cacheConfig: defaultCacheConfig,
      confidenceConfig: defaultConfidenceConfig,
    });

    expect(result.type).toBe('miss');
  });
});
