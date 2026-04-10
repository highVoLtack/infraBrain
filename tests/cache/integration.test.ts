import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CacheStore, clearStoreCache } from '../../src/cache/lance-store.js';

/**
 * Integration tests for the full cache store round-trip.
 * Uses real LanceDB in a temp directory (no mocks).
 */

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'infrabrain-cache-test-'));
}

function makeVector(dim: number, fill: number): number[] {
  return new Array(dim).fill(fill);
}

function makeRandomVector(dim: number): number[] {
  return Array.from({ length: dim }, () => Math.random());
}

describe('Cache Integration', () => {
  let tempDir: string;
  let store: CacheStore;

  beforeEach(async () => {
    clearStoreCache();
    tempDir = makeTempDir();
    store = new CacheStore(tempDir);
    await store.init();
  });

  afterEach(() => {
    clearStoreCache();
    try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('stores an entry and retrieves it via vector search', async () => {
    const embedding = makeVector(1024, 0.5);

    const id = await store.add(
      {
        error_signature: 'nginx 502 bad gateway',
        skill_name: 'nginx',
        fix_plan: '{"summary":"restart upstream","steps":[],"complexity":"simple"}',
        diagnosis: 'upstream server not responding',
        session_id: 'sess-integration-1',
        created_at: new Date().toISOString(),
        last_used: new Date().toISOString(),
        hit_count: 0,
        success_count: 0,
        fail_count: 0,
      },
      embedding,
    );

    expect(id).toBeTruthy();

    // Search with same embedding -- should be a near-perfect match
    const results = await store.search(embedding, 1);
    expect(results.length).toBeGreaterThan(0);

    const topResult = results[0];
    const distance = Number(topResult._distance);
    const similarity = 1 - distance;

    // Same vector should yield similarity ~1.0
    expect(similarity).toBeGreaterThanOrEqual(0.99);
    expect(String(topResult.skill_name)).toBe('nginx');
    expect(String(topResult.session_id)).toBe('sess-integration-1');
  });

  it('returns no match for completely different embedding', async () => {
    // Store entry with vector of 0.1s
    await store.add(
      {
        error_signature: 'nginx 502',
        skill_name: 'nginx',
        fix_plan: '{}',
        diagnosis: 'upstream down',
        session_id: 'sess-1',
        created_at: new Date().toISOString(),
        last_used: new Date().toISOString(),
        hit_count: 0,
        success_count: 0,
        fail_count: 0,
      },
      makeVector(1024, 0.1),
    );

    // Search with a very different vector
    const differentVector = makeVector(1024, -0.9);
    const results = await store.search(differentVector, 1);

    if (results.length > 0) {
      const distance = Number(results[0]._distance);
      const similarity = 1 - distance;
      // Should have low similarity for orthogonal vectors
      expect(similarity).toBeLessThan(0.85);
    }
  });

  it('updates stats via recordFixOutcome pattern', async () => {
    const embedding = makeVector(1024, 0.3);
    const id = await store.add(
      {
        error_signature: 'postgres connection leak',
        skill_name: 'postgres',
        fix_plan: '{}',
        diagnosis: 'idle connections accumulating',
        session_id: 'sess-outcome-1',
        created_at: new Date().toISOString(),
        last_used: new Date().toISOString(),
        hit_count: 0,
        success_count: 0,
        fail_count: 0,
      },
      embedding,
    );

    expect(id).toBeTruthy();

    // Update stats: increment success
    const updated = await store.updateStats(id!, {
      success_count: 1,
      last_used: new Date().toISOString(),
    });
    expect(updated).toBe(true);

    // Verify update via listAll
    const all = await store.listAll();
    const entry = all.find(e => String(e.id) === id);
    expect(entry).toBeDefined();
    expect(Number(entry!.success_count)).toBe(1);
  });

  it('deletes entries by skill', async () => {
    const embedding = makeVector(1024, 0.2);

    await store.add(
      {
        error_signature: 'nginx issue',
        skill_name: 'nginx',
        fix_plan: '{}',
        diagnosis: 'test',
        session_id: 'sess-del-1',
        created_at: new Date().toISOString(),
        last_used: new Date().toISOString(),
        hit_count: 0,
        success_count: 0,
        fail_count: 0,
      },
      embedding,
    );

    await store.add(
      {
        error_signature: 'postgres issue',
        skill_name: 'postgres',
        fix_plan: '{}',
        diagnosis: 'test2',
        session_id: 'sess-del-2',
        created_at: new Date().toISOString(),
        last_used: new Date().toISOString(),
        hit_count: 0,
        success_count: 0,
        fail_count: 0,
      },
      makeVector(1024, 0.4),
    );

    // Should have 2 entries
    let all = await store.listAll();
    expect(all.length).toBe(2);

    // Delete by skill
    const deleted = await store.deleteBySkill('nginx');
    expect(deleted).toBe(true);

    // Should have 1 entry left
    all = await store.listAll();
    expect(all.length).toBe(1);
    expect(String(all[0].skill_name)).toBe('postgres');
  });

  it('deleteAll purges all entries', async () => {
    await store.add(
      {
        error_signature: 'test1',
        skill_name: 'skill1',
        fix_plan: '{}',
        diagnosis: 'd1',
        session_id: 'sess-1',
        created_at: new Date().toISOString(),
        last_used: new Date().toISOString(),
        hit_count: 0,
        success_count: 0,
        fail_count: 0,
      },
      makeVector(1024, 0.1),
    );
    await store.add(
      {
        error_signature: 'test2',
        skill_name: 'skill2',
        fix_plan: '{}',
        diagnosis: 'd2',
        session_id: 'sess-2',
        created_at: new Date().toISOString(),
        last_used: new Date().toISOString(),
        hit_count: 0,
        success_count: 0,
        fail_count: 0,
      },
      makeVector(1024, 0.2),
    );

    let all = await store.listAll();
    expect(all.length).toBe(2);

    await store.deleteAll();

    all = await store.listAll();
    expect(all.length).toBe(0);
  });
});

describe('Cache Performance', () => {
  let tempDir: string;
  let store: CacheStore;

  beforeEach(async () => {
    clearStoreCache();
    tempDir = makeTempDir();
    store = new CacheStore(tempDir);
    await store.init();
  });

  afterEach(() => {
    clearStoreCache();
    try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('vector search completes under 500ms for 100 entries', async () => {
    // Store 100 entries with random embeddings
    for (let i = 0; i < 100; i++) {
      await store.add(
        {
          error_signature: `error-${i}`,
          skill_name: `skill-${i % 5}`,
          fix_plan: `{"summary":"fix-${i}","steps":[],"complexity":"simple"}`,
          diagnosis: `diagnosis for error ${i}`,
          session_id: `sess-perf-${i}`,
          created_at: new Date().toISOString(),
          last_used: new Date().toISOString(),
          hit_count: 0,
          success_count: 0,
          fail_count: 0,
        },
        makeRandomVector(1024),
      );
    }

    // Verify 100 entries stored
    const all = await store.listAll();
    expect(all.length).toBe(100);

    // Search should complete in < 500ms
    const searchVector = makeRandomVector(1024);
    const start = Date.now();
    const results = await store.search(searchVector, 1);
    const elapsed = Date.now() - start;

    expect(results.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(500);
  });
});
