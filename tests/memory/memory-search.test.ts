import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IncidentStore } from '../../src/memory/incident-store.js';

// Mock memory-scoring to control computed scores
vi.mock('../../src/memory/memory-scoring.js', () => ({
  computeMemoryScore: vi.fn(),
}));

import { searchWithDecay, formatIncidentEmbeddingInput } from '../../src/memory/memory-search.js';
import { computeMemoryScore } from '../../src/memory/memory-scoring.js';

describe('memory-search', () => {
  let mockStore: Pick<IncidentStore, 'search'>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockStore = {
      search: vi.fn(),
    };
  });

  describe('searchWithDecay', () => {
    it('returns incidents sorted by weighted score (similarity * w_sim + recency * w_rec)', async () => {
      const embedding = new Array(1024).fill(0);

      vi.mocked(mockStore.search).mockResolvedValue([
        { id: 'inc-1', root_cause: 'OOM', skill_name: 'postgres', created_at: '2026-04-10T10:00:00Z', _distance: 0.3 },
        { id: 'inc-2', root_cause: 'Port conflict', skill_name: 'nginx', created_at: '2026-04-12T10:00:00Z', _distance: 0.1 },
        { id: 'inc-3', root_cause: 'DNS fail', skill_name: 'redis', created_at: '2026-04-11T10:00:00Z', _distance: 0.5 },
      ]);

      // inc-1: similarity=0.7, score=0.50
      vi.mocked(computeMemoryScore)
        .mockReturnValueOnce({ score: 0.50, recencyScore: 0.8 })
        // inc-2: similarity=0.9, score=0.80
        .mockReturnValueOnce({ score: 0.80, recencyScore: 0.95 })
        // inc-3: similarity=0.5, score=0.35
        .mockReturnValueOnce({ score: 0.35, recencyScore: 0.6 });

      const results = await searchWithDecay(
        mockStore as unknown as IncidentStore,
        embedding,
        3,
        { decayLambda: 0.02 },
      );

      // Should be sorted by score descending: inc-2 (0.80), inc-1 (0.50), inc-3 (0.35)
      expect(results).toHaveLength(3);
      expect(results[0].score).toBe(0.80);
      expect(results[1].score).toBe(0.50);
      expect(results[2].score).toBe(0.35);
    });

    it('applies temporal decay with decayLambda from config', async () => {
      const embedding = new Array(1024).fill(0);
      vi.mocked(mockStore.search).mockResolvedValue([
        { id: 'inc-1', root_cause: 'err', skill_name: 'test', created_at: '2026-04-10T10:00:00Z', _distance: 0.2 },
      ]);
      vi.mocked(computeMemoryScore).mockReturnValue({ score: 0.6, recencyScore: 0.9 });

      await searchWithDecay(
        mockStore as unknown as IncidentStore,
        embedding,
        5,
        { decayLambda: 0.05, w_sim: 0.7, w_rec: 0.3 },
      );

      // Verify computeMemoryScore was called with similarity derived from distance and our config
      expect(computeMemoryScore).toHaveBeenCalledWith(
        0.8, // 1 - 0.2 (cosine distance to similarity)
        '2026-04-10T10:00:00Z',
        { decayLambda: 0.05, w_sim: 0.7, w_rec: 0.3 },
      );
    });

    it('filters by wing when specified', async () => {
      const embedding = new Array(1024).fill(0);
      vi.mocked(mockStore.search).mockResolvedValue([]);

      await searchWithDecay(
        mockStore as unknown as IncidentStore,
        embedding,
        3,
        { decayLambda: 0.02 },
        'wing_incidents',
      );

      expect(mockStore.search).toHaveBeenCalledWith(embedding, 6, 'wing_incidents');
    });

    it('over-fetches from store (limit * 2) for reranking', async () => {
      const embedding = new Array(1024).fill(0);
      vi.mocked(mockStore.search).mockResolvedValue([
        { id: 'inc-1', root_cause: 'a', skill_name: 's', created_at: '2026-04-10T10:00:00Z', _distance: 0.1 },
        { id: 'inc-2', root_cause: 'b', skill_name: 's', created_at: '2026-04-09T10:00:00Z', _distance: 0.2 },
        { id: 'inc-3', root_cause: 'c', skill_name: 's', created_at: '2026-04-08T10:00:00Z', _distance: 0.3 },
        { id: 'inc-4', root_cause: 'd', skill_name: 's', created_at: '2026-04-07T10:00:00Z', _distance: 0.4 },
      ]);

      vi.mocked(computeMemoryScore)
        .mockReturnValueOnce({ score: 0.9, recencyScore: 1.0 })
        .mockReturnValueOnce({ score: 0.7, recencyScore: 0.8 })
        .mockReturnValueOnce({ score: 0.5, recencyScore: 0.6 })
        .mockReturnValueOnce({ score: 0.3, recencyScore: 0.4 });

      const results = await searchWithDecay(
        mockStore as unknown as IncidentStore,
        embedding,
        2, // only want 2 results
        { decayLambda: 0.02 },
      );

      // Over-fetch: 2 * 2 = 4
      expect(mockStore.search).toHaveBeenCalledWith(embedding, 4, undefined);
      // But only top 2 returned
      expect(results).toHaveLength(2);
      expect(results[0].score).toBe(0.9);
      expect(results[1].score).toBe(0.7);
    });

    it('returns empty array when store returns empty', async () => {
      const embedding = new Array(1024).fill(0);
      vi.mocked(mockStore.search).mockResolvedValue([]);

      const results = await searchWithDecay(
        mockStore as unknown as IncidentStore,
        embedding,
        3,
        { decayLambda: 0.02 },
      );

      expect(results).toEqual([]);
    });
  });

  describe('formatIncidentEmbeddingInput', () => {
    it('formats root cause, services, and diagnosis into embedding input', () => {
      const result = formatIncidentEmbeddingInput(
        'OOM kill on postgres container',
        'postgres, redis',
        'Memory limit exceeded due to connection leak',
      );

      expect(result).toBe(
        'INCIDENT: OOM kill on postgres container\n\nSERVICES: postgres, redis\n\nDIAGNOSIS: Memory limit exceeded due to connection leak',
      );
    });
  });
});
