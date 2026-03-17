import { Router } from 'express';
import type { InfraBrainConfig } from '../../config/types.js';
import type { ModelRegistry } from '../../llm/types.js';

export interface BackendHealth {
  baseUrl: string;
  connected: boolean;
  models?: string[];
  responseTimeMs?: number;
  error?: string;
}

/**
 * Extract all unique backend base URLs from config.
 * String entries in modelMap use defaultBaseUrl; object entries use their own baseUrl.
 */
export function extractUniqueBackendUrls(config: InfraBrainConfig): string[] {
  const urls = new Set<string>();
  urls.add(config.defaultBaseUrl);

  for (const entry of Object.values(config.modelMap)) {
    if (typeof entry === 'object' && entry.baseUrl) {
      urls.add(entry.baseUrl);
    }
  }

  return Array.from(urls);
}

/**
 * Create the /health route.
 * Probes all unique backends via OpenAI /v1/models endpoint.
 * When a model registry is provided, verifies each registered model is available.
 */
export function createHealthRoute(config: InfraBrainConfig, registry?: ModelRegistry): Router {
  const router = Router();

  router.get('/', async (_req, res) => {
    const backendUrls = extractUniqueBackendUrls(config);

    const backends: BackendHealth[] = await Promise.all(
      backendUrls.map(async (baseUrl): Promise<BackendHealth> => {
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 3000);
          const start = Date.now();
          // baseUrl already includes /v1, so endpoint is /v1/models
          const response = await fetch(`${baseUrl}/models`, {
            signal: controller.signal,
          });
          const elapsed = Date.now() - start;
          clearTimeout(timeout);

          const data = await response.json() as { data: Array<{ id: string }> };
          const models = (data.data ?? []).map((m) => m.id);

          return {
            baseUrl,
            connected: true,
            models,
            responseTimeMs: elapsed,
          };
        } catch (err) {
          return {
            baseUrl,
            connected: false,
            error: (err as Error).message,
          };
        }
      }),
    );

    // Check registry models against available backends
    let registryStatus: Array<{ role: string; model: string; available: boolean }> | undefined;
    if (registry) {
      registryStatus = registry.entries().map(({ role, modelId }) => {
        // Determine which backend this role maps to
        const entry = config.modelMap[role];
        const roleBaseUrl = (typeof entry === 'object' && entry.baseUrl)
          ? entry.baseUrl
          : config.defaultBaseUrl;
        const backend = backends.find(b => b.baseUrl === roleBaseUrl);
        const available = backend?.connected === true && (backend.models ?? []).some(
          (name) => name === modelId || name.startsWith(`${modelId}:`),
        );
        return { role, model: modelId, available: !!available };
      });
    }

    const allConnected = backends.every(b => b.connected);
    const anyConnected = backends.some(b => b.connected);

    res.json({
      status: 'ok',
      backends,
      ...(registryStatus && { registry: registryStatus }),
      summary: allConnected ? 'all_connected' : anyConnected ? 'partial' : 'all_disconnected',
    });
  });

  return router;
}
