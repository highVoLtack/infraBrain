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

export interface BackendInfo {
  baseUrl: string;
  apiKey?: string;
}

/**
 * Extract all unique backend base URLs (with optional apiKey) from config.
 * String entries in modelMap use defaultBaseUrl; object entries use their own baseUrl.
 */
export function extractUniqueBackends(config: InfraBrainConfig): BackendInfo[] {
  const seen = new Map<string, BackendInfo>();
  seen.set(config.defaultBaseUrl, { baseUrl: config.defaultBaseUrl });

  for (const entry of Object.values(config.modelMap)) {
    if (typeof entry === 'object' && entry.baseUrl) {
      const existing = seen.get(entry.baseUrl);
      // Upgrade: if we already have this URL but without apiKey, add the apiKey
      if (!existing) {
        seen.set(entry.baseUrl, { baseUrl: entry.baseUrl, apiKey: entry.apiKey });
      } else if (!existing.apiKey && entry.apiKey) {
        existing.apiKey = entry.apiKey;
      }
    }
  }

  return Array.from(seen.values());
}

/**
 * Create the /health route.
 * Probes all unique backends via OpenAI /v1/models endpoint.
 * When a model registry is provided, verifies each registered model is available.
 */
export function createHealthRoute(config: InfraBrainConfig, registry?: ModelRegistry): Router {
  const router = Router();

  router.get('/', async (_req, res) => {
    const backendInfos = extractUniqueBackends(config);

    const backends: BackendHealth[] = await Promise.all(
      backendInfos.map(async ({ baseUrl, apiKey }): Promise<BackendHealth> => {
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 3000);
          const start = Date.now();
          const headers: Record<string, string> = {};
          if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
          const cleanUrl = baseUrl.replace(/\/+$/, '');
          const response = await fetch(`${cleanUrl}/models`, {
            signal: controller.signal,
            headers,
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
          if (process.env.NODE_ENV !== 'production') {
            console.error(`[HEALTH] Backend probe failed for ${baseUrl}: ${(err as Error).message}`);
          }
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
          (name) => name === modelId || name.startsWith(`${modelId}:`) || name === `models/${modelId}`,
        );
        return { role, model: modelId, available: !!available };
      });
    }

    const allConnected = backends.every(b => b.connected);
    const anyConnected = backends.some(b => b.connected);

    // Count distinct connected backend URLs to determine inference mode
    const connectedUrls = new Set(backends.filter(b => b.connected).map(b => b.baseUrl));
    const inferenceMode = connectedUrls.size >= 2 ? 'parallel' : 'sequential';

    res.json({
      status: 'ok',
      backends,
      ...(registryStatus && { registry: registryStatus }),
      summary: allConnected ? 'all_connected' : anyConnected ? 'partial' : 'all_disconnected',
      inferenceMode,
    });
  });

  return router;
}
