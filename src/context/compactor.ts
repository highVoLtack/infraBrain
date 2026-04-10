/**
 * Tiered eviction logic for context compaction.
 * Tier 1: Remove noise observations.
 * Tier 2: Compress oldest observations to first 2 lines.
 * Tier 3: Worker model summarization (or aggressive 1-line compression).
 */

import type { LanguageModel } from 'ai';
import type { Observation, EvictionResult } from './types.js';
import { countTokens } from './token-counter.js';

export interface TieredEvictionParams {
  observations: Observation[];
  groundTruthTokens: number;
  windowSize: number;
  targetRatio: number;
  workerModel?: LanguageModel;
}

function totalObsTokens(obs: Observation[]): number {
  return obs.reduce((sum, o) => sum + o.tokens, 0);
}

function isUnderBudget(obs: Observation[], gtTokens: number, windowSize: number, targetRatio: number): boolean {
  return (totalObsTokens(obs) + gtTokens) <= windowSize * targetRatio;
}

/**
 * Compress an observation to its first N lines + a marker.
 * Returns a new observation with updated content and token count.
 */
function compressObs(obs: Observation, maxLines: number): Observation {
  const lines = obs.content.split('\n');
  if (lines.length <= maxLines) return obs;
  const compressed = [...lines.slice(0, maxLines), '...(compressed)'].join('\n');
  return {
    ...obs,
    content: compressed,
    tokens: countTokens(compressed),
  };
}

/**
 * Run tiered eviction on observations to bring total context under target.
 * Stops after the first tier that achieves the target.
 */
export async function tieredEviction(params: TieredEvictionParams): Promise<EvictionResult> {
  const { groundTruthTokens, windowSize, targetRatio, workerModel } = params;
  let remaining = [...params.observations];
  const removed: Observation[] = [];

  // -------------------------------------------------------------------------
  // Tier 1: Remove noise
  // -------------------------------------------------------------------------
  const noise = remaining.filter((o) => o.isNoise);
  const nonNoise = remaining.filter((o) => !o.isNoise);
  removed.push(...noise);
  remaining = nonNoise;

  if (isUnderBudget(remaining, groundTruthTokens, windowSize, targetRatio)) {
    return { remaining, removed };
  }

  // -------------------------------------------------------------------------
  // Tier 2: Compress oldest observations (first 2 lines + marker)
  // -------------------------------------------------------------------------
  // Sort by timestamp ascending (oldest first) for compression order
  remaining.sort((a, b) => a.timestamp - b.timestamp);

  for (let i = 0; i < remaining.length; i++) {
    remaining[i] = compressObs(remaining[i], 2);
    if (isUnderBudget(remaining, groundTruthTokens, windowSize, targetRatio)) {
      return { remaining, removed };
    }
  }

  // Still over budget after Tier 2 compression

  // -------------------------------------------------------------------------
  // Tier 3: Worker model summarization or aggressive compression
  // -------------------------------------------------------------------------
  if (workerModel) {
    try {
      const { generateObject } = await import('ai');
      const { z } = await import('zod');

      const allContent = remaining.map((o) => o.content).join('\n---\n');
      const { object } = await generateObject({
        model: workerModel,
        schema: z.object({ summary: z.string() }),
        prompt: `Summarize these infrastructure diagnostic observations into the key findings only. Remove redundancy.\n\n${allContent}`,
      });

      const summaryTokens = countTokens(object.summary);
      const summaryObs: Observation = {
        id: 'summary-' + Date.now(),
        content: object.summary,
        tokens: summaryTokens,
        timestamp: Date.now(),
        source: 'compactor-summary',
        isNoise: false,
      };

      removed.push(...remaining);
      return { remaining: [summaryObs], removed, summary: object.summary };
    } catch {
      // Worker model failed, fall through to aggressive compression
    }
  }

  // Aggressive Tier 3 fallback: compress each to 1 line
  for (let i = 0; i < remaining.length; i++) {
    remaining[i] = compressObs(remaining[i], 1);
  }

  // If still over budget, drop oldest observations until under target
  remaining.sort((a, b) => a.timestamp - b.timestamp);
  while (!isUnderBudget(remaining, groundTruthTokens, windowSize, targetRatio) && remaining.length > 1) {
    removed.push(remaining.shift()!);
  }

  return { remaining, removed };
}
