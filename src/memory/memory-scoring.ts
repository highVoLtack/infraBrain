/**
 * Temporal decay scoring for MemPalace memory retrieval.
 * Combines vector similarity with time-based recency using exponential decay.
 * Uses a separate lambda from cache confidence (memory decays slower).
 *
 * Formula: score = w_sim * similarity + w_rec * recencyScore
 * where recencyScore = exp(-lambda * ageDays)
 *
 * Default: w_sim=0.6, w_rec=0.4, decayLambda=0.02 per CONTEXT.md.
 */

const MS_PER_DAY = 86_400_000;

/**
 * Compute a combined memory score from similarity and temporal recency.
 *
 * @param similarity - Vector similarity score (0-1, higher = more similar)
 * @param createdAt - ISO 8601 timestamp of incident creation
 * @param config - Scoring configuration with decay lambda and optional weights
 * @returns Object with combined score and raw recencyScore
 */
export function computeMemoryScore(
  similarity: number,
  createdAt: string,
  config: { w_sim?: number; w_rec?: number; decayLambda: number },
): { score: number; recencyScore: number } {
  const w_sim = config.w_sim ?? 0.6;
  const w_rec = config.w_rec ?? 0.4;
  const ageDays = Math.max(0, (Date.now() - new Date(createdAt).getTime()) / MS_PER_DAY);
  const recencyScore = Math.exp(-config.decayLambda * ageDays);
  return {
    score: w_sim * similarity + w_rec * recencyScore,
    recencyScore,
  };
}
