import { Router } from 'express';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import type { WriteThrough } from '../../state/store.js';
import type { InfraBrainConfig } from '../../config/types.js';
import type { LockFile } from '../../locks/types.js';
import { getCacheStore } from '../../cache/lance-store.js';
import { getIncidentStore } from '../../memory/incident-store.js';
import { getEntityStore } from '../../memory/entity-store.js';
import { DEFAULT_CACHE_CONFIG } from '../../cache/types.js';

export interface StatusRouteDeps {
  store: WriteThrough;
  defaultBaseUrl: string;
  lockDir: string;
  config: InfraBrainConfig;
}

interface BackendHealth {
  connected: boolean;
  modelName?: string;
  responseTimeMs?: number;
  error?: string;
}

interface CacheSection {
  totalEntries: number;
  hitRate: number | null;
  avgConfidence: number | null;
}

interface MemorySection {
  incidentCount: number;
  entityCount: number;
  walSize: string;
  /** D-23: v2.0 Caveman placeholders -- always null in v1.3. */
  compressionRatio: number | null;
  totalTokensSaved: number | null;
  distilledEntriesCount: number | null;
}

/** Human-readable byte formatting for the WAL size field. */
function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/**
 * Create the /status route.
 * Returns backend health, active plans, recent sessions, active locks, and
 * (Phase 19.3 D-13) the live cache / memory / context / models dashboard
 * sections consumed by StatusOverlay's parseOverlayData.
 *
 * Every aggregated section degrades gracefully: a failing store yields
 * zeros/nulls, never an HTTP 500.
 */
export function createStatusRoute(deps: StatusRouteDeps): Router {
  const router = Router();

  router.get('/', async (_req, res) => {
    // Check backend health with 3-second timeout via OpenAI /v1/models
    let backend: BackendHealth;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      const start = Date.now();
      const response = await fetch(`${deps.defaultBaseUrl}/models`, {
        signal: controller.signal,
      });
      const elapsed = Date.now() - start;
      clearTimeout(timeout);

      const data = (await response.json()) as { data: Array<{ id: string }> };
      backend = {
        connected: true,
        modelName: data.data?.[0]?.id,
        responseTimeMs: elapsed,
      };
    } catch (err) {
      backend = {
        connected: false,
        error: (err as Error).message,
      };
    }

    // Get active sessions (incomplete within resume window)
    const activePlans = deps.store.getIncompleteSessions(deps.config.resumeWindowMs);

    // Get recent completed sessions
    const recentSessions = deps.store.getRecentSessions(3);

    // List active locks by reading lock directory
    const locks: LockFile[] = [];
    try {
      const files = fs.readdirSync(deps.lockDir);
      for (const file of files) {
        if (file.endsWith('.lock')) {
          try {
            const content = fs.readFileSync(path.join(deps.lockDir, file), 'utf-8');
            locks.push(JSON.parse(content) as LockFile);
          } catch {
            // Skip malformed lock files
          }
        }
      }
    } catch {
      // Lock directory doesn't exist or isn't readable -- that's fine
    }

    // --- Cache section (D-13) ---
    const cache: CacheSection = { totalEntries: 0, hitRate: null, avgConfidence: null };
    try {
      const cacheDir = deps.config.cache?.dataDir ?? DEFAULT_CACHE_CONFIG.data_dir;
      const cacheStore = getCacheStore(cacheDir);
      await cacheStore.init();
      const rows = await cacheStore.listAll();
      cache.totalEntries = rows.length;
      if (rows.length > 0) {
        let hitSum = 0;
        let succSum = 0;
        let confSum = 0;
        let confCount = 0;
        for (const r of rows) {
          hitSum += Number(r['hit_count'] ?? 0);
          succSum += Number(r['success_count'] ?? 0);
          const c = r['confidence'];
          if (typeof c === 'number') {
            confSum += c;
            confCount++;
          }
        }
        cache.hitRate = hitSum > 0 ? succSum / hitSum : 0;
        cache.avgConfidence = confCount > 0 ? confSum / confCount : null;
      }
    } catch { /* cache stats are non-critical */ }

    // --- Memory section (D-13 + D-23 v2.0 placeholders) ---
    const memory: MemorySection = {
      incidentCount: 0,
      entityCount: 0,
      walSize: '0 B',
      compressionRatio: null,
      totalTokensSaved: null,
      distilledEntriesCount: null,
    };
    try {
      const memDir = deps.config.memory?.dataDir ?? '.infrabrain/memory';

      const stats = await getIncidentStore(memDir).getStats();
      memory.incidentCount = stats?.totalIncidents ?? 0;

      const entities = await getEntityStore(memDir).listAll();
      memory.entityCount = entities.length;

      try {
        const walStat = await fsp.stat(path.join(memDir, 'memory.wal.jsonl'));
        memory.walSize = formatBytes(walStat.size);
      } catch { /* WAL file may not exist yet */ }
    } catch { /* memory stats are non-critical */ }

    // --- Context section (D-13) ---
    // currentTokens is best-effort in v1.3: the live per-session figure arrives
    // with the Plan 03 reducer, which owns the streaming token counts.
    const context = {
      currentTokens: 0,
      maxTokens: deps.config.contextWindow ?? 32768,
    };

    // --- Models section (D-13): role -> model id ---
    const models: Record<string, string> = {};
    try {
      for (const [role, entry] of Object.entries(deps.config.modelMap ?? {})) {
        models[role] = typeof entry === 'string' ? entry : entry.model;
      }
    } catch { /* modelMap shape surprise -- graceful default */ }

    res.json({
      backend,
      activePlans,
      recentSessions,
      locks,
      // Phase 19.3 D-13 dashboard sections
      cache: cache,
      memory: memory,
      context: context,
      models: models,
    });
  });

  return router;
}
