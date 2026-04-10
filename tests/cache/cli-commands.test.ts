import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock lance-store before importing cache-commands
vi.mock('../../src/cache/lance-store.js', () => ({
  getCacheStore: vi.fn(),
  clearStoreCache: vi.fn(),
}));

import { formatAge, formatSuccessRate } from '../../src/cli/cache-commands.js';

describe('formatAge', () => {
  it('returns seconds for very recent timestamps', () => {
    const now = new Date();
    const result = formatAge(now.toISOString());
    expect(result).toMatch(/\d+s ago/);
  });

  it('returns minutes for timestamps within the last hour', () => {
    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000);
    const result = formatAge(thirtyMinAgo.toISOString());
    expect(result).toMatch(/\d+m ago/);
  });

  it('returns hours for timestamps within the last day', () => {
    const fiveHoursAgo = new Date(Date.now() - 5 * 60 * 60 * 1000);
    const result = formatAge(fiveHoursAgo.toISOString());
    expect(result).toMatch(/\d+h ago/);
  });

  it('returns days for older timestamps', () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const result = formatAge(threeDaysAgo.toISOString());
    expect(result).toMatch(/\d+d ago/);
  });
});

describe('formatSuccessRate', () => {
  it('returns percentage with counts', () => {
    expect(formatSuccessRate(4, 1)).toBe('80% (4/5)');
  });

  it('returns N/A when no attempts', () => {
    expect(formatSuccessRate(0, 0)).toBe('N/A');
  });

  it('returns 100% for all successes', () => {
    expect(formatSuccessRate(10, 0)).toBe('100% (10/10)');
  });

  it('returns 0% for all failures', () => {
    expect(formatSuccessRate(0, 5)).toBe('0% (0/5)');
  });
});
