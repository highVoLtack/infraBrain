/**
 * Cross-session semantic search with temporal decay scoring.
 * Wraps IncidentStore.search() with recency-weighted reranking.
 * All types imported from src/memory/types.ts (single source of truth).
 */

import type { IncidentStore } from './incident-store.js';
import type { MemorySearchResult, IncidentRecord, Wing } from './types.js';
import { computeMemoryScore } from './memory-scoring.js';

/**
 * Search incidents with temporal decay reranking.
 * Over-fetches from the store (limit * 2) because decay reranking changes result order,
 * then returns the top `limit` results sorted by combined score.
 *
 * Similarity from LanceDB: `1 - _distance` (cosine distance to similarity).
 *
 * @param store - IncidentStore instance
 * @param embedding - Query embedding vector
 * @param limit - Number of results to return
 * @param config - Scoring config with decayLambda and optional weights
 * @param wing - Optional wing filter
 * @returns Sorted MemorySearchResult array
 */
export async function searchWithDecay(
  store: IncidentStore,
  embedding: number[],
  limit: number,
  config: { decayLambda: number; w_sim?: number; w_rec?: number },
  wing?: Wing,
): Promise<MemorySearchResult[]> {
  // Over-fetch for reranking (decay changes order)
  const overFetchLimit = limit * 2;
  const rawResults = await store.search(embedding, overFetchLimit, wing);

  if (rawResults.length === 0) return [];

  const scored: MemorySearchResult[] = rawResults.map((row) => {
    const distance = (row['_distance'] as number) ?? 0;
    const similarity = 1 - distance;
    const createdAt = row['created_at'] as string;

    const { score, recencyScore } = computeMemoryScore(similarity, createdAt, config);

    // Reconstruct IncidentRecord from raw row
    const incident: IncidentRecord = {
      id: row['id'] as string,
      session_id: row['session_id'] as string,
      wing: (row['wing'] as Wing) ?? 'wing_incidents',
      prompt: row['prompt'] as string,
      diagnosis: row['diagnosis'] as string,
      root_cause: row['root_cause'] as string,
      fix_summary: row['fix_summary'] as string,
      outcome: row['outcome'] as IncidentRecord['outcome'],
      skill_name: row['skill_name'] as string,
      created_at: createdAt,
      containers: row['containers'] as string,
      services: row['services'] as string,
      error_codes: row['error_codes'] as string,
      expert_domain: row['expert_domain'] as string,
    };

    return { incident, similarity, recencyScore, score };
  });

  // Sort by score descending, return top limit
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

/**
 * Format incident data into a string suitable for embedding generation.
 * Uses a different format from cache embedding (RESEARCH.md pitfall 2):
 * incidents focus on root cause + services + diagnosis, not raw error context.
 */
export function formatIncidentEmbeddingInput(
  rootCause: string,
  services: string,
  diagnosis: string,
): string {
  return `INCIDENT: ${rootCause}\n\nSERVICES: ${services}\n\nDIAGNOSIS: ${diagnosis}`;
}
