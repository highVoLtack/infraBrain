/**
 * Skill file hashing and stale cache entry purge.
 * On startup, compares current skill file hashes against stored hashes.
 * Purges cache entries for skills whose files have changed.
 * All operations gracefully degrade (never throw).
 */

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { CacheStore } from './lance-store.js';

const DEV_MODE = process.env.NODE_ENV !== 'production';

/**
 * Hash all .md files in a skills directory.
 * Returns a Map of filename -> SHA-256 hex digest.
 */
export function hashSkillFiles(skillsDir: string): Map<string, string> {
  const hashes = new Map<string, string>();

  try {
    if (!existsSync(skillsDir)) return hashes;

    const files = readdirSync(skillsDir).filter(f => f.endsWith('.md'));
    for (const file of files) {
      const content = readFileSync(join(skillsDir, file), 'utf-8');
      const hash = createHash('sha256').update(content).digest('hex');
      hashes.set(file, hash);
    }
  } catch (err) {
    if (DEV_MODE) console.error('[CACHE] hashSkillFiles failed:', err);
  }

  return hashes;
}

/**
 * Compare current skill file hashes against stored hashes.
 * Purge cache entries for skills whose files have changed.
 * Write updated hashes to disk for next comparison.
 *
 * @param store - CacheStore instance (null = graceful skip)
 * @param skillsDir - Path to skills directory
 * @param storedHashesPath - Path to JSON file storing previous hashes
 */
export async function runStartupInvalidation(
  store: CacheStore | null,
  skillsDir: string,
  storedHashesPath: string,
): Promise<void> {
  try {
    if (!store) return;

    const currentHashes = hashSkillFiles(skillsDir);

    // Read stored hashes from previous run
    let storedHashes: Record<string, string> = {};
    if (existsSync(storedHashesPath)) {
      const raw = readFileSync(storedHashesPath, 'utf-8');
      storedHashes = JSON.parse(raw);
    }

    // Compare: only purge skills that existed before AND have changed
    const purgedSkills: string[] = [];
    for (const [filename, currentHash] of currentHashes) {
      const previousHash = storedHashes[filename];
      // Only purge if the file existed before (has a stored hash) and has changed
      if (previousHash && previousHash !== currentHash) {
        const skillName = filename.replace(/\.md$/, '');
        await store.deleteBySkill(skillName);
        purgedSkills.push(skillName);
      }
    }

    if (DEV_MODE && purgedSkills.length > 0) {
      console.log(`[CACHE] Purged cache entries for modified skills: ${purgedSkills.join(', ')}`);
    }

    // Write current hashes for next comparison
    const hashesDir = dirname(storedHashesPath);
    if (!existsSync(hashesDir)) {
      mkdirSync(hashesDir, { recursive: true });
    }
    const hashObj: Record<string, string> = {};
    for (const [k, v] of currentHashes) {
      hashObj[k] = v;
    }
    writeFileSync(storedHashesPath, JSON.stringify(hashObj, null, 2));
  } catch (err) {
    if (DEV_MODE) console.error('[CACHE] runStartupInvalidation failed:', err);
    // Graceful degradation: never throw
  }
}
