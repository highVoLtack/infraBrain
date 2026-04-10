import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getCacheStore, clearStoreCache, CacheStore } from '../../src/cache/lance-store.js';

describe('CacheStore', () => {
  let tempDir: string;

  beforeEach(async () => {
    clearStoreCache();
    tempDir = await mkdtemp(join(tmpdir(), 'lance-test-'));
  });

  afterEach(async () => {
    clearStoreCache();
    await rm(tempDir, { recursive: true, force: true });
  });

  function makeEntry(overrides: Record<string, unknown> = {}) {
    return {
      error_signature: 'nginx 502 bad gateway',
      skill_name: 'nginx',
      fix_plan: '{"steps":[]}',
      diagnosis: 'upstream server down',
      session_id: 'sess-001',
      created_at: new Date().toISOString(),
      last_used: new Date().toISOString(),
      hit_count: 0,
      success_count: 0,
      fail_count: 0,
      ...overrides,
    };
  }

  function makeVector(seed = 0.1): number[] {
    // Create a deterministic 1024-dim vector
    return Array.from({ length: 1024 }, (_, i) => Math.sin(seed * (i + 1)));
  }

  it('getCacheStore returns singleton per directory', () => {
    const store1 = getCacheStore(tempDir);
    const store2 = getCacheStore(tempDir);
    expect(store1).toBe(store2);
  });

  it('creates table, adds entry, and searches by vector', async () => {
    const store = getCacheStore(tempDir);
    const vector = makeVector(0.1);
    const id = await store.add(makeEntry(), vector);
    expect(id).toBeTruthy();

    // Search with the same vector should find it with low distance
    const results = await store.search(vector, 5);
    expect(results.length).toBe(1);
    expect(results[0]['error_signature']).toBe('nginx 502 bad gateway');
    expect(results[0]['_distance']).toBeDefined();
    expect(Number(results[0]['_distance'])).toBeLessThan(0.01);
  });

  it('deleteBySkill removes only that skill entries', async () => {
    const store = getCacheStore(tempDir);
    await store.add(makeEntry({ skill_name: 'nginx' }), makeVector(0.1));
    await store.add(makeEntry({ skill_name: 'postgres' }), makeVector(0.2));

    await store.deleteBySkill('nginx');

    const all = await store.listAll();
    expect(all.length).toBe(1);
    expect(all[0]['skill_name']).toBe('postgres');
  });

  it('deleteAll clears everything', async () => {
    const store = getCacheStore(tempDir);
    await store.add(makeEntry(), makeVector(0.1));
    await store.add(makeEntry(), makeVector(0.2));

    const beforeDelete = await store.listAll();
    expect(beforeDelete.length).toBe(2);

    await store.deleteAll();

    const afterDelete = await store.listAll();
    expect(afterDelete.length).toBe(0);
  });

  it('listAll returns all entries', async () => {
    const store = getCacheStore(tempDir);
    await store.add(makeEntry({ error_signature: 'err1' }), makeVector(0.1));
    await store.add(makeEntry({ error_signature: 'err2' }), makeVector(0.2));
    await store.add(makeEntry({ error_signature: 'err3' }), makeVector(0.3));

    const all = await store.listAll();
    expect(all.length).toBe(3);
  });

  it('updateStats modifies entry fields', async () => {
    const store = getCacheStore(tempDir);
    const id = await store.add(makeEntry(), makeVector(0.1));
    expect(id).toBeTruthy();

    const newLastUsed = new Date().toISOString();
    await store.updateStats(id!, {
      hit_count: 5,
      success_count: 3,
      last_used: newLastUsed,
    });

    const results = await store.search(makeVector(0.1), 1);
    expect(results.length).toBe(1);
    expect(Number(results[0]['hit_count'])).toBe(5);
    expect(Number(results[0]['success_count'])).toBe(3);
  });

  it('gracefully handles operations on invalid path', async () => {
    // CacheStore should not throw but return empty/null
    const badStore = new CacheStore('/nonexistent/deeply/nested/path/that/cannot/exist');
    const searchResult = await badStore.search(makeVector(), 5);
    expect(searchResult).toEqual([]);

    const addResult = await badStore.add(makeEntry(), makeVector());
    expect(addResult).toBeNull();

    const listResult = await badStore.listAll();
    expect(listResult).toEqual([]);
  });
});
