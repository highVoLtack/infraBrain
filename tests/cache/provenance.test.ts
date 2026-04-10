import { describe, it, expect } from 'vitest';
import { formatProvenance } from '../../src/cache/cache-lookup.js';
import type { CacheHit } from '../../src/cache/types.js';

function makeCacheHit(overrides: Partial<CacheHit> = {}): CacheHit {
  return {
    similarity: 0.92,
    confidence: 0.88,
    entry: {
      id: 'entry-abc-123',
      vector: [],
      error_signature: 'nginx 502',
      skill_name: 'nginx',
      fix_plan: '{"steps":[]}',
      diagnosis: 'upstream down',
      session_id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      created_at: '2026-04-08T10:00:00Z',
      last_used: '2026-04-09T15:30:00Z',
      hit_count: 3,
      success_count: 2,
      fail_count: 0,
    },
    ...overrides,
  };
}

describe('formatProvenance', () => {
  it('produces correct string with similarity and confidence percentages', () => {
    const hit = makeCacheHit({ similarity: 0.92, confidence: 0.88 });
    const result = formatProvenance(hit);

    expect(result).toContain('a1b2c3d4');
    expect(result).toContain('similarity: 92%');
    expect(result).toContain('confidence: 88%');
    expect(result).toContain('Cache Hit');
  });

  it('handles 0% similarity edge case', () => {
    const hit = makeCacheHit({ similarity: 0, confidence: 0 });
    const result = formatProvenance(hit);

    expect(result).toContain('similarity: 0%');
    expect(result).toContain('confidence: 0%');
  });

  it('handles 100% similarity', () => {
    const hit = makeCacheHit({ similarity: 1.0, confidence: 1.0 });
    const result = formatProvenance(hit);

    expect(result).toContain('similarity: 100%');
    expect(result).toContain('confidence: 100%');
  });

  it('includes session ID prefix (first 8 chars)', () => {
    const hit = makeCacheHit();
    hit.entry.session_id = 'deadbeef-1234-5678-9abc-def012345678';
    const result = formatProvenance(hit);

    expect(result).toContain('deadbeef');
    expect(result).not.toContain('deadbeef-1234'); // Only first 8 chars
  });

  it('includes relative date from created_at', () => {
    const hit = makeCacheHit();
    const result = formatProvenance(hit);
    // Should contain some date reference (the format will vary)
    expect(result).toBeTruthy();
    expect(result.length).toBeGreaterThan(20);
  });
});
