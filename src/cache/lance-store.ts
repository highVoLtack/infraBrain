/**
 * LanceDB-backed fix cache store.
 * Provides singleton connection management, vector search, CRUD operations.
 * All operations gracefully degrade on failure (return null/empty).
 */

import * as lancedb from '@lancedb/lancedb';
import { randomUUID } from 'node:crypto';
import type { CacheEntry } from './types.js';

const TABLE_NAME = 'fix_cache';

/** Singleton store instances keyed by dataDir. */
const _stores = new Map<string, CacheStore>();

/**
 * Get or create a CacheStore for the given data directory.
 * Returns a singleton per directory path.
 */
export function getCacheStore(dataDir: string): CacheStore {
  if (!_stores.has(dataDir)) {
    _stores.set(dataDir, new CacheStore(dataDir));
  }
  return _stores.get(dataDir)!;
}

/**
 * Clear all singleton store instances (for testing).
 */
export function clearStoreCache(): void {
  _stores.clear();
}

export class CacheStore {
  private dataDir: string;
  private connection: lancedb.Connection | null = null;
  private table: lancedb.Table | null = null;
  private initPromise: Promise<void> | null = null;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
  }

  /**
   * Lazy-initialize connection. Opens existing table if present.
   * Table creation deferred to first add() — avoids hardcoding vector dimensions.
   */
  async init(): Promise<void> {
    if (this.connection) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this._doInit();
    return this.initPromise;
  }

  private async _doInit(): Promise<void> {
    this.connection = await lancedb.connect(this.dataDir);
    const tableNames = await this.connection.tableNames();

    if (tableNames.includes(TABLE_NAME)) {
      this.table = await this.connection.openTable(TABLE_NAME);
    }
    // If table doesn't exist yet, it will be created on first add()
    // with the actual vector dimensions from the embedding model
  }

  /**
   * Create the table from the first real data row.
   * LanceDB infers schema from data — no seed row needed.
   */
  private async createTableFromRow(row: Record<string, unknown>): Promise<void> {
    if (!this.connection) return;
    this.table = await this.connection.createTable(TABLE_NAME, [row]);
  }

  private async ensureReady(): Promise<boolean> {
    try {
      await this.init();
      return this.connection !== null;
    } catch (err) {
      console.error('CacheStore init failed:', err);
      return false;
    }
  }

  /**
   * Vector similarity search. Returns raw rows with _distance field.
   * Lower _distance = more similar (cosine distance).
   */
  async search(
    embedding: number[],
    limit = 5,
  ): Promise<Array<Record<string, unknown>>> {
    try {
      if (!(await this.ensureReady())) return [];
      if (!this.table) return []; // Table not yet created (no entries added yet)
      const results = await this.table
        .search(embedding)
        .distanceType('cosine')
        .limit(limit)
        .toArray();
      return results;
    } catch (err) {
      console.error('CacheStore search failed:', err);
      return [];
    }
  }

  /**
   * Add a new cache entry with its embedding vector.
   * Returns the generated entry ID, or null on failure.
   */
  async add(
    entry: Omit<CacheEntry, 'id' | 'vector'>,
    vector: number[],
  ): Promise<string | null> {
    try {
      if (!(await this.ensureReady())) return null;
      const id = randomUUID();
      const row = { id, vector, ...entry };
      if (!this.table) {
        await this.createTableFromRow(row);
      } else {
        await this.table.add([row]);
      }
      return id;
    } catch (err) {
      console.error('CacheStore add failed:', err);
      return null;
    }
  }

  /**
   * Delete all cache entries for a specific skill.
   */
  async deleteBySkill(skillName: string): Promise<boolean> {
    try {
      if (!(await this.ensureReady())) return false;
      if (!this.table) return true; // No entries yet
      await this.table.delete(`skill_name = '${skillName}'`);
      return true;
    } catch (err) {
      console.error('CacheStore deleteBySkill failed:', err);
      return false;
    }
  }

  /**
   * Purge all cache entries (drop and recreate table).
   */
  async deleteAll(): Promise<boolean> {
    try {
      if (!(await this.ensureReady())) return false;
      if (this.table) {
        await this.connection!.dropTable(TABLE_NAME);
        this.table = null;
      }
      return true;
    } catch (err) {
      console.error('CacheStore deleteAll failed:', err);
      return false;
    }
  }

  /**
   * List all cache entries (for CLI display).
   */
  async listAll(): Promise<Array<Record<string, unknown>>> {
    try {
      if (!(await this.ensureReady())) return [];
      if (!this.table) return [];
      const results = await this.table.query().toArray();
      return results;
    } catch (err) {
      console.error('CacheStore listAll failed:', err);
      return [];
    }
  }

  /**
   * Get a single cache entry by ID.
   * Returns null if not found or on failure (graceful degradation).
   */
  async getById(id: string): Promise<Record<string, unknown> | null> {
    try {
      if (!(await this.ensureReady())) return null;
      if (!this.table) return null;
      const results = await this.table.query()
        .where(`id = '${id}'`)
        .limit(1)
        .toArray();
      return results.length > 0 ? results[0] : null;
    } catch (err) {
      console.error('CacheStore getById failed:', err);
      return null;
    }
  }

  /**
   * Update stats for a cache entry (hit_count, success_count, fail_count, last_used).
   */
  async updateStats(
    id: string,
    updates: Partial<Pick<CacheEntry, 'hit_count' | 'success_count' | 'fail_count' | 'last_used'>>,
  ): Promise<boolean> {
    try {
      if (!(await this.ensureReady())) return false;
      const valuesSql: Record<string, string> = {};
      if (updates.hit_count !== undefined) valuesSql['hit_count'] = String(updates.hit_count);
      if (updates.success_count !== undefined) valuesSql['success_count'] = String(updates.success_count);
      if (updates.fail_count !== undefined) valuesSql['fail_count'] = String(updates.fail_count);
      if (updates.last_used !== undefined) valuesSql['last_used'] = `'${updates.last_used}'`;

      if (Object.keys(valuesSql).length === 0) return true;
      if (!this.table) return false;

      await this.table.update({ valuesSql, where: `id = '${id}'` });
      return true;
    } catch (err) {
      console.error('CacheStore updateStats failed:', err);
      return false;
    }
  }
}
