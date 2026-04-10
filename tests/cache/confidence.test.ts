import { describe, it, expect } from 'vitest';
import { computeConfidence } from '../../src/cache/confidence.js';
import type { ConfidenceConfig } from '../../src/cache/types.js';

describe('computeConfidence', () => {
  // Use a fixed "now" by providing lastUsed = now (ageDays = 0)
  const now = new Date().toISOString();

  it('returns 0.95 for perfect similarity, zero age, 100% success rate', () => {
    // w_sim=0.5 * 0.90 + w_rec=0.3 * exp(0)=1.0 + w_suc=0.2 * 1.0 = 0.45 + 0.30 + 0.20 = 0.95
    const score = computeConfidence(0.90, now, 10, 10);
    expect(score).toBeCloseTo(0.95, 2);
  });

  it('returns lower score for aged entries with partial success', () => {
    // 30 days old, 50% success rate
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const score = computeConfidence(0.90, thirtyDaysAgo, 5, 10);
    // w_sim=0.5*0.90 = 0.45
    // w_rec=0.3*exp(-0.1*30) = 0.3*exp(-3) ≈ 0.3*0.0498 ≈ 0.01494
    // w_suc=0.2*0.5 = 0.10
    // total ≈ 0.5649
    expect(score).toBeCloseTo(0.5649, 2);
    expect(score).toBeLessThan(0.95);
  });

  it('uses neutral 0.5 success rate when totalUses is zero', () => {
    // w_sim=0.5*0.90 + w_rec=0.3*1.0 + w_suc=0.2*0.5 = 0.45 + 0.30 + 0.10 = 0.85
    const score = computeConfidence(0.90, now, 0, 0);
    expect(score).toBeCloseTo(0.85, 2);
  });

  it('applies exponential decay correctly', () => {
    const config: ConfidenceConfig = { w_sim: 0.5, w_rec: 0.3, w_suc: 0.2, decayLambda: 0.1 };
    // 10 days: recency = exp(-1) ≈ 0.3679
    const tenDaysAgo = new Date(Date.now() - 10 * 86_400_000).toISOString();
    const score = computeConfidence(1.0, tenDaysAgo, 10, 10, config);
    // 0.5*1.0 + 0.3*0.3679 + 0.2*1.0 = 0.5 + 0.11036 + 0.2 = 0.81036
    expect(score).toBeCloseTo(0.8104, 2);
  });

  it('supports custom weights', () => {
    const config: ConfidenceConfig = { w_sim: 1.0, w_rec: 0.0, w_suc: 0.0, decayLambda: 0.1 };
    const score = computeConfidence(0.75, now, 10, 10, config);
    expect(score).toBeCloseTo(0.75, 2);
  });
});
