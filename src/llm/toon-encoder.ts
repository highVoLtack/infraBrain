import { encode } from '@toon-format/toon';
import { estimateTokens } from './token-budget.js';

/**
 * Encode data as TOON (Token-Oriented Object Notation) for LLM context.
 * Falls back to compact JSON if the TOON encoder throws.
 *
 * Primitives are returned as their string representation.
 */
export function encodeToon(data: unknown): string {
  // Handle primitives directly
  if (data === null) return 'null';
  if (data === undefined) return 'undefined';
  if (typeof data === 'string') return data;
  if (typeof data === 'number' || typeof data === 'boolean') return String(data);

  try {
    return encode(data as Record<string, unknown> | unknown[]);
  } catch {
    return JSON.stringify(data, null, 0);
  }
}

/**
 * Encode data as TOON and optionally prepend a label.
 * Format: `{label}:\n{toonString}` or just `{toonString}` if no label.
 */
export function encodeForLLM(data: unknown, label?: string): string {
  const toon = encodeToon(data);
  if (label) {
    return `${label}:\n${toon}`;
  }
  return toon;
}

/**
 * Measure token savings between JSON.stringify and TOON encoding.
 * Useful for testing and debugging.
 */
export function measureSavings(data: unknown): {
  jsonTokens: number;
  toonTokens: number;
  savingsPercent: number;
} {
  const jsonStr = JSON.stringify(data);
  const toonStr = encodeToon(data);

  const jsonTokens = estimateTokens(jsonStr);
  const toonTokens = estimateTokens(toonStr);

  const savingsPercent =
    jsonTokens > 0 ? ((jsonTokens - toonTokens) / jsonTokens) * 100 : 0;

  return { jsonTokens, toonTokens, savingsPercent };
}
