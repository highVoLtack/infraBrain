/**
 * Shared types for the context management module.
 * Used by token counter, noise filter, ground truth, compactor, and context manager.
 */

export interface Observation {
  id: string;
  content: string;
  tokens: number;
  timestamp: number;
  source: string;
  isNoise: boolean;
}

export interface PinnedFact {
  id: string;
  type: 'container' | 'port' | 'ip' | 'error_code' | 'custom';
  value: string;
  tokens: number;
  pinnedAt: number;
}

export interface ContextSection {
  groundTruth: PinnedFact[];
  observations: Observation[];
}

export interface ContextManagerConfig {
  windowSize: number;
  threshold: number;     // 0.83 -- trigger compaction at this percentage
  target: number;        // 0.60 -- compact down to this percentage
  groundTruthCap: number; // 0.20 -- max percentage for ground truth
}

export interface CompactionResult {
  removedObservations: number;
  tokensBefore: number;
  tokensAfter: number;
  tiersUsed: number;
  snapshotPath?: string;
}

export interface EvictionResult {
  remaining: Observation[];
  removed: Observation[];
  summary?: string;
}
