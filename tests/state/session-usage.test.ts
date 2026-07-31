import { describe, it, expect, beforeEach } from 'vitest';
import {
  recordUsage,
  getSessionSummary,
  clearSessionUsage,
  _resetAll,
  type UsageTotals,
} from '../../src/state/session-usage.js';
import { SSE_EVENT_NAMES, type SSEEventMap } from '../../src/ui/types.js';

describe('session-usage', () => {
  beforeEach(() => {
    _resetAll();
  });

  describe('recordUsage', () => {
    it('returns exact totals for a single priced call', () => {
      const totals = recordUsage('s1', 'gemini-2.5-pro', 1000, 500);

      expect(totals.totalInputTokens).toBe(1000);
      expect(totals.totalOutputTokens).toBe(500);
      expect(totals.totalTokens).toBe(1500);
      // 1 * 0.00125 + 0.5 * 0.005 = 0.00375
      expect(totals.totalCostUsd).toBeCloseTo(0.00375, 10);
    });

    it('accumulates tokens and cost across successive calls in the same session', () => {
      recordUsage('s1', 'gemini-2.5-pro', 1000, 500);
      const totals = recordUsage('s1', 'gemini-2.5-pro', 2000, 1000);

      expect(totals.totalInputTokens).toBe(3000);
      expect(totals.totalOutputTokens).toBe(1500);
      expect(totals.totalTokens).toBe(4500);
      // 0.00375 + (2 * 0.00125 + 1 * 0.005) = 0.00375 + 0.0075 = 0.01125
      expect(totals.totalCostUsd).toBeCloseTo(0.01125, 10);
    });

    it('leaves totalCostUsd unchanged for an unknown model (computeCost returns null)', () => {
      const first = recordUsage('s1', 'gemini-2.5-pro', 1000, 500);
      const after = recordUsage('s1', 'unknown-model', 1000, 500);

      expect(after.totalInputTokens).toBe(2000);
      expect(after.totalOutputTokens).toBe(1000);
      expect(after.totalTokens).toBe(3000);
      expect(after.totalCostUsd).toBeCloseTo(first.totalCostUsd, 10);
    });

    it('leaves totalCostUsd unchanged for a local ($0) model', () => {
      const totals = recordUsage('s1', 'qwen3-32b', 1000, 500);

      expect(totals.totalTokens).toBe(1500);
      expect(totals.totalCostUsd).toBe(0);
    });

    it('honours an injected pricing table override', () => {
      const totals = recordUsage('s1', 'custom-model', 1000, 1000, {
        'custom-model': { inputPer1k: 1, outputPer1k: 2 },
      });

      expect(totals.totalCostUsd).toBeCloseTo(3, 10);
    });

    it('accumulates two sessions independently', () => {
      recordUsage('s1', 'gemini-2.5-pro', 1000, 500);
      recordUsage('s2', 'gemini-2.5-pro', 4000, 2000);
      const s1 = recordUsage('s1', 'gemini-2.5-pro', 1000, 500);

      expect(s1.totalTokens).toBe(3000);
      expect(getSessionSummary('s2')!.totalTokens).toBe(6000);
      expect(getSessionSummary('s2')!.totalInputTokens).toBe(4000);
    });
  });

  describe('getSessionSummary', () => {
    it('returns the last-recorded totals for a known session', () => {
      const recorded = recordUsage('s1', 'gemini-2.5-pro', 1000, 500);
      const summary = getSessionSummary('s1');

      expect(summary).toEqual(recorded);
    });

    it('returns undefined for an unknown session', () => {
      expect(getSessionSummary('nonexistent')).toBeUndefined();
    });
  });

  describe('clearSessionUsage', () => {
    it('removes the entry so getSessionSummary returns undefined', () => {
      recordUsage('s1', 'gemini-2.5-pro', 1000, 500);
      clearSessionUsage('s1');

      expect(getSessionSummary('s1')).toBeUndefined();
    });

    it('does not affect other sessions', () => {
      recordUsage('s1', 'gemini-2.5-pro', 1000, 500);
      recordUsage('s2', 'gemini-2.5-pro', 1000, 500);
      clearSessionUsage('s1');

      expect(getSessionSummary('s1')).toBeUndefined();
      expect(getSessionSummary('s2')).toBeDefined();
    });

    it('is a no-op for an unknown session', () => {
      expect(() => clearSessionUsage('nope')).not.toThrow();
    });
  });

  describe('_resetAll', () => {
    it('clears every session entry', () => {
      recordUsage('s1', 'gemini-2.5-pro', 1000, 500);
      recordUsage('s2', 'gemini-2.5-pro', 1000, 500);
      _resetAll();

      expect(getSessionSummary('s1')).toBeUndefined();
      expect(getSessionSummary('s2')).toBeUndefined();
    });
  });

  describe('UsageTotals shape', () => {
    it('exposes the four aggregate fields', () => {
      const totals: UsageTotals = recordUsage('s1', 'gemini-2.5-pro', 10, 10);

      expect(Object.keys(totals).sort()).toEqual([
        'totalCostUsd',
        'totalInputTokens',
        'totalOutputTokens',
        'totalTokens',
      ]);
    });
  });
});

// ---- SSE event contract added by Phase 19.3 Plan 02 (D-06, D-09, D-12) ----
// Declared here (not in tests/ui) to keep Plan 02's test surface inside its
// declared file scope. Plan 03 consumes these payloads in the DPEV reducer.
describe('SSE_EVENT_NAMES — Phase 19.3 observability events', () => {
  it('declares substatus, usage and session_summary constants', () => {
    const eventNames: Record<string, string> = SSE_EVENT_NAMES;

    expect(eventNames['SUBSTATUS']).toBe('dpev:substatus');
    expect(eventNames['USAGE']).toBe('dpev:usage');
    expect(eventNames['SESSION_SUMMARY']).toBe('dpev:session_summary');
  });

  it('keeps the pre-existing event constants intact', () => {
    const eventNames: Record<string, string> = SSE_EVENT_NAMES;

    expect(eventNames['PHASE']).toBe('dpev:phase');
    expect(eventNames['COMPLETE']).toBe('dpev:complete');
    expect(eventNames['ERROR']).toBe('dpev:error');
  });

  it('types the three new payload shapes in SSEEventMap', () => {
    const substatus: SSEEventMap['dpev:substatus'] = { label: 'Routing skill…', phase: 'routing' };
    const usage: SSEEventMap['dpev:usage'] = {
      phase: 'diagnosis',
      modelId: 'gemini-2.5-pro',
      inputTokens: 1000,
      outputTokens: null,
      totalTokens: null,
      costUsd: null,
    };
    const summary: SSEEventMap['dpev:session_summary'] = {
      sessionId: 's1',
      totalTokens: 1500,
      totalCostUsd: 0.00375,
      potentialSavings: null,
    };

    expect(substatus.label).toBe('Routing skill…');
    expect(usage.modelId).toBe('gemini-2.5-pro');
    expect(summary.potentialSavings).toBeNull();
  });
});
