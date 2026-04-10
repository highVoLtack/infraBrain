/**
 * Confidence scoring for cache hits.
 * Formula: confidence = w_sim * similarity + w_rec * recencyScore + w_suc * successRate
 * - recencyScore uses exponential decay: exp(-lambda * ageDays)
 * - successRate defaults to 0.5 (neutral) when no usage data exists
 */

import { DEFAULT_CONFIDENCE_CONFIG, type ConfidenceConfig } from './types.js';

const MS_PER_DAY = 86_400_000;

/**
 * Compute confidence score for a cache hit.
 *
 * @param similarity - Vector similarity score (0-1, higher = more similar)
 * @param lastUsed - ISO timestamp of last use (or creation if never used)
 * @param successCount - Number of times this cached fix succeeded
 * @param totalUses - Total number of times this cached fix was applied
 * @param config - Confidence weight configuration
 * @returns Confidence score between 0 and 1
 */
export function computeConfidence(
  similarity: number,
  lastUsed: string | Date,
  successCount: number,
  totalUses: number,
  config: ConfidenceConfig = DEFAULT_CONFIDENCE_CONFIG,
): number {
  const lastUsedDate = lastUsed instanceof Date ? lastUsed : new Date(lastUsed);
  const ageDays = Math.max(0, (Date.now() - lastUsedDate.getTime()) / MS_PER_DAY);

  const recencyScore = Math.exp(-config.decayLambda * ageDays);
  const successRate = totalUses > 0 ? successCount / totalUses : 0.5;

  return config.w_sim * similarity + config.w_rec * recencyScore + config.w_suc * successRate;
}
