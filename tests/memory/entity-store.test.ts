import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  EntityStore,
  getEntityStore,
  clearEntityStoreCache,
} from '../../src/memory/entity-store.js';
import type { EntityRecord } from '../../src/memory/types.js';

function makeEntity(overrides: Partial<EntityRecord> = {}): Omit<EntityRecord, 'id'> {
  return {
    entity_type: 'container',
    entity_value: 'backend-api',
    wing: 'wing_incidents',
    related_incident_id: 'inc-001',
    related_entity_id: '',
    relationship_type: 'involved_in',
    valid_from: new Date().toISOString(),
    valid_to: '',
    expert_domain: '',
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeVector(seed = 0.1): number[] {
  return Array.from({ length: 1024 }, (_, i) => Math.sin(seed * (i + 1)));
}

describe('EntityStore', () => {
  let tempDir: string;

  beforeEach(async () => {
    clearEntityStoreCache();
    tempDir = await mkdtemp(join(tmpdir(), 'entity-store-test-'));
  });

  afterEach(async () => {
    clearEntityStoreCache();
    await rm(tempDir, { recursive: true, force: true });
  });

  it('add() stores an entity with valid_from timestamp', async () => {
    const store = getEntityStore(tempDir);
    const validFrom = new Date().toISOString();
    const id = await store.add(
      makeEntity({ valid_from: validFrom }),
      makeVector(0.1),
    );
    expect(id).toBeTruthy();
    expect(typeof id).toBe('string');
  });

  it('searchByType("container") returns only container entities', async () => {
    const store = getEntityStore(tempDir);
    await store.add(makeEntity({ entity_type: 'container', entity_value: 'nginx-proxy' }), makeVector(0.1));
    await store.add(makeEntity({ entity_type: 'port', entity_value: '8080' }), makeVector(0.2));
    await store.add(makeEntity({ entity_type: 'container', entity_value: 'backend-api' }), makeVector(0.3));

    const containers = await store.searchByType('container');
    expect(containers).toHaveLength(2);
    for (const row of containers) {
      expect(row['entity_type']).toBe('container');
    }
  });

  it('searchByEntities() finds entities matching given values', async () => {
    const store = getEntityStore(tempDir);
    await store.add(makeEntity({ entity_value: 'nginx-proxy' }), makeVector(0.1));
    await store.add(makeEntity({ entity_value: 'backend-api' }), makeVector(0.2));
    await store.add(makeEntity({ entity_value: 'redis-cache' }), makeVector(0.3));

    const matches = await store.searchByEntities(['nginx-proxy', 'redis-cache']);
    expect(matches).toHaveLength(2);
    const values = matches.map(m => m['entity_value']);
    expect(values).toContain('nginx-proxy');
    expect(values).toContain('redis-cache');
  });

  it('handles valid_to for temporal validity (expired entities)', async () => {
    const store = getEntityStore(tempDir);
    const pastDate = new Date(Date.now() - 86400000).toISOString(); // yesterday
    await store.add(
      makeEntity({
        entity_value: 'expired-container',
        valid_to: pastDate,
      }),
      makeVector(0.1),
    );
    await store.add(
      makeEntity({
        entity_value: 'active-container',
        valid_to: '',
      }),
      makeVector(0.2),
    );

    // searchByType returns all (including expired) -- consumers filter
    const all = await store.searchByType('container');
    expect(all).toHaveLength(2);

    // But getActive only returns non-expired
    const active = await store.getActive('container');
    expect(active).toHaveLength(1);
    expect(active[0]['entity_value']).toBe('active-container');
  });

  it('searchByIncidentId returns entities for a specific incident', async () => {
    const store = getEntityStore(tempDir);
    await store.add(makeEntity({ related_incident_id: 'inc-001', entity_value: 'nginx' }), makeVector(0.1));
    await store.add(makeEntity({ related_incident_id: 'inc-002', entity_value: 'postgres' }), makeVector(0.2));
    await store.add(makeEntity({ related_incident_id: 'inc-001', entity_value: 'redis' }), makeVector(0.3));

    const results = await store.searchByIncidentId('inc-001');
    expect(results).toHaveLength(2);
    const values = results.map(r => r['entity_value']);
    expect(values).toContain('nginx');
    expect(values).toContain('redis');
  });

  it('returns empty/null on init failure (graceful degradation)', async () => {
    const badStore = new EntityStore('/nonexistent/deeply/nested/path/that/cannot/exist');
    const addResult = await badStore.add(makeEntity(), makeVector());
    expect(addResult).toBeNull();

    const typeResult = await badStore.searchByType('container');
    expect(typeResult).toEqual([]);

    const entityResult = await badStore.searchByEntities(['test']);
    expect(entityResult).toEqual([]);

    const incidentResult = await badStore.searchByIncidentId('inc-001');
    expect(incidentResult).toEqual([]);
  });

  it('singleton pattern returns same instance for same directory', () => {
    const store1 = getEntityStore(tempDir);
    const store2 = getEntityStore(tempDir);
    expect(store1).toBe(store2);
  });
});
