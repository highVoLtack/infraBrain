import { Router } from 'express';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { WriteThrough } from '../../state/store.js';
import type { InfraBrainConfig } from '../../config/types.js';
import type { LockFile } from '../../locks/types.js';

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

/**
 * Create the /status route.
 * Returns backend health, active plans, recent sessions, and active locks.
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

    res.json({ backend, activePlans, recentSessions, locks });
  });

  return router;
}
