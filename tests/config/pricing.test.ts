import { describe, it, expect } from 'vitest';
import {
  PricingEntrySchema,
  PricingTableSchema,
  DEFAULT_PRICING,
  computeCost,
  type PricingTable,
} from '../../src/config/pricing.js';

describe('PricingEntrySchema', () => {
  it('fills missing fields with 0 defaults', () => {
    const result = PricingEntrySchema.parse({});
    expect(result).toEqual({ inputPer1k: 0, outputPer1k: 0 });
  });

  it('parses a full entry as-is', () => {
    const result = PricingEntrySchema.parse({ inputPer1k: 0.00125, outputPer1k: 0.005 });
    expect(result).toEqual({ inputPer1k: 0.00125, outputPer1k: 0.005 });
  });

  it('rejects non-number inputPer1k', () => {
    expect(() => PricingEntrySchema.parse({ inputPer1k: 'free' })).toThrow();
  });

  it('rejects non-number outputPer1k', () => {
    expect(() => PricingEntrySchema.parse({ outputPer1k: null })).toThrow();
  });
});

describe('PricingTableSchema', () => {
  it('parses a record of model id -> pricing entry', () => {
    const result = PricingTableSchema.parse({
      'some-model': { inputPer1k: 1, outputPer1k: 2 },
    });
    expect(result['some-model']).toEqual({ inputPer1k: 1, outputPer1k: 2 });
  });

  it('applies entry defaults inside the table', () => {
    const result = PricingTableSchema.parse({ 'bare-model': {} });
    expect(result['bare-model']).toEqual({ inputPer1k: 0, outputPer1k: 0 });
  });

  it('accepts DEFAULT_PRICING', () => {
    expect(() => PricingTableSchema.parse(DEFAULT_PRICING)).not.toThrow();
  });
});

describe('DEFAULT_PRICING', () => {
  it('covers the four v1.3 baseline models', () => {
    expect(DEFAULT_PRICING).toHaveProperty('gemini-2.5-pro');
    expect(DEFAULT_PRICING).toHaveProperty('gemini-2.5-flash');
    expect(DEFAULT_PRICING).toHaveProperty('qwen3-32b');
    expect(DEFAULT_PRICING).toHaveProperty('infrabrain');
  });

  it('prices local models at zero', () => {
    expect(DEFAULT_PRICING['qwen3-32b']).toEqual({ inputPer1k: 0, outputPer1k: 0 });
    expect(DEFAULT_PRICING['infrabrain']).toEqual({ inputPer1k: 0, outputPer1k: 0 });
  });
});

describe('computeCost', () => {
  it('computes cost for a known cloud model', () => {
    // 1000 in * 0.00125/1k + 1000 out * 0.005/1k = 0.00125 + 0.005
    expect(computeCost('gemini-2.5-pro', 1000, 1000)).toBeCloseTo(0.00625, 10);
  });

  it('computes cost for gemini-2.5-flash', () => {
    expect(computeCost('gemini-2.5-flash', 1000, 1000)).toBeCloseTo(0.000375, 10);
  });

  it('returns null for an unknown model (not 0, not a throw)', () => {
    expect(computeCost('unknown-model', 1000, 1000)).toBeNull();
  });

  it('does not throw on unknown model', () => {
    expect(() => computeCost('nope', 5, 5)).not.toThrow();
  });

  it('returns 0 for local models with zero rates', () => {
    expect(computeCost('qwen3-32b', 1000, 1000)).toBe(0);
  });

  it('returns 0 when token counts are zero', () => {
    expect(computeCost('gemini-2.5-pro', 0, 0)).toBe(0);
  });

  it('uses a provided custom table instead of DEFAULT_PRICING', () => {
    const customTable: PricingTable = {
      'gemini-2.5-pro': { inputPer1k: 1, outputPer1k: 2 },
    };
    expect(computeCost('gemini-2.5-pro', 1000, 1000, customTable)).toBeCloseTo(3, 10);
  });

  it('returns null when a custom table lacks the model', () => {
    const customTable: PricingTable = {
      'other-model': { inputPer1k: 1, outputPer1k: 2 },
    };
    expect(computeCost('gemini-2.5-pro', 1000, 1000, customTable)).toBeNull();
  });

  it('scales linearly with token counts', () => {
    const single = computeCost('gemini-2.5-pro', 1000, 1000);
    const double = computeCost('gemini-2.5-pro', 2000, 2000);
    expect(single).not.toBeNull();
    expect(double).toBeCloseTo((single as number) * 2, 10);
  });

  it('handles input-only and output-only usage independently', () => {
    expect(computeCost('gemini-2.5-pro', 1000, 0)).toBeCloseTo(0.00125, 10);
    expect(computeCost('gemini-2.5-pro', 0, 1000)).toBeCloseTo(0.005, 10);
  });
});
