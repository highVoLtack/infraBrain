/**
 * session-usage - Per-session token/cost aggregator
 *
 * Accumulates token counts and dollar cost per sessionId so the SSE route can
 * emit a final `dpev:session_summary` payload at session end. The module-scoped
 * Map mirrors the approval-map pattern in src/api/routes/stream-debug.ts.
 *
 * Phase 19.3 D-12: session-end summary footer.
 * Phase 19.3 D-11: computeCost returns null for unpriced models -- we treat
 * that as a $0 contribution so token totals stay accurate while cost only
 * reflects models we actually have rates for.
 */

import { computeCost, type PricingTable } from '../config/pricing.js';

export interface UsageTotals {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalCostUsd: number;
}

/** Module-scoped per-session totals. Cleared via clearSessionUsage / _resetAll. */
const _usage = new Map<string, UsageTotals>();

/**
 * Record one LLM call's usage against a session and return the new totals.
 * Unknown models contribute tokens but no cost (computeCost -> null -> 0).
 */
export function recordUsage(
  sessionId: string,
  modelId: string,
  inputTokens: number,
  outputTokens: number,
  pricing?: PricingTable,
): UsageTotals {
  const current = _usage.get(sessionId) ?? {
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalTokens: 0,
    totalCostUsd: 0,
  };
  const cost = computeCost(modelId, inputTokens, outputTokens, pricing) ?? 0;
  const next: UsageTotals = {
    totalInputTokens: current.totalInputTokens + inputTokens,
    totalOutputTokens: current.totalOutputTokens + outputTokens,
    totalTokens: current.totalTokens + inputTokens + outputTokens,
    totalCostUsd: current.totalCostUsd + cost,
  };
  _usage.set(sessionId, next);
  return next;
}

/** Read the accumulated totals for a session, or undefined if none recorded. */
export function getSessionSummary(sessionId: string): UsageTotals | undefined {
  return _usage.get(sessionId);
}

/** Drop a session's entry (called on session end and on client disconnect). */
export function clearSessionUsage(sessionId: string): void {
  _usage.delete(sessionId);
}

/** Clear every session entry. Test-only escape hatch (cf. clearStoreCache). */
export function _resetAll(): void {
  _usage.clear();
}
