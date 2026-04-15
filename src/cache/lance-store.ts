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
export function getCacheStore(dataDir: string, vectorDim?: number): CacheStore {
  if (!_stores.has(dataDir)) {
    _stores.set(dataDir, new CacheStore(dataDir, vectorDim));
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
  private vectorDim: number;

  constructor(dataDir: string, vectorDim = 1024) {
    this.dataDir = dataDir;
    this.vectorDim = vectorDim;
  }

  /**
   * Lazy-initialize connection and table.
   * Creates the fix_cache table if it does not exist.
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
      vector: new Array(this.vectorDim).fill(0),
      error_signature: '',
      skill_name: '',
      fix_plan: '',
      diagnosis: '',
      session_id: '',
      created_at: new Date().toISOString(),
      last_used: new Date().toISOString(),
      hit_count: 0,
      success_count: 0,
      fail_count: 0,
    };
  }

  private async ensureReady(): Promise<boolean> {
    try {
      await this.init();
      return this.table !== null;
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
      const results = await this.table!
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
      await this.table!.add([row]);
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
      await this.table!.delete(`skill_name = '${skillName}'`);
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
      await this.connection!.dropTable(TABLE_NAME);
      const seedRow = this._makeSeedRow();
      this.table = await this.connection!.createTable(TABLE_NAME, [seedRow]);
      await this.table.delete(`id = '${seedRow.id}'`);
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
      const results = await this.table!.query().toArray();
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
      const results = await this.table!.query()
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

      await this.table!.update({ valuesSql, where: `id = '${id}'` });
      return true;
    } catch (err) {
      console.error('CacheStore updateStats failed:', err);
      return false;
    }
  }
}
