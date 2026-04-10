import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies before importing the module under test
vi.mock('../../src/cache/embedder.js', () => ({
  formatEmbeddingInput: vi.fn(),
  generateEmbedding: vi.fn(),
}));
vi.mock('../../src/cache/confidence.js', () => ({
  computeConfidence: vi.fn(),
}));

import { checkCache, storeFixInCache, recordFixOutcome } from '../../src/cache/cache-lookup.js';
import { formatEmbeddingInput, generateEmbedding } from '../../src/cache/embedder.js';
import { computeConfidence } from '../../src/cache/confidence.js';
import type { CacheConfig, ConfidenceConfig } from '../../src/cache/types.js';

function makeMockStore(
  searchResults: Array<Record<string, unknown>> = [],
  getByIdResult: Record<string, unknown> | null = { success_count: 0, fail_count: 0, hit_count: 0 },
) {
  return {
    init: vi.fn(),
    search: vi.fn().mockResolvedValue(searchResults),
    add: vi.fn().mockResolvedValue('entry-123'),
    deleteBySkill: vi.fn().mockResolvedValue(true),
    deleteAll: vi.fn().mockResolvedValue(true),
    listAll: vi.fn().mockResolvedValue([]),
    updateStats: vi.fn().mockResolvedValue(true),
    getById: vi.fn().mockResolvedValue(getByIdResult),
  };
}

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

describe('checkCache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(formatEmbeddingInput).mockReturnValue('formatted input');
    vi.mocked(generateEmbedding).mockResolvedValue(new Array(1024).fill(0.1));
    vi.mocked(computeConfidence).mockReturnValue(0.88);
  });

  it('returns fast-path for similarity >= 0.85', async () => {
    const store = makeMockStore([{
      id: 'entry-1',
      error_signature: 'nginx 502',
      skill_name: 'nginx',
      fix_plan: '{"steps":[]}',
      diagnosis: 'upstream down',
      session_id: 'sess-1',
      created_at: '2026-01-01T00:00:00Z',
      last_used: '2026-01-01T00:00:00Z',
      hit_count: 2,
      success_count: 1,
      fail_count: 0,
      vector: new Array(1024).fill(0.1),
      _distance: 0.10, // similarity = 1 - 0.10 = 0.90
    }]);

    const result = await checkCache({
      prompt: 'nginx is down',
      filteredDiscovery: { containers: 'nginx-demo' },
      store: store as any,
      baseURL: 'http://localhost:11434/v1',
      modelId: 'bge-m3',
      cacheConfig: defaultCacheConfig,
      confidenceConfig: defaultConfidenceConfig,
    });

    expect(result.type).toBe('fast-path');
    if (result.type === 'fast-path') {
      expect(result.hit.similarity).toBeCloseTo(0.90);
      expect(result.hit.confidence).toBe(0.88);
      expect(result.hit.entry.id).toBe('entry-1');
    }
    expect(store.updateStats).toHaveBeenCalled();
  });

  it('returns speculative for similarity 0.75-0.85', async () => {
    const store = makeMockStore([{
      id: 'entry-2',
      error_signature: 'nginx 502',
      skill_name: 'nginx',
      fix_plan: '{"steps":[]}',
      diagnosis: 'upstream down',
      session_id: 'sess-1',
      created_at: '2026-01-01T00:00:00Z',
      last_used: '2026-01-01T00:00:00Z',
      hit_count: 1,
      success_count: 0,
      fail_count: 0,
      vector: new Array(1024).fill(0.1),
      _distance: 0.20, // similarity = 1 - 0.20 = 0.80
    }]);

    const result = await checkCache({
      prompt: 'nginx is slow',
      filteredDiscovery: {},
      store: store as any,
      baseURL: 'http://localhost:11434/v1',
      modelId: 'bge-m3',
      cacheConfig: defaultCacheConfig,
      confidenceConfig: defaultConfidenceConfig,
    });

    expect(result.type).toBe('speculative');
    if (result.type === 'speculative') {
      expect(result.hit.similarity).toBeCloseTo(0.80);
    }
    expect(store.updateStats).toHaveBeenCalled();
  });

  it('returns miss for similarity < 0.75', async () => {
    const store = makeMockStore([{
      id: 'entry-3',
      error_signature: 'unrelated error',
      skill_name: 'postgres',
      fix_plan: '{"steps":[]}',
      diagnosis: 'something else',
      session_id: 'sess-1',
      created_at: '2026-01-01T00:00:00Z',
      last_used: '2026-01-01T00:00:00Z',
      hit_count: 0,
      success_count: 0,
      fail_count: 0,
      vector: new Array(1024).fill(0.1),
      _distance: 0.40, // similarity = 1 - 0.40 = 0.60
    }]);

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
    expect(store.updateStats).not.toHaveBeenCalled();
  });

  it('returns miss when store returns empty results', async () => {
    const store = makeMockStore([]);

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

describe('storeFixInCache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(formatEmbeddingInput).mockReturnValue('formatted input');
    vi.mocked(generateEmbedding).mockResolvedValue(new Array(1024).fill(0.1));
  });

  it('writes entry to store', async () => {
    const store = makeMockStore();

    await storeFixInCache({
      prompt: 'nginx 502',
      filteredDiscovery: { containers: 'nginx-demo' },
      diagnosis: 'upstream server down',
      fixPlan: { summary: 'Restart', steps: [], complexity: 'simple' as const },
      skillName: 'nginx',
      sessionId: 'sess-001',
      store: store as any,
      baseURL: 'http://localhost:11434/v1',
      modelId: 'bge-m3',
    });

    expect(store.add).toHaveBeenCalledOnce();
    const [entry, vector] = store.add.mock.calls[0];
    expect(entry.skill_name).toBe('nginx');
    expect(entry.diagnosis).toBe('upstream server down');
    expect(vector).toHaveLength(1024);
  });

  it('does not throw when store is null', async () => {
    await expect(storeFixInCache({
      prompt: 'nginx 502',
      filteredDiscovery: {},
      diagnosis: 'test',
      fixPlan: { summary: 'Test', steps: [], complexity: 'simple' as const },
      skillName: 'nginx',
      sessionId: 'sess-001',
      store: null,
      baseURL: 'http://localhost:11434/v1',
      modelId: 'bge-m3',
    })).resolves.not.toThrow();
  });
});

describe('recordFixOutcome', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('increments success_count from 0 to 1 on first success', async () => {
    const store = makeMockStore([], { success_count: 0, fail_count: 0 });
    await recordFixOutcome(store as any, 'entry-1', true);

    expect(store.getById).toHaveBeenCalledWith('entry-1');
    expect(store.updateStats).toHaveBeenCalledWith('entry-1', expect.objectContaining({
      success_count: 1,
    }));
  });

  it('increments success_count across two calls', async () => {
    const store = makeMockStore([], { success_count: 0, fail_count: 0 });
    // First call: getById returns success_count: 0
    await recordFixOutcome(store as any, 'entry-1', true);

    expect(store.updateStats).toHaveBeenCalledWith('entry-1', expect.objectContaining({
      success_count: 1,
    }));

    // Second call: getById returns success_count: 1 (reflecting the first increment)
    store.getById.mockResolvedValue({ success_count: 1, fail_count: 0 });
    await recordFixOutcome(store as any, 'entry-1', true);

    expect(store.updateStats).toHaveBeenLastCalledWith('entry-1', expect.objectContaining({
      success_count: 2,
    }));
  });

  it('increments fail_count from 0 to 1 on first failure', async () => {
    const store = makeMockStore([], { success_count: 0, fail_count: 0 });
    await recordFixOutcome(store as any, 'entry-1', false);

    expect(store.getById).toHaveBeenCalledWith('entry-1');
    expect(store.updateStats).toHaveBeenCalledWith('entry-1', expect.objectContaining({
      fail_count: 1,
    }));
  });

  it('increments fail_count across two calls', async () => {
    const store = makeMockStore([], { success_count: 0, fail_count: 0 });
    // First call: getById returns fail_count: 0
    await recordFixOutcome(store as any, 'entry-1', false);

    expect(store.updateStats).toHaveBeenCalledWith('entry-1', expect.objectContaining({
      fail_count: 1,
    }));

    // Second call: getById returns fail_count: 1 (reflecting the first increment)
    store.getById.mockResolvedValue({ success_count: 0, fail_count: 1 });
    await recordFixOutcome(store as any, 'entry-1', false);

    expect(store.updateStats).toHaveBeenLastCalledWith('entry-1', expect.objectContaining({
      fail_count: 2,
    }));
  });

  it('handles missing entry gracefully (getById returns null)', async () => {
    const store = makeMockStore([], null);
    await expect(recordFixOutcome(store as any, 'entry-1', true)).resolves.not.toThrow();

    expect(store.getById).toHaveBeenCalledWith('entry-1');
    expect(store.updateStats).not.toHaveBeenCalled();
  });

  it('does not throw when store is null', async () => {
    await expect(recordFixOutcome(null, 'entry-1', true)).resolves.not.toThrow();
  });
});
