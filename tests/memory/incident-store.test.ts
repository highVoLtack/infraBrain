import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  IncidentStore,
  getIncidentStore,
  clearIncidentStoreCache,
} from '../../src/memory/incident-store.js';
import type { IncidentRecord } from '../../src/memory/types.js';

function makeIncident(overrides: Partial<IncidentRecord> = {}): Omit<IncidentRecord, 'id'> {
  return {
    session_id: 'sess-001',
    wing: 'wing_incidents',
    prompt: 'nginx returns 502',
    diagnosis: 'upstream server is down',
    root_cause: 'backend container crashed',
    fix_summary: 'restart backend container',
    outcome: 'completed',
    skill_name: 'nginx',
    created_at: new Date().toISOString(),
    containers: JSON.stringify(['backend-api']),
    services: JSON.stringify(['nginx']),
    error_codes: JSON.stringify(['502']),
    expert_domain: '',
    ...overrides,
  };
}

function makeVector(seed = 0.1): number[] {
  return Array.from({ length: 1024 }, (_, i) => Math.sin(seed * (i + 1)));
}

describe('IncidentStore', () => {
  let tempDir: string;

  beforeEach(async () => {
    clearIncidentStoreCache();
    tempDir = await mkdtemp(join(tmpdir(), 'incident-store-test-'));
  });

  afterEach(async () => {
    clearIncidentStoreCache();
    await rm(tempDir, { recursive: true, force: true });
  });

  it('add() stores an incident and returns its ID', async () => {
    const store = getIncidentStore(tempDir);
    const id = await store.add(makeIncident(), makeVector(0.1));
    expect(id).toBeTruthy();
    expect(typeof id).toBe('string');
  });

  it('search() returns incidents ranked by vector similarity', async () => {
    const store = getIncidentStore(tempDir);
    await store.add(makeIncident({ prompt: 'nginx 502 error' }), makeVector(0.1));
    await store.add(makeIncident({ prompt: 'postgres OOM' }), makeVector(0.9));

    // Search with vector similar to first entry
    const results = await store.search(makeVector(0.1), 5);
    expect(results.length).toBeGreaterThanOrEqual(1);
    // First result should be the most similar (lowest distance)
    expect(results[0]['prompt']).toBe('nginx 502 error');
  });

  it('getRecent(5) returns last 5 incidents sorted by created_at desc', async () => {
    const store = getIncidentStore(tempDir);
    // Add incidents with different timestamps
    for (let i = 0; i < 7; i++) {
      const ts = new Date(Date.now() - (6 - i) * 60000).toISOString(); // oldest first
      await store.add(
        makeIncident({ prompt: `incident-${i}`, created_at: ts }),
        makeVector(0.1 + i * 0.01),
      );
    }

    const recent = await store.getRecent(5);
    expect(recent).toHaveLength(5);
    // Most recent first
    expect(recent[0]['prompt']).toBe('incident-6');
    expect(recent[4]['prompt']).toBe('incident-2');
  });

  it('getStats() returns totalIncidents, topDomains, successRate', async () => {
    const store = getIncidentStore(tempDir);
    await store.add(makeIncident({ skill_name: 'nginx', outcome: 'completed' }), makeVector(0.1));
    await store.add(makeIncident({ skill_name: 'nginx', outcome: 'completed' }), makeVector(0.2));
    await store.add(makeIncident({ skill_name: 'postgres', outcome: 'failed' }), makeVector(0.3));

    const stats = await store.getStats();
    expect(stats).not.toBeNull();
    expect(stats!.totalIncidents).toBe(3);
    expect(stats!.topDomains).toEqual(expect.arrayContaining([
      expect.objectContaining({ skill_name: 'nginx', count: 2 }),
    ]));
    expect(stats!.successRate).toBeCloseTo(66.67, 0);
  });

  it('search() with wing filter only returns incidents from that wing', async () => {
    const store = getIncidentStore(tempDir);
    await store.add(makeIncident({ wing: 'wing_incidents', prompt: 'incident-wing' }), makeVector(0.1));
    await store.add(makeIncident({ wing: 'wing_config', prompt: 'config-wing' }), makeVector(0.11));

    const results = await store.search(makeVector(0.1), 10, 'wing_incidents');
    expect(results.length).toBe(1);
    expect(results[0]['prompt']).toBe('incident-wing');
  });

  it('returns empty/null on init failure (graceful degradation)', async () => {
    const badStore = new IncidentStore('/nonexistent/deeply/nested/path/that/cannot/exist');
    const searchResult = await badStore.search(makeVector(), 5);
    expect(searchResult).toEqual([]);

    const addResult = await badStore.add(makeIncident(), makeVector());
    expect(addResult).toBeNull();

    const recentResult = await badStore.getRecent(5);
    expect(recentResult).toEqual([]);

    const statsResult = await badStore.getStats();
    expect(statsResult).toBeNull();
  });

  it('singleton pattern returns same instance for same directory', () => {
    const store1 = getIncidentStore(tempDir);
    const store2 = getIncidentStore(tempDir);
    expect(store1).toBe(store2);
  });
});
