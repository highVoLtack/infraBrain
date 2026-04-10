/**
 * Pipeline-facing cache lookup with confidence scoring and result classification.
 * Returns fast-path/speculative/miss based on vector similarity thresholds.
 * All operations gracefully degrade on failure (never throw into pipeline).
 */

import type { CacheStore } from './lance-store.js';
import type { CacheConfig, CacheEntry, CacheHit, CacheResult, ConfidenceConfig } from './types.js';
import type { FixPlan } from '../orchestrator/types.js';
import { formatEmbeddingInput, generateEmbedding } from './embedder.js';
import { computeConfidence } from './confidence.js';

const DEV_MODE = process.env.NODE_ENV !== 'production';

export interface CheckCacheParams {
  prompt: string;
  filteredDiscovery: Record<string, string>;
  store: CacheStore | null;
  baseURL: string;
  modelId: string;
  cacheConfig: CacheConfig;
  confidenceConfig: ConfidenceConfig;
}

export interface StoreFixParams {
  prompt: string;
  filteredDiscovery: Record<string, string>;
  diagnosis: string;
  fixPlan: FixPlan;
  skillName: string;
  sessionId: string;
  store: CacheStore | null;
  baseURL: string;
  modelId: string;
}

/**
 * Check the fix cache for a matching entry.
 * Classifies results: fast-path (>=0.85), speculative (0.75-0.85), miss (<0.75).
 * Returns { type: 'miss' } on any failure (graceful degradation).
 */
export async function checkCache(params: CheckCacheParams): Promise<CacheResult> {
  const { prompt, filteredDiscovery, store, baseURL, modelId, cacheConfig, confidenceConfig } = params;
  const miss: CacheResult = { type: 'miss' };

  try {
    if (!store || !cacheConfig.enabled) return miss;

    const text = formatEmbeddingInput(prompt, filteredDiscovery);
    const embedding = await generateEmbedding(text, baseURL, modelId);
    if (!embedding) return miss;

    const results = await store.search(embedding, 1);
    if (!results || results.length === 0) return miss;

    const row = results[0];
    const distance = Number(row._distance);
    const similarity = 1 - distance;

    const entry: CacheEntry = {
      id: String(row.id),
      vector: (row.vector as number[]) ?? [],
      error_signature: String(row.error_signature),
      skill_name: String(row.skill_name),
      fix_plan: String(row.fix_plan),
      diagnosis: String(row.diagnosis),
      session_id: String(row.session_id),
      created_at: String(row.created_at),
      last_used: String(row.last_used),
      hit_count: Number(row.hit_count),
      success_count: Number(row.success_count),
      fail_count: Number(row.fail_count),
    };

    const totalUses = entry.hit_count;
    const confidence = computeConfidence(
      similarity,
      entry.last_used,
      entry.success_count,
      totalUses,
      confidenceConfig,
    );

    const hit: CacheHit = { similarity, confidence, entry };

    if (similarity >= cacheConfig.similarity_threshold) {
      // Fast-path: high confidence match
      await store.updateStats(entry.id, {
        hit_count: entry.hit_count + 1,
        last_used: new Date().toISOString(),
      });
      if (DEV_MODE) console.log(`[CACHE] Fast-path hit (similarity=${similarity.toFixed(3)}, confidence=${confidence.toFixed(3)})`);
      return { type: 'fast-path', hit };
    }

    if (similarity >= cacheConfig.soft_zone_floor) {
      // Speculative: soft zone match
      await store.updateStats(entry.id, {
        hit_count: entry.hit_count + 1,
        last_used: new Date().toISOString(),
      });
      if (DEV_MODE) console.log(`[CACHE] Speculative match (similarity=${similarity.toFixed(3)})`);
      return { type: 'speculative', hit };
    }

    return miss;
  } catch (err) {
    if (DEV_MODE) console.error('[CACHE] checkCache failed:', err);
    return miss;
  }
}

/**
 * Store a successful fix in the cache for future lookups.
 * All errors caught silently (cache write failure is not critical).
 */
export async function storeFixInCache(params: StoreFixParams): Promise<void> {
  const { prompt, filteredDiscovery, diagnosis, fixPlan, skillName, sessionId, store, baseURL, modelId } = params;

  try {
    if (!store) return;

    const text = formatEmbeddingInput(prompt, filteredDiscovery);
    const embedding = await generateEmbedding(text, baseURL, modelId);
    if (!embedding) return;

    const now = new Date().toISOString();
    await store.add(
      {
        error_signature: text,
        skill_name: skillName,
        fix_plan: JSON.stringify(fixPlan),
        diagnosis,
        session_id: sessionId,
        created_at: now,
        last_used: now,
        hit_count: 0,
        success_count: 0,
        fail_count: 0,
      },
      embedding,
    );
  } catch (err) {
    if (DEV_MODE) console.error('[CACHE] storeFixInCache failed:', err);
  }
}

/**
 * Record whether a cached fix succeeded or failed.
 * Updates success_count or fail_count and refreshes last_used timestamp.
 */
export async function recordFixOutcome(
  store: CacheStore | null,
  entryId: string,
  succeeded: boolean,
): Promise<void> {
  try {
    if (!store) return;

    const updates: Record<string, unknown> = {
      last_used: new Date().toISOString(),
    };

    if (succeeded) {
      updates.success_count = 1; // Will be incremented relative in a real scenario; for now set to signal intent
    } else {
      updates.fail_count = 1;
    }

    await store.updateStats(entryId, updates as any);
  } catch (err) {
    if (DEV_MODE) console.error('[CACHE] recordFixOutcome failed:', err);
  }
}
