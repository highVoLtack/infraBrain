/**
 * LanceDB-backed entity store for MemPalace knowledge graph.
 * Provides entity storage with type-based queries, temporal validity,
 * incident relationship lookups, and entity value search.
 * All operations gracefully degrade on failure (return null/empty).
 */

import * as lancedb from '@lancedb/lancedb';
import { randomUUID } from 'node:crypto';
import type { EntityRecord, Wing } from './types.js';

const TABLE_NAME = 'mem_entities';

/** Singleton store instances keyed by dataDir. */
const _stores = new Map<string, EntityStore>();

/**
 * Get or create an EntityStore for the given data directory.
 * Returns a singleton per directory path.
 */
export function getEntityStore(dataDir: string): EntityStore {
  if (!_stores.has(dataDir)) {
    _stores.set(dataDir, new EntityStore(dataDir));
  }
  return _stores.get(dataDir)!;
}

/**
 * Clear all singleton store instances (for testing).
 */
export function clearEntityStoreCache(): void {
  _stores.clear();
}

export class EntityStore {
  private dataDir: string;
  private connection: lancedb.Connection | null = null;
  private table: lancedb.Table | null = null;
  private initPromise: Promise<void> | null = null;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
  }

  /**
   * Lazy-initialize connection and table.
   * Creates the mem_entities table if it does not exist.
   */
  async init(): Promise<void> {
    if (this.connection && this.table) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this._doInit();
    return this.initPromise;
  }

  private async _doInit(): Promise<void> {
    this.connection = await lancedb.connect(this.dataDir);
    const tableNames = await this.connection.tableNames();

    if (tableNames.includes(TABLE_NAME)) {
      this.table = await this.connection.openTable(TABLE_NAME);
    } else {
      // Create table with a seed row then delete it (LanceDB requires data for schema inference)
      const seedRow = this._makeSeedRow();
      this.table = await this.connection.createTable(TABLE_NAME, [seedRow]);
      await this.table.delete(`id = '${seedRow.id}'`);
    }
  }

  private _makeSeedRow(): Record<string, unknown> {
    return {
      id: '__seed__',
      vector: new Array(1024).fill(0),
      entity_type: '',
      entity_value: '',
      wing: 'wing_incidents',
      related_incident_id: '',
      related_entity_id: '',
      relationship_type: '',
      valid_from: new Date().toISOString(),
      valid_to: '',
      expert_domain: '',
      created_at: new Date().toISOString(),
    };
  }

  private async ensureReady(): Promise<boolean> {
    try {
      await this.init();
      return this.table !== null;
    } catch (err) {
      console.error('EntityStore init failed:', err);
      return false;
    }
  }

  /**
   * Add a new entity record with its embedding vector.
   * Returns the generated entity ID, or null on failure.
   */
  async add(
    record: Omit<EntityRecord, 'id'>,
    vector: number[],
  ): Promise<string | null> {
    try {
      if (!(await this.ensureReady())) return null;
      const id = randomUUID();
      const row = { id, vector, ...record };
      await this.table!.add([row]);
      return id;
    } catch (err) {
      console.error('EntityStore add failed:', err);
      return null;
    }
  }

  /**
   * Search entities by type with optional wing filter.
   * Returns all entities of the given type (including expired).
   */
  async searchByType(
    entityType: string,
    wing?: Wing,
  ): Promise<Array<Record<string, unknown>>> {
    try {
      if (!(await this.ensureReady())) return [];
      let filter = `entity_type = '${entityType}'`;
      if (wing) {
        filter += ` AND wing = '${wing}'`;
      }
      const results = await this.table!.query()
        .where(filter)
        .toArray();
      return results;
    } catch (err) {
      console.error('EntityStore searchByType failed:', err);
      return [];
    }
  }

  /**
   * Get active (non-expired) entities of a given type.
   * Filters out entities where valid_to is set and in the past.
   */
  async getActive(
    entityType: string,
    wing?: Wing,
  ): Promise<Array<Record<string, unknown>>> {
    try {
      if (!(await this.ensureReady())) return [];
      let filter = `entity_type = '${entityType}'`;
      if (wing) {
        filter += ` AND wing = '${wing}'`;
      }
      const results = await this.table!.query()
        .where(filter)
        .toArray();

      const now = Date.now();
      return results.filter(row => {
        const validTo = row['valid_to'] as string;
        if (!validTo || validTo === '') return true; // No expiry = active
        return new Date(validTo).getTime() > now;
      });
    } catch (err) {
      console.error('EntityStore getActive failed:', err);
      return [];
    }
  }

  /**
   * Search entities by their values. Filters by entity_value column.
   * Returns entities matching any of the given values.
   */
  async searchByEntities(
    values: string[],
  ): Promise<Array<Record<string, unknown>>> {
    try {
      if (!(await this.ensureReady())) return [];
      if (values.length === 0) return [];

      // Query all and filter in-app (LanceDB SQL WHERE with IN is limited)
      const results = await this.table!.query().toArray();
      const valueSet = new Set(values);
      return results.filter(row => valueSet.has(row['entity_value'] as string));
    } catch (err) {
      console.error('EntityStore searchByEntities failed:', err);
      return [];
    }
  }

  /**
   * Search entities related to a specific incident.
   */
  async searchByIncidentId(
    incidentId: string,
  ): Promise<Array<Record<string, unknown>>> {
    try {
      if (!(await this.ensureReady())) return [];
      const results = await this.table!.query()
        .where(`related_incident_id = '${incidentId}'`)
        .toArray();
      return results;
    } catch (err) {
      console.error('EntityStore searchByIncidentId failed:', err);
      return [];
    }
  }
}
