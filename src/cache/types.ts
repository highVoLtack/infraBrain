/**
 * Cache subsystem type definitions.
 * Defines data contracts for the fix-caching layer (LanceDB vector store).
 */

/** A single cached fix entry stored in LanceDB. */
export interface CacheEntry {
  id: string;
  vector: number[];
  error_signature: string;
  skill_name: string;
  /** JSON-serialized FixPlan */
  fix_plan: string;
  diagnosis: string;
  session_id: string;
  created_at: string;
  last_used: string;
  hit_count: number;
  success_count: number;
  fail_count: number;
}

/** A cache search result with similarity and confidence scores. */
export interface CacheHit {
  similarity: number;
  confidence: number;
  entry: CacheEntry;
}

/** Discriminated union for cache lookup outcomes. */
export type CacheResult =
  | { type: 'fast-path'; hit: CacheHit }
  | { type: 'speculative'; hit: CacheHit }
  | { type: 'miss' };

/** Configuration for the cache subsystem. */
export interface CacheConfig {
  enabled: boolean;
  similarity_threshold: number;
  soft_zone_floor: number;
  data_dir: string;
}

/** Configuration for confidence scoring weights and decay. */
export interface ConfidenceConfig {
  w_sim: number;
  w_rec: number;
  w_suc: number;
  decayLambda: number;
}

/** Default cache configuration. */
export const DEFAULT_CACHE_CONFIG: CacheConfig = {
  enabled: true,
  similarity_threshold: 0.85,
  soft_zone_floor: 0.75,
  data_dir: '.infrabrain/cache',
};

/** Default confidence scoring configuration. */
export const DEFAULT_CONFIDENCE_CONFIG: ConfidenceConfig = {
  w_sim: 0.5,
  w_rec: 0.3,
  w_suc: 0.2,
  decayLambda: 0.1,
};
