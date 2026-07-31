/**
 * pricing - LLM pricing table + USD cost computation.
 *
 * Phase 19.3 D-10: abstracted pricing so render code never hardcodes rates.
 * v2.0 will extend DEFAULT_PRICING with savedViaMemory / savedViaCompression
 * entries and the same computeCost helper will surface them.
 *
 * Graceful degradation (D-11): computeCost returns null for unknown modelId
 * so callers render the `$-` placeholder instead of $0 (which would lie).
 */

import { z } from 'zod';

export const PricingEntrySchema = z.object({
  inputPer1k: z.number().default(0),
  outputPer1k: z.number().default(0),
});
export type PricingEntry = z.infer<typeof PricingEntrySchema>;

export const PricingTableSchema = z.record(z.string(), PricingEntrySchema);
export type PricingTable = z.infer<typeof PricingTableSchema>;

export const DEFAULT_PRICING: PricingTable = {
  'gemini-2.5-pro': { inputPer1k: 0.00125, outputPer1k: 0.005 },
  'gemini-2.5-flash': { inputPer1k: 0.000075, outputPer1k: 0.0003 },
  'qwen3-32b': { inputPer1k: 0, outputPer1k: 0 }, // local -> $0
  'infrabrain': { inputPer1k: 0, outputPer1k: 0 }, // local -> $0
};

/**
 * Pure function: compute USD cost from token counts and model id.
 * Returns null when model is not in the pricing table (graceful degradation).
 * D-11: callers render `$-` for null.
 */
export function computeCost(
  modelId: string,
  inputTokens: number,
  outputTokens: number,
  table: PricingTable = DEFAULT_PRICING,
): number | null {
  const rates = table[modelId];
  if (!rates) return null;
  return (inputTokens / 1000) * rates.inputPer1k + (outputTokens / 1000) * rates.outputPer1k;
}
