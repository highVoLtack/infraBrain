import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createHealthRoute, extractUniqueBackendUrls } from '../../src/api/routes/health.js';
import type { InfraBrainConfig } from '../../src/config/types.js';
import type { ModelRegistry } from '../../src/llm/types.js';
import type { ModelRole } from '../../src/config/types.js';

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

describe('Health Route', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('extracts unique backend URLs from config with mixed string and object entries', () => {
    const config = makeConfig({
      defaultBaseUrl: 'http://localhost:11434/v1',
      modelMap: {
        default: 'infrabrain',
        strategic: 'llama3.3:70b',
        forensic: { model: 'deepseek-r1:32b', baseUrl: 'http://localhost:8000/v1' },
        worker: 'qwen2.5-coder:7b',
        vision: 'llama3.2-vision',
        triage: { model: 'qwen3.5:9b', baseUrl: 'http://localhost:8001/v1' },
        embedding: 'bge-m3',
      },
    });

    const urls = extractUniqueBackendUrls(config);
    expect(urls).toHaveLength(3);
    expect(urls).toContain('http://localhost:11434/v1');
    expect(urls).toContain('http://localhost:8000/v1');
    expect(urls).toContain('http://localhost:8001/v1');
  });

  it('single backend connected — returns models list', async () => {
    const config = makeConfig();
    const app = express();
    app.use('/health', createHealthRoute(config));

    globalThis.fetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ data: [{ id: 'infrabrain' }, { id: 'llama3.3:70b' }] }),
    }) as any;

    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body.backends).toHaveLength(1);
    expect(res.body.backends[0].connected).toBe(true);
    expect(res.body.backends[0].models).toContain('infrabrain');
    expect(res.body.backends[0].models).toContain('llama3.3:70b');
    expect(res.body.summary).toBe('all_connected');
  });

  it('multiple backends mixed status — one up, one down', async () => {
    const config = makeConfig({
      modelMap: {
        default: 'infrabrain',
        strategic: 'llama3.3:70b',
        forensic: { model: 'deepseek-r1:32b', baseUrl: 'http://localhost:8000/v1' },
        worker: 'qwen2.5-coder:7b',
        vision: 'llama3.2-vision',
        triage: 'infrabrain',
        embedding: 'bge-m3',
      },
    });
    const app = express();
    app.use('/health', createHealthRoute(config));

    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('localhost:11434')) {
        return Promise.resolve({
          json: () => Promise.resolve({ data: [{ id: 'infrabrain' }] }),
        });
      }
      return Promise.reject(new Error('ECONNREFUSED'));
    }) as any;

    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body.backends).toHaveLength(2);

    const connected = res.body.backends.find((b: any) => b.connected);
    const disconnected = res.body.backends.find((b: any) => !b.connected);
    expect(connected).toBeDefined();
    expect(disconnected).toBeDefined();
    expect(disconnected.error).toContain('ECONNREFUSED');
    expect(res.body.summary).toBe('partial');
  });

  it('all backends down — all connected: false', async () => {
    const config = makeConfig();
    const app = express();
    app.use('/health', createHealthRoute(config));

    globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) as any;

    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body.backends).toHaveLength(1);
    expect(res.body.backends[0].connected).toBe(false);
    expect(res.body.summary).toBe('all_disconnected');
  });

  it('timeout — returns connected: false when backend takes too long', async () => {
    const config = makeConfig();
    const app = express();
    app.use('/health', createHealthRoute(config));

    // Mock fetch to simulate abort via AbortController
    globalThis.fetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        if (init?.signal) {
          init.signal.addEventListener('abort', () => {
            reject(new Error('The operation was aborted'));
          });
        }
        // Never resolve — let the 3s timeout fire
      });
    }) as any;

    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body.backends[0].connected).toBe(false);
    expect(res.body.backends[0].error).toBeDefined();
  }, 10000);

  it('registry model availability — checks per-role model against correct backend', async () => {
    const config = makeConfig({
      modelMap: {
        default: 'infrabrain',
        strategic: 'llama3.3:70b',
        forensic: { model: 'deepseek-r1:32b', baseUrl: 'http://localhost:8000/v1' },
        worker: 'qwen2.5-coder:7b',
        vision: 'llama3.2-vision',
        triage: 'infrabrain',
        embedding: 'bge-m3',
      },
    });

    const registry = makeRegistry([
      { role: 'default', modelId: 'infrabrain' },
      { role: 'strategic', modelId: 'llama3.3:70b' },
      { role: 'forensic', modelId: 'deepseek-r1:32b' },
      { role: 'worker', modelId: 'qwen2.5-coder:7b' },
      { role: 'vision', modelId: 'llama3.2-vision' },
      { role: 'triage', modelId: 'infrabrain' },
      { role: 'embedding', modelId: 'bge-m3' },
    ]);

    const app = express();
    app.use('/health', createHealthRoute(config, registry));

    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('localhost:11434')) {
        return Promise.resolve({
          json: () => Promise.resolve({ data: [{ id: 'infrabrain' }, { id: 'llama3.3:70b' }] }),
        });
      }
      // 8000 backend is down
      return Promise.reject(new Error('ECONNREFUSED'));
    }) as any;

    const res = await request(app).get('/health');

    expect(res.body.registry).toBeDefined();
    const forensicEntry = res.body.registry.find((r: any) => r.role === 'forensic');
    expect(forensicEntry.available).toBe(false); // backend is down
    const defaultEntry = res.body.registry.find((r: any) => r.role === 'default');
    expect(defaultEntry.available).toBe(true); // model exists on connected backend
  });

  it('deduplication — 5 roles on same baseUrl results in 1 backend probe', async () => {
    const config = makeConfig(); // All roles use defaultBaseUrl
    const app = express();
    app.use('/health', createHealthRoute(config));

    const mockFetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ data: [{ id: 'infrabrain' }] }),
    });
    globalThis.fetch = mockFetch as any;

    const res = await request(app).get('/health');

    expect(res.body.backends).toHaveLength(1);
    // fetch should be called exactly once (1 unique backend, not 7 times for 7 roles)
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  describe('multi-backend inference mode', () => {
    it('2 distinct baseUrls both connected -> inferenceMode: parallel', async () => {
      const config = makeConfig({
        modelMap: {
          default: 'infrabrain',
          strategic: 'llama3.3:70b',
          forensic: { model: 'deepseek-r1:32b', baseUrl: 'http://localhost:8000/v1' },
          worker: 'qwen2.5-coder:7b',
          vision: 'llama3.2-vision',
          triage: 'infrabrain',
          embedding: 'bge-m3',
        },
      });
      const app = express();
      app.use('/health', createHealthRoute(config));

      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        if (typeof url === 'string' && url.includes('localhost:11434')) {
          return Promise.resolve({
            json: () => Promise.resolve({ data: [{ id: 'infrabrain' }] }),
          });
        }
        if (typeof url === 'string' && url.includes('localhost:8000')) {
          return Promise.resolve({
            json: () => Promise.resolve({ data: [{ id: 'deepseek-r1:32b' }] }),
          });
        }
        return Promise.reject(new Error('ECONNREFUSED'));
      }) as any;

      const res = await request(app).get('/health');

      expect(res.status).toBe(200);
      expect(res.body.inferenceMode).toBe('parallel');
    });

    it('2 distinct baseUrls, only 1 connected -> inferenceMode: sequential', async () => {
      const config = makeConfig({
        modelMap: {
          default: 'infrabrain',
          strategic: 'llama3.3:70b',
          forensic: { model: 'deepseek-r1:32b', baseUrl: 'http://localhost:8000/v1' },
          worker: 'qwen2.5-coder:7b',
          vision: 'llama3.2-vision',
          triage: 'infrabrain',
          embedding: 'bge-m3',
        },
      });
      const app = express();
      app.use('/health', createHealthRoute(config));

      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        if (typeof url === 'string' && url.includes('localhost:11434')) {
          return Promise.resolve({
            json: () => Promise.resolve({ data: [{ id: 'infrabrain' }] }),
          });
        }
        return Promise.reject(new Error('ECONNREFUSED'));
      }) as any;

      const res = await request(app).get('/health');

      expect(res.status).toBe(200);
      expect(res.body.inferenceMode).toBe('sequential');
    });

    it('1 baseUrl (all roles same backend) -> inferenceMode: sequential', async () => {
      const config = makeConfig(); // All roles use defaultBaseUrl
      const app = express();
      app.use('/health', createHealthRoute(config));

      globalThis.fetch = vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ data: [{ id: 'infrabrain' }] }),
      }) as any;

      const res = await request(app).get('/health');

      expect(res.status).toBe(200);
      expect(res.body.inferenceMode).toBe('sequential');
    });

    it('0 backends connected -> inferenceMode: sequential', async () => {
      const config = makeConfig({
        modelMap: {
          default: 'infrabrain',
          strategic: 'llama3.3:70b',
          forensic: { model: 'deepseek-r1:32b', baseUrl: 'http://localhost:8000/v1' },
          worker: 'qwen2.5-coder:7b',
          vision: 'llama3.2-vision',
          triage: 'infrabrain',
          embedding: 'bge-m3',
        },
      });
      const app = express();
      app.use('/health', createHealthRoute(config));

      globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) as any;

      const res = await request(app).get('/health');

      expect(res.status).toBe(200);
      expect(res.body.inferenceMode).toBe('sequential');
    });
  });
});
