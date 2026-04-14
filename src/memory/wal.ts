/**
 * Write-Ahead Log (WAL) for MemPalace memory mutations (MEM-09).
 *
 * Every memory mutation is recorded in a WAL entry BEFORE the mutation executes.
 * Entries are append-only JSONL with automatic rotation by size (10MB threshold).
 *
 * Follows the same patterns as AuditLogger (JSONL append-only) and CacheStore
 * (singleton per directory, graceful degradation).
 */

import { appendFileSync, readFileSync, renameSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { WALEntry } from './types.js';

const WAL_FILENAME = 'memory.wal.jsonl';
const WAL_ROTATED_FILENAME = 'memory.wal.1.jsonl';
const MAX_WAL_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

/** Singleton cache keyed by directory path. */
const walCache = new Map<string, MemoryWAL>();

/**
 * Append-only JSONL write-ahead log with rotation.
 * All operations gracefully degrade — never throw.
 */
export class MemoryWAL {
  private readonly dir: string;
  private readonly walPath: string;
  private readonly rotatedPath: string;

  constructor(dir: string) {
    this.dir = dir;
    this.walPath = join(dir, WAL_FILENAME);
    this.rotatedPath = join(dir, WAL_ROTATED_FILENAME);
  }

  /**
   * Append a WAL entry. Synchronous to guarantee write before mutation.
   * Returns true on success, false on failure (never throws).
   */
  append(entry: WALEntry): boolean {
    try {
      // Ensure directory exists
      mkdirSync(this.dir, { recursive: true });

      // Check if rotation is needed before writing
      this.rotateIfNeeded();

      const line = JSON.stringify(entry) + '\n';
      appendFileSync(this.walPath, line, 'utf-8');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Read all WAL entries from the current file.
   * Skips corrupted lines gracefully.
   * Returns empty array on failure (never throws).
   */
  read(): WALEntry[] {
    try {
      const content = readFileSync(this.walPath, 'utf-8');
      const lines = content.split('\n').filter((line) => line.trim().length > 0);
      const entries: WALEntry[] = [];

      for (const line of lines) {
        try {
          const parsed = JSON.parse(line) as WALEntry;
          entries.push(parsed);
        } catch {
          // Skip corrupted lines — graceful degradation
        }
      }

      return entries;
    } catch {
      // File does not exist or is unreadable
      return [];
    }
  }

  /**
   * Rotate WAL file if it exceeds the size threshold.
   * Renames current file to .wal.1.jsonl and starts fresh.
   */
  private rotateIfNeeded(): void {
    try {
      const stats = statSync(this.walPath);
      if (stats.size >= MAX_WAL_SIZE_BYTES) {
        renameSync(this.walPath, this.rotatedPath);
      }
    } catch {
      // File doesn't exist yet or stat failed — no rotation needed
    }
  }
}

/**
 * Get a singleton MemoryWAL instance for a directory.
 * Same pattern as getCacheStore() — keyed by directory path.
 */
export function getMemoryWAL(dir: string): MemoryWAL {
  const existing = walCache.get(dir);
  if (existing) return existing;

  const wal = new MemoryWAL(dir);
  walCache.set(dir, wal);
  return wal;
}

/**
 * Clear the singleton cache. Used in tests for isolation.
 */
export function clearWALCache(): void {
  walCache.clear();
}
