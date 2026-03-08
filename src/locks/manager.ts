import * as fs from 'node:fs';
import * as path from 'node:path';
import type * as readline from 'node:readline/promises';
import chalk from 'chalk';
import type { LockFile, LockResult, LockStatus } from './types.js';

/**
 * Acquire a lock on a target. Uses writeFileSync with { flag: 'wx' }
 * for atomic create to prevent race conditions.
 */
export function acquireLock(
  target: string,
  lockDir: string,
  meta: {
    sessionId: string;
    adminName: string;
    pid: number;
    planSummary: string;
  },
  staleTimeoutMs: number,
): LockResult {
  // Ensure lock directory exists
  fs.mkdirSync(lockDir, { recursive: true });

  const lockPath = path.join(lockDir, `${target}.lock`);
  const lockData: LockFile = {
    target,
    sessionId: meta.sessionId,
    adminName: meta.adminName,
    createdAt: new Date().toISOString(),
    pid: meta.pid,
    planSummary: meta.planSummary,
  };

  try {
    fs.writeFileSync(lockPath, JSON.stringify(lockData, null, 2), {
      flag: 'wx',
    });
    return { status: 'acquired' };
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw err;
    }

    // Lock file already exists -- read it and check staleness
    const existingData = fs.readFileSync(lockPath, 'utf-8');
    const existing: LockFile = JSON.parse(existingData);
    const lockAge = Date.now() - new Date(existing.createdAt).getTime();

    if (lockAge > staleTimeoutMs) {
      return { status: 'stale', existing };
    }

    return { status: 'locked', existing };
  }
}

/**
 * Release a lock on a target. Idempotent -- no error if lock does not exist.
 */
export function releaseLock(target: string, lockDir: string): void {
  const lockPath = path.join(lockDir, `${target}.lock`);
  try {
    fs.unlinkSync(lockPath);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw err;
    }
    // Lock didn't exist -- that's fine (idempotent)
  }
}

/**
 * Check if a lock exists for a target. Returns the lock data or null.
 */
export function checkLock(target: string, lockDir: string): LockStatus {
  const lockPath = path.join(lockDir, `${target}.lock`);
  try {
    const data = fs.readFileSync(lockPath, 'utf-8');
    return JSON.parse(data) as LockFile;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw err;
  }
}

/**
 * Format a human-readable lock conflict message.
 * Includes target, session ID, admin name, and relative time.
 */
export function formatLockConflict(lock: LockFile): string {
  const ageMs = Date.now() - new Date(lock.createdAt).getTime();
  const timeAgo = formatRelativeTime(ageMs);

  return chalk.yellow(
    `Target '${lock.target}' is locked by session ${lock.sessionId} (started ${timeAgo}). Admin: ${lock.adminName}`,
  );
}

/**
 * Prompt the admin to force-override a lock by typing the exact target name.
 * Returns true only if the typed input matches the target exactly.
 */
export async function promptLockOverride(
  lock: LockFile,
  rl: readline.Interface,
): Promise<boolean> {
  console.log(formatLockConflict(lock));
  const answer = await rl.question(
    chalk.red(
      `Type '${lock.target}' to force-override or press Enter to cancel: `,
    ),
  );
  return answer === lock.target;
}

/**
 * Format milliseconds as a relative time string.
 */
function formatRelativeTime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds} seconds ago`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;

  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}
