import type { InfraBrainConfig, ModelRole } from '../config/types.js';
import type { ModelRegistry } from '../llm/types.js';
import type {
  BackendStatus,
  InferenceTask,
  InferenceResult,
  InferenceMode,
  SchedulerConfig,
} from './inference-types.js';
import { extractUniqueBackendUrls } from '../api/routes/health.js';

const DEV_MODE = process.env.NODE_ENV !== 'production';

const DEFAULT_CONFIG: SchedulerConfig = {
  probeTTLMs: 30_000,
  probeTimeoutMs: 3_000,
};

/**
 * Public interface for the InferenceScheduler.
 * Returned by createInferenceScheduler factory.
 */
export interface InferenceScheduler {
  /** Probe all configured backends, cache results for TTL duration */
  probeBackends(): Promise<BackendStatus[]>;
  /** Check if a specific role's backend is available */
  isAvailable(role: ModelRole): boolean;
  /** Get execution mode based on available backends */
  getMode(): InferenceMode;
  /** Run multiple inference tasks concurrently via Promise.allSettled */
  runParallel<T>(tasks: InferenceTask<T>[]): Promise<InferenceResult<T>[]>;
}

/**
 * Create an InferenceScheduler that probes backend availability and dispatches
 * concurrent model calls via Promise.allSettled.
 *
 * Design: plain object factory (not a class) -- matches createModelRegistry pattern.
 * The scheduler does NOT own model calls -- it wraps arbitrary () => Promise<T> functions.
 */
export function createInferenceScheduler(
  config: InfraBrainConfig,
  _registry: ModelRegistry,
  opts?: Partial<SchedulerConfig>,
): InferenceScheduler {
  const schedulerConfig: SchedulerConfig = { ...DEFAULT_CONFIG, ...opts };

  // Internal probe cache
  let cachedProbe: { results: BackendStatus[]; timestamp: number } | null = null;

  /**
   * Resolve which backend URL a given role maps to.
   * String entries in modelMap use defaultBaseUrl; object entries use their own baseUrl.
   */
  function resolveBaseUrl(role: ModelRole): string {
    const entry = config.modelMap[role];
    if (typeof entry === 'object' && entry.baseUrl) {
      return entry.baseUrl;
    }
    return config.defaultBaseUrl;
  }

  /**
   * Probe all configured backends via their /models endpoint.
   * Uses the same pattern as health.ts -- fetch with AbortController timeout.
   * Results are cached with configurable TTL.
   */
  async function probeBackends(): Promise<BackendStatus[]> {
    const now = Date.now();

    // Return cached results if still fresh
    if (cachedProbe && (now - cachedProbe.timestamp) < schedulerConfig.probeTTLMs) {
      return cachedProbe.results;
    }

    const backendUrls = extractUniqueBackendUrls(config);

    // Probe all backends in parallel (Promise.all, not sequential)
    const results: BackendStatus[] = await Promise.all(
      backendUrls.map(async (baseUrl): Promise<BackendStatus> => {
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), schedulerConfig.probeTimeoutMs);
          const start = Date.now();

          const response = await fetch(`${baseUrl}/models`, {
            signal: controller.signal,
          });
          const elapsed = Date.now() - start;
          clearTimeout(timeout);

          const data = await response.json() as { data: Array<{ id: string }> };
          const models = (data.data ?? []).map((m) => m.id);

          return {
            baseUrl,
            available: true,
            models,
            responseTimeMs: elapsed,
          };
        } catch {
          return {
            baseUrl,
            available: false,
            models: [],
            responseTimeMs: 0,
          };
        }
      }),
    );

    // Cache the results
    cachedProbe = { results, timestamp: Date.now() };

    return results;
  }

  /**
   * Check if a specific role's backend is available.
   * Looks up the role's baseUrl from config.modelMap, checks if that URL
   * is in cached probe results as available.
   */
  function isAvailable(role: ModelRole): boolean {
    if (!cachedProbe) return false;
    const roleUrl = resolveBaseUrl(role);
    const backend = cachedProbe.results.find(b => b.baseUrl === roleUrl);
    return backend?.available === true;
  }

  /**
   * Get execution mode based on available backends.
   * Returns 'parallel' when 2+ distinct available backend URLs exist.
   * Returns 'sequential' when only 1 (or none) is available, or no probe has been performed.
   */
  function getMode(): InferenceMode {
    if (!cachedProbe) return 'sequential';
    const availableUrls = new Set(
      cachedProbe.results.filter(b => b.available).map(b => b.baseUrl),
    );
    return availableUrls.size >= 2 ? 'parallel' : 'sequential';
  }

  /**
   * Run multiple inference tasks concurrently via Promise.allSettled.
   * Each task.execute() is wrapped with timing instrumentation.
   * In DEV_MODE, logs overlapping execution windows.
   */
  async function runParallel<T>(tasks: InferenceTask<T>[]): Promise<InferenceResult<T>[]> {
    const baseTime = Date.now();
    const mode = getMode();

    if (DEV_MODE) {
      console.log(`[INFERENCE] Mode: ${mode}`);
    }

    // Wrap each task with timing instrumentation
    const timedTasks = tasks.map((task) => {
      const startMs = Date.now();
      const offsetMs = startMs - baseTime;

      if (DEV_MODE) {
        console.log(`[INFERENCE] ${task.label} started at +${offsetMs}ms`);
      }

      return task.execute().then(
        (value) => {
          const endMs = Date.now();
          const durationMs = endMs - startMs;
          if (DEV_MODE) {
            console.log(`[INFERENCE] ${task.label} completed at +${endMs - baseTime}ms (${durationMs}ms)`);
          }
          return {
            label: task.label,
            status: 'fulfilled' as const,
            value,
            startMs,
            endMs,
            durationMs,
          };
        },
        (err) => {
          const endMs = Date.now();
          const durationMs = endMs - startMs;
          if (DEV_MODE) {
            console.log(`[INFERENCE] ${task.label} failed at +${endMs - baseTime}ms (${durationMs}ms)`);
          }
          return {
            label: task.label,
            status: 'rejected' as const,
            reason: (err instanceof Error) ? err.message : String(err),
            startMs,
            endMs,
            durationMs,
          };
        },
      );
    });

    // Use Promise.allSettled pattern -- but since we already handle rejection in .then(),
    // all promises are guaranteed to resolve. We use Promise.all here because the timing
    // wrapper converts rejections into fulfilled InferenceResult objects.
    const results = await Promise.all(timedTasks);

    // Log timing summary in DEV_MODE
    if (DEV_MODE && results.length > 1) {
      const allStarts = results.map(r => r.startMs);
      const allEnds = results.map(r => r.endMs);
      const earliestStart = Math.min(...allStarts);
      const latestEnd = Math.max(...allEnds);
      const totalWallClock = latestEnd - earliestStart;
      const totalSequential = results.reduce((sum, r) => sum + r.durationMs, 0);
      const overlap = Math.max(0, totalSequential - totalWallClock);

      console.log(`[INFERENCE] Overlap: ${overlap}ms`);
      console.log(`[INFERENCE] Total: ${totalWallClock}ms (sequential would be: ${totalSequential}ms)`);
    }

    return results;
  }

  return {
    probeBackends,
    isAvailable,
    getMode,
    runParallel,
  };
}
