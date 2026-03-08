import express from 'express';
import type { Server } from 'node:http';
import type { LLMProvider } from '../llm/types.js';
import type { AuditLogger } from '../audit/logger.js';
import type { ValidationResult } from '../safety/types.js';
import type { SkillRegistry } from '../skills/registry.js';
import type { WriteThrough } from '../state/store.js';
import { createHealthRoute } from './routes/health.js';
import { createDebugRoute } from './routes/debug.js';
import { createExecuteRoute } from './routes/execute.js';
import { createStatusRoute } from './routes/status.js';
import { createHistoryRoute } from './routes/history.js';
import type { InfraBrainConfig } from '../config/types.js';

export interface ServerDeps {
  provider: LLMProvider;
  auditLogger: AuditLogger;
  validator: (command: string) => ValidationResult;
  ollamaBaseUrl: string;
  registry?: SkillRegistry;
  config?: InfraBrainConfig;
  sessionId?: string;
  sessionDir?: string;
  store?: WriteThrough;
  lockDir?: string;
}

export interface ServerInstance {
  app: express.Express;
  server: Server;
}

/**
 * Create and configure the Express 5 server.
 * Returns both app (for testing) and server (for graceful shutdown).
 */
export function createServer(deps: ServerDeps): { app: express.Express; start: (port: number) => Promise<ServerInstance> } {
  const app = express();

  // Middleware
  app.use(express.json());

  // Routes
  app.use('/health', createHealthRoute(deps.ollamaBaseUrl));
  app.use('/debug', createDebugRoute(deps.provider, deps.auditLogger, deps.validator, deps.registry));

  // Mount status route if store available
  if (deps.store && deps.config && deps.lockDir) {
    app.use('/status', createStatusRoute({
      store: deps.store,
      ollamaBaseUrl: deps.ollamaBaseUrl,
      lockDir: deps.lockDir,
      config: deps.config,
    }));
  }

  // Mount history route if store available
  if (deps.store) {
    app.use('/history', createHistoryRoute({ store: deps.store }));
  }

  // Mount execute route if config available
  if (deps.config && deps.sessionId && deps.sessionDir) {
    app.use('/execute', createExecuteRoute({
      auditLogger: deps.auditLogger,
      config: deps.config,
      sessionId: deps.sessionId,
      sessionDir: deps.sessionDir,
    }));
  }

  // Error handler (Express 5 catches async throws natively)
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('[Server Error]', err.message);
    res.status(500).json({ error: err.message });
  });

  return {
    app,
    start: (port: number) => {
      return new Promise<ServerInstance>((resolve) => {
        const server = app.listen(port, () => {
          resolve({ app, server });
        });
      });
    },
  };
}
