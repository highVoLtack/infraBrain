import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createInferenceScheduler } from '../../src/orchestrator/inference-scheduler.js';
import type { InferenceScheduler } from '../../src/orchestrator/inference-scheduler.js';
import type { InferenceTask, InferenceResult, BackendStatus } from '../../src/orchestrator/inference-types.js';
import type { InfraBrainConfig } from '../../src/config/types.js';
import type { ModelRegistry } from '../../src/llm/types.js';
import type { ModelRole } from '../../src/config/types.js';

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function makeConfig(overrides: Partial<InfraBrainConfig> = {}): InfraBrainConfig {
  return {
    defaultBaseUrl: 'http://localhost:11434/v1',
    modelName: 'infrabrain',
    modelMap: {
      default: 'infrabrain',
      strategic: 'llama3.3:70b',
      forensic: 'deepseek-r1:32b',
      worker: 'qwen2.5-coder:7b',
      vision: 'llama3.2-vision',
      triage: 'infrabrain',
      embedding: 'bge-m3',
    },
    apiPort: 3000,
    sessionDir: '.infrabrain',
    skillsDir: 'skills',
    tokenBudgets: { diagnosis: 4096, command: 2048 },
    circuitBreaker: { maxRetries: 3, retryDelayMs: 1000 },
    damageBudget: { maxPoints: 10 },
    resumeWindowMs: 86400000,
    locks: { staleTimeoutMs: 3600000 },
    execution: { commandTimeoutMs: 30000, maxBufferBytes: 1024 * 1024 },
    selfHealing: { maxAttempts: 5, correctionTimeoutMs: 15000, restartVerificationDelayMs: 3000 },
    contextWindow: 32768,
    cache: {
      enabled: true,
      similarityThreshold: 0.85,
      softZoneFloor: 0.75,
      dataDir: '.infrabrain/cache',
      confidenceWeights: { w_sim: 0.5, w_rec: 0.3, w_suc: 0.2, decayLambda: 0.1 },
    },
    memory: {
      enabled: true,
      dataDir: '.infrabrain/memory',
      decayLambda: 0.02,
      l2SimilarityThreshold: 0.7,
      l2Limit: 3,
      tokenBudgets: { l0: 100, l1: 500, l2l3: 1000 },
    },
    ...overrides,
  };
}

function makeRegistry(roles: Array<{ role: ModelRole; modelId: string }>): ModelRegistry {
  return {
    get(role: ModelRole) {
      const entry = roles.find(r => r.role === role);
      if (!entry) throw new Error(`No model for role: ${role}`);
      return { modelId: entry.modelId } as any;
    },
    getDefault() {
      return { modelId: roles.find(r => r.role === 'default')?.modelId ?? 'infrabrain' } as any;
    },
    entries() {
      return roles;
    },
  };
}

/** Config with two distinct backends (parallel mode) */
function makeMultiBackendConfig(): InfraBrainConfig {
  return makeConfig({
    defaultBaseUrl: 'http://localhost:8001/v1',
    modelMap: {
      default: 'qwen3.5:9b',
      triage: { model: 'qwen3.5:9b', baseUrl: 'http://localhost:8001/v1' },
      worker: { model: 'qwen3.5:9b', baseUrl: 'http://localhost:8001/v1' },
      strategic: { model: 'qwen3.5:122b-a10b', baseUrl: 'http://localhost:8000/v1' },
      forensic: { model: 'qwen3.5:122b-a10b', baseUrl: 'http://localhost:8000/v1' },
      vision: 'llama3.2-vision',
      embedding: 'bge-m3',
    },
  });
}

function makeDefaultRegistry(): ModelRegistry {
  return makeRegistry([
    { role: 'default', modelId: 'qwen3.5:9b' },
    { role: 'triage', modelId: 'qwen3.5:9b' },
    { role: 'worker', modelId: 'qwen3.5:9b' },
    { role: 'strategic', modelId: 'qwen3.5:122b-a10b' },
    { role: 'forensic', modelId: 'qwen3.5:122b-a10b' },
    { role: 'vision', modelId: 'llama3.2-vision' },
    { role: 'embedding', modelId: 'bge-m3' },
  ]);
}

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

describe('InferenceScheduler', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  /* ---- probeBackends -------------------------------------------- */

  describe('probeBackends', () => {
    it('returns BackendStatus[] with available/unavailable backends', async () => {
      const config = makeMultiBackendConfig();
      const registry = makeDefaultRegistry();

      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        if (typeof url === 'string' && url.includes('localhost:8001')) {
          return Promise.resolve({
            json: () => Promise.resolve({ data: [{ id: 'qwen3.5:9b' }] }),
          });
        }
        return Promise.reject(new Error('ECONNREFUSED'));
      }) as any;

      const scheduler = createInferenceScheduler(config, registry);
      const results = await scheduler.probeBackends();

      expect(results).toHaveLength(2);

      const available = results.find((b: BackendStatus) => b.available);
      const unavailable = results.find((b: BackendStatus) => !b.available);
      expect(available).toBeDefined();
      expect(available!.baseUrl).toBe('http://localhost:8001/v1');
      expect(available!.models).toContain('qwen3.5:9b');
      expect(available!.responseTimeMs).toBeGreaterThanOrEqual(0);
      expect(unavailable).toBeDefined();
      expect(unavailable!.baseUrl).toBe('http://localhost:8000/v1');
    });

    it('probes all backends in parallel (not sequential) -- timing check', async () => {
      const config = makeMultiBackendConfig();
      const registry = makeDefaultRegistry();

      const callTimestamps: number[] = [];

      globalThis.fetch = vi.fn().mockImplementation(async (_url: string) => {
        callTimestamps.push(Date.now());
        // Small delay to simulate network
        await new Promise(r => setTimeout(r, 50));
        return {
          json: () => Promise.resolve({ data: [{ id: 'test-model' }] }),
        };
      }) as any;

      const scheduler = createInferenceScheduler(config, registry);
      await scheduler.probeBackends();

      // All fetches should have been initiated within a very small time window
      // (parallel), not spaced 50ms+ apart (sequential)
      expect(callTimestamps.length).toBeGreaterThanOrEqual(2);
      const maxGap = Math.max(...callTimestamps) - Math.min(...callTimestamps);
      // If sequential, gap would be >= 50ms. Parallel should be < 20ms.
      expect(maxGap).toBeLessThan(30);
    });

    it('caches results for TTL duration, re-probes after TTL expires', async () => {
      const config = makeMultiBackendConfig();
      const registry = makeDefaultRegistry();

      const mockFetch = vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ data: [{ id: 'test-model' }] }),
      });
      globalThis.fetch = mockFetch as any;

      const scheduler = createInferenceScheduler(config, registry, {
        probeTTLMs: 100, // 100ms TTL for testing
      });

      // First probe
      await scheduler.probeBackends();
      const callCountAfterFirst = mockFetch.mock.calls.length;

      // Second probe immediately -- should use cache
      await scheduler.probeBackends();
      expect(mockFetch.mock.calls.length).toBe(callCountAfterFirst);

      // Wait for TTL to expire
      await new Promise(r => setTimeout(r, 120));

      // Third probe -- should re-probe
      await scheduler.probeBackends();
      expect(mockFetch.mock.calls.length).toBeGreaterThan(callCountAfterFirst);
    });
  });

  /* ---- getMode -------------------------------------------------- */

  describe('getMode', () => {
    it('returns "parallel" when 2+ distinct backend URLs are available', async () => {
      const config = makeMultiBackendConfig();
      const registry = makeDefaultRegistry();

      // Both backends available
      globalThis.fetch = vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ data: [{ id: 'test-model' }] }),
      }) as any;

      const scheduler = createInferenceScheduler(config, registry);
      await scheduler.probeBackends();

      expect(scheduler.getMode()).toBe('parallel');
    });

    it('returns "sequential" when only 1 backend URL is available', async () => {
      const config = makeMultiBackendConfig();
      const registry = makeDefaultRegistry();

      // Only 8001 is available
      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        if (typeof url === 'string' && url.includes('localhost:8001')) {
          return Promise.resolve({
            json: () => Promise.resolve({ data: [{ id: 'test-model' }] }),
          });
        }
        return Promise.reject(new Error('ECONNREFUSED'));
      }) as any;

      const scheduler = createInferenceScheduler(config, registry);
      await scheduler.probeBackends();

      expect(scheduler.getMode()).toBe('sequential');
    });

    it('returns "sequential" when all backends share the same URL', async () => {
      // Single backend config -- all roles use defaultBaseUrl
      const config = makeConfig();
      const registry = makeDefaultRegistry();

      globalThis.fetch = vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ data: [{ id: 'test-model' }] }),
      }) as any;

      const scheduler = createInferenceScheduler(config, registry);
      await scheduler.probeBackends();

      expect(scheduler.getMode()).toBe('sequential');
    });

    it('returns "sequential" before probeBackends has been called', () => {
      const config = makeMultiBackendConfig();
      const registry = makeDefaultRegistry();
      const scheduler = createInferenceScheduler(config, registry);

      // No probe yet -- default to sequential
      expect(scheduler.getMode()).toBe('sequential');
    });
  });

  /* ---- isAvailable ---------------------------------------------- */

  describe('isAvailable', () => {
    it('returns true for roles whose backend is connected', async () => {
      const config = makeMultiBackendConfig();
      const registry = makeDefaultRegistry();

      // Both backends available
      globalThis.fetch = vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ data: [{ id: 'test-model' }] }),
      }) as any;

      const scheduler = createInferenceScheduler(config, registry);
      await scheduler.probeBackends();

      expect(scheduler.isAvailable('worker')).toBe(true);
      expect(scheduler.isAvailable('strategic')).toBe(true);
    });

    it('returns false for roles whose backend is disconnected', async () => {
      const config = makeMultiBackendConfig();
      const registry = makeDefaultRegistry();

      // Only 8001 available, 8000 is down
      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        if (typeof url === 'string' && url.includes('localhost:8001')) {
          return Promise.resolve({
            json: () => Promise.resolve({ data: [{ id: 'test-model' }] }),
          });
        }
        return Promise.reject(new Error('ECONNREFUSED'));
      }) as any;

      const scheduler = createInferenceScheduler(config, registry);
      await scheduler.probeBackends();

      expect(scheduler.isAvailable('worker')).toBe(true);   // 8001 is up
      expect(scheduler.isAvailable('strategic')).toBe(false); // 8000 is down
    });

    it('returns false when no probe has been performed', () => {
      const config = makeMultiBackendConfig();
      const registry = makeDefaultRegistry();
      const scheduler = createInferenceScheduler(config, registry);

      expect(scheduler.isAvailable('worker')).toBe(false);
    });
  });

  /* ---- runParallel ---------------------------------------------- */

  describe('runParallel', () => {
    it('dispatches N tasks via Promise.allSettled and returns all results', async () => {
      const config = makeMultiBackendConfig();
      const registry = makeDefaultRegistry();

      globalThis.fetch = vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ data: [{ id: 'test-model' }] }),
      }) as any;

      const scheduler = createInferenceScheduler(config, registry);
      await scheduler.probeBackends();

      const tasks: InferenceTask<string>[] = [
        { label: '9B-noise-filter', role: 'worker', execute: () => Promise.resolve('filtered') },
        { label: '122B-diagnosis', role: 'strategic', execute: () => Promise.resolve('diagnosed') },
        { label: '9B-intent', role: 'triage', execute: () => Promise.resolve('classified') },
      ];

      const results = await scheduler.runParallel(tasks);

      expect(results).toHaveLength(3);
      expect(results.every((r: InferenceResult<string>) => r.status === 'fulfilled')).toBe(true);
      expect(results.map((r: InferenceResult<string>) => r.label)).toEqual([
        '9B-noise-filter',
        '122B-diagnosis',
        '9B-intent',
      ]);
      expect(results[0].value).toBe('filtered');
      expect(results[1].value).toBe('diagnosed');
      expect(results[2].value).toBe('classified');
    });

    it('returns fulfilled results for successful tasks and rejected for failed ones', async () => {
      const config = makeMultiBackendConfig();
      const registry = makeDefaultRegistry();

      globalThis.fetch = vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ data: [{ id: 'test-model' }] }),
      }) as any;

      const scheduler = createInferenceScheduler(config, registry);
      await scheduler.probeBackends();

      const tasks: InferenceTask<string>[] = [
        { label: '9B-noise-filter', role: 'worker', execute: () => Promise.resolve('ok') },
        { label: '122B-diagnosis', role: 'strategic', execute: () => Promise.reject(new Error('GPU OOM')) },
      ];

      const results = await scheduler.runParallel(tasks);

      expect(results).toHaveLength(2);
      expect(results[0].status).toBe('fulfilled');
      expect(results[0].value).toBe('ok');
      expect(results[1].status).toBe('rejected');
      expect(results[1].reason).toContain('GPU OOM');
      expect(results[1].value).toBeUndefined();
    });

    it('timing logs show overlapping execution in DEV_MODE', async () => {
      const config = makeMultiBackendConfig();
      const registry = makeDefaultRegistry();

      globalThis.fetch = vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ data: [{ id: 'test-model' }] }),
      }) as any;

      const scheduler = createInferenceScheduler(config, registry);
      await scheduler.probeBackends();

      // Task A: 50ms, Task B: 100ms -- they should overlap
      const tasks: InferenceTask<string>[] = [
        {
          label: '9B-fast',
          role: 'worker',
          execute: () => new Promise(r => setTimeout(() => r('fast'), 50)),
        },
        {
          label: '122B-slow',
          role: 'strategic',
          execute: () => new Promise(r => setTimeout(() => r('slow'), 100)),
        },
      ];

      const results = await scheduler.runParallel(tasks);

      // Both should have timing info
      for (const r of results) {
        expect(r.startMs).toBeGreaterThanOrEqual(0);
        expect(r.endMs).toBeGreaterThan(r.startMs);
        expect(r.durationMs).toBeGreaterThan(0);
        expect(r.durationMs).toBe(r.endMs - r.startMs);
      }

      // Overlapping: both started before the first one finished
      // The difference in start times should be very small (< 20ms)
      const startDiff = Math.abs(results[0].startMs - results[1].startMs);
      expect(startDiff).toBeLessThan(20);

      // Total wall-clock time should be close to the slower task (100ms), not sum (150ms)
      const totalWallClock = Math.max(results[0].endMs, results[1].endMs) -
                             Math.min(results[0].startMs, results[1].startMs);
      const totalSequential = results[0].durationMs + results[1].durationMs;
      expect(totalWallClock).toBeLessThan(totalSequential);
    });

    it('records timing even for rejected tasks', async () => {
      const config = makeMultiBackendConfig();
      const registry = makeDefaultRegistry();

      globalThis.fetch = vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ data: [{ id: 'test-model' }] }),
      }) as any;

      const scheduler = createInferenceScheduler(config, registry);
      await scheduler.probeBackends();

      const tasks: InferenceTask<string>[] = [
        {
          label: 'will-fail',
          role: 'worker',
          execute: () => new Promise((_, reject) => setTimeout(() => reject(new Error('boom')), 30)),
        },
      ];

      const results = await scheduler.runParallel(tasks);

      expect(results[0].status).toBe('rejected');
      expect(results[0].durationMs).toBeGreaterThanOrEqual(20);
      expect(results[0].startMs).toBeGreaterThanOrEqual(0);
      expect(results[0].endMs).toBeGreaterThan(results[0].startMs);
    });
  });

  /* ---- sequential fallback -------------------------------------- */

  describe('sequential fallback', () => {
    it('when getMode returns "sequential", runParallel still works for individual tasks', async () => {
      // Single backend config
      const config = makeConfig();
      const registry = makeDefaultRegistry();

      globalThis.fetch = vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ data: [{ id: 'test-model' }] }),
      }) as any;

      const scheduler = createInferenceScheduler(config, registry);
      await scheduler.probeBackends();

      expect(scheduler.getMode()).toBe('sequential');

      const tasks: InferenceTask<string>[] = [
        { label: 'single-task', role: 'worker', execute: () => Promise.resolve('done') },
      ];

      const results = await scheduler.runParallel(tasks);

      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('fulfilled');
      expect(results[0].value).toBe('done');
    });

    it('multiple tasks still complete in sequential mode (all on same backend)', async () => {
      const config = makeConfig();
      const registry = makeDefaultRegistry();

      globalThis.fetch = vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ data: [{ id: 'test-model' }] }),
      }) as any;

      const scheduler = createInferenceScheduler(config, registry);
      await scheduler.probeBackends();

      expect(scheduler.getMode()).toBe('sequential');

      const executionOrder: string[] = [];

      const tasks: InferenceTask<string>[] = [
        {
          label: 'task-a',
          role: 'worker',
          execute: async () => { executionOrder.push('a'); return 'a-done'; },
        },
        {
          label: 'task-b',
          role: 'strategic',
          execute: async () => { executionOrder.push('b'); return 'b-done'; },
        },
      ];

      const results = await scheduler.runParallel(tasks);

      expect(results).toHaveLength(2);
      expect(results[0].status).toBe('fulfilled');
      expect(results[1].status).toBe('fulfilled');
    });
  });

  /* ---- DEV_MODE logging ----------------------------------------- */

  describe('DEV_MODE timing logs', () => {
    it('logs timing information in non-production environment', async () => {
      const config = makeMultiBackendConfig();
      const registry = makeDefaultRegistry();

      globalThis.fetch = vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ data: [{ id: 'test-model' }] }),
      }) as any;

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const scheduler = createInferenceScheduler(config, registry);
      await scheduler.probeBackends();

      const tasks: InferenceTask<string>[] = [
        {
          label: '9B-noise-filter',
          role: 'worker',
          execute: () => new Promise(r => setTimeout(() => r('ok'), 30)),
        },
        {
          label: '122B-diagnosis',
          role: 'strategic',
          execute: () => new Promise(r => setTimeout(() => r('ok'), 60)),
        },
      ];

      await scheduler.runParallel(tasks);

      const loggedMessages = consoleSpy.mock.calls.map(c => c[0]).filter(m => typeof m === 'string');
      const inferenceLogLines = loggedMessages.filter((m: string) => m.includes('[INFERENCE]'));

      // Should have logged mode, started, completed, and total lines
      expect(inferenceLogLines.some((m: string) => m.includes('Mode:'))).toBe(true);
      expect(inferenceLogLines.some((m: string) => m.includes('started at'))).toBe(true);
      expect(inferenceLogLines.some((m: string) => m.includes('completed at'))).toBe(true);
      expect(inferenceLogLines.some((m: string) => m.includes('Total:'))).toBe(true);

      consoleSpy.mockRestore();
    });
  });
});
