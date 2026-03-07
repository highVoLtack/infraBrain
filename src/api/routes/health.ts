import { Router } from 'express';

/**
 * Create the /health route.
 * Checks Ollama connectivity by fetching /api/tags.
 */
export function createHealthRoute(ollamaBaseUrl: string): Router {
  const router = Router();

  router.get('/', async (_req, res) => {
    try {
      const response = await fetch(`${ollamaBaseUrl}/api/tags`);
      const data = await response.json() as { models: Array<{ name: string }> };
      res.json({
        status: 'ok',
        ollama: 'connected',
        models: data.models,
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
