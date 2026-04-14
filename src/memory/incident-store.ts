/**
 * LanceDB-backed incident store for MemPalace semantic memory.
 * Provides incident storage with vector search, wing filtering,
 * recent incident retrieval, and statistics.
 * All operations gracefully degrade on failure (return null/empty).
 */

import * as lancedb from '@lancedb/lancedb';
import { randomUUID } from 'node:crypto';
import type { IncidentRecord, Wing } from './types.js';

const TABLE_NAME = 'mem_incidents';

/** Singleton store instances keyed by dataDir. */
const _stores = new Map<string, IncidentStore>();

/**
 * Get or create an IncidentStore for the given data directory.
 * Returns a singleton per directory path.
 */
export function getIncidentStore(dataDir: string): IncidentStore {
  if (!_stores.has(dataDir)) {
    _stores.set(dataDir, new IncidentStore(dataDir));
  }
  return _stores.get(dataDir)!;
}

/**
 * Clear all singleton store instances (for testing).
 */
export function clearIncidentStoreCache(): void {
  _stores.clear();
}

export class IncidentStore {
  private dataDir: string;
  private connection: lancedb.Connection | null = null;
  private table: lancedb.Table | null = null;
  private initPromise: Promise<void> | null = null;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
  }

  /**
   * Lazy-initialize connection and table.
   * Creates the mem_incidents table if it does not exist.
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
      session_id: '',
      wing: 'wing_incidents',
      prompt: '',
      diagnosis: '',
      root_cause: '',
      fix_summary: '',
      outcome: '',
      skill_name: '',
      created_at: new Date().toISOString(),
      containers: '[]',
      services: '[]',
      error_codes: '[]',
      expert_domain: '',
    };
  }

  private async ensureReady(): Promise<boolean> {
    try {
      await this.init();
      return this.table !== null;
    } catch (err) {
      console.error('IncidentStore init failed:', err);
      return false;
    }
  }

  /**
   * Add a new incident record with its embedding vector.
   * Returns the generated incident ID, or null on failure.
   */
  async add(
    record: Omit<IncidentRecord, 'id'>,
    vector: number[],
  ): Promise<string | null> {
    try {
      if (!(await this.ensureReady())) return null;
      const id = randomUUID();
      const row = { id, vector, ...record };
      await this.table!.add([row]);
      return id;
    } catch (err) {
      console.error('IncidentStore add failed:', err);
      return null;
    }
  }

  /**
   * Vector similarity search with optional wing filter.
   * Returns raw rows with _distance field. Lower _distance = more similar.
   */
  async search(
    embedding: number[],
    limit = 5,
    wing?: Wing,
  ): Promise<Array<Record<string, unknown>>> {
    try {
      if (!(await this.ensureReady())) return [];
      let query = this.table!
        .search(embedding)
        .distanceType('cosine')
        .limit(limit);

      if (wing) {
        query = query.where(`wing = '${wing}'`);
      }

      const results = await query.toArray();
      return results;
    } catch (err) {
      console.error('IncidentStore search failed:', err);
      return [];
    }
  }

  /**
   * Get most recent incidents sorted by created_at descending.
   * Does not require a vector -- pure metadata query.
   */
  async getRecent(limit: number): Promise<Array<Record<string, unknown>>> {
    try {
      if (!(await this.ensureReady())) return [];
      const results = await this.table!.query().toArray();
      // Sort by created_at descending and take limit
      results.sort((a, b) => {
        const aTime = new Date(a['created_at'] as string).getTime();
        const bTime = new Date(b['created_at'] as string).getTime();
        return bTime - aTime;
      });
      return results.slice(0, limit);
    } catch (err) {
      console.error('IncidentStore getRecent failed:', err);
      return [];
    }
  }

  /**
   * Get aggregate statistics about stored incidents.
   * Returns null on failure (graceful degradation).
   */
  async getStats(): Promise<{
    totalIncidents: number;
    topDomains: Array<{ skill_name: string; count: number }>;
    successRate: number;
  } | null> {
    try {
      if (!(await this.ensureReady())) return null;
      const rows = await this.table!.query().toArray();

      const totalIncidents = rows.length;
      if (totalIncidents === 0) {
        return { totalIncidents: 0, topDomains: [], successRate: 0 };
      }

      // Count by skill_name
      const domainCounts = new Map<string, number>();
      let completedCount = 0;

      for (const row of rows) {
        const skill = row['skill_name'] as string;
        domainCounts.set(skill, (domainCounts.get(skill) || 0) + 1);

        if (row['outcome'] === 'completed') {
          completedCount++;
        }
      }

      const topDomains = [...domainCounts.entries()]
        .map(([skill_name, count]) => ({ skill_name, count }))
        .sort((a, b) => b.count - a.count);

      const successRate = (completedCount / totalIncidents) * 100;

      return { totalIncidents, topDomains, successRate };
    } catch (err) {
      console.error('IncidentStore getStats failed:', err);
      return null;
    }
  }
}
