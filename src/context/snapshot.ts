/**
 * Pre-compaction snapshot writer.
 * Saves context state to disk before eviction begins, enabling rollback/auditing.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PinnedFact, Observation } from './types.js';

export interface SnapshotParams {
  sessionDir: string;
  sessionId: string;
  groundTruth: PinnedFact[];
  observations: Observation[];
  tokenCount: number;
  reason: string;
}

/**
 * Save a JSON snapshot of the current context state.
 * Creates the snapshots directory if it does not exist.
 * Returns the absolute path to the written snapshot file.
 */
export function saveSnapshot(params: SnapshotParams): string {
  const snapshotsDir = join(params.sessionDir, 'snapshots');
  mkdirSync(snapshotsDir, { recursive: true });

  const filename = `${params.sessionId}-${Date.now()}.json`;
  const filepath = join(snapshotsDir, filename);

  const payload = {
    sessionId: params.sessionId,
    timestamp: new Date().toISOString(),
    reason: params.reason,
    tokenCount: params.tokenCount,
    groundTruth: params.groundTruth,
    observations: params.observations,
  };

  writeFileSync(filepath, JSON.stringify(payload, null, 2), 'utf-8');
  return filepath;
}
