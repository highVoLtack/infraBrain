import { Router } from 'express';
import type { ModelRegistry } from '../../llm/types.js';

/**
 * Create the /health route.
 * Checks Ollama connectivity by fetching /api/tags.
 * When a model registry is provided, verifies each registered model is available.
 */
export function createHealthRoute(ollamaBaseUrl: string, registry?: ModelRegistry): Router {
  const router = Router();

  router.get('/', async (_req, res) => {
    try {
      const response = await fetch(`${ollamaBaseUrl}/api/tags`);
      const data = await response.json() as { models: Array<{ name: string }> };
      const availableModels = data.models.map((m: { name: string }) => m.name);

      // Check registry models against available models
      let registryStatus: Array<{ role: string; model: string; available: boolean }> | undefined;
      if (registry) {
        registryStatus = registry.entries().map(({ role, modelId }) => ({
          role,
          model: modelId,
          available: availableModels.some((name: string) =>
            name === modelId || name.startsWith(`${modelId}:`),
          ),
        }));
      }

      res.json({
        status: 'ok',
        ollama: 'connected',
        models: data.models,
        ...(registryStatus && { registry: registryStatus }),
      });
    } catch {
      res.json({
        status: 'ok',
        ollama: 'disconnected',
        error: `Ollama not detected at ${ollamaBaseUrl}. Run \`ollama serve\` first.`,
      });
    }
  });

  return router;
}
