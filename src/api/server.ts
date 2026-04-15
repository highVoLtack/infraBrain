import express from 'express';
import type { Server } from 'node:http';
import type { LLMProvider, ModelRegistry } from '../llm/types.js';
import type { AuditLogger } from '../audit/logger.js';
import type { ValidationResult } from '../safety/types.js';
import type { SkillRegistry } from '../skills/registry.js';
import type { WriteThrough } from '../state/store.js';
import { createHealthRoute } from './routes/health.js';
import { createDebugRoute } from './routes/debug.js';
import { createExecuteRoute } from './routes/execute.js';
import { createStatusRoute } from './routes/status.js';
import { createHistoryRoute } from './routes/history.js';
import { createResumeRoute } from './routes/resume.js';
import { createStreamDebugRoute } from './routes/stream-debug.js';
import { createStreamExecuteRoute } from './routes/stream-execute.js';
import { mountEntitiesRoute } from './routes/entities.js';
import { getEntityStore } from '../memory/entity-store.js';
import type { InfraBrainConfig } from '../config/types.js';

export interface ServerDeps {
  provider: LLMProvider;
  auditLogger: AuditLogger;
  validator: (command: string) => ValidationResult;
  defaultBaseUrl: string;
  registry?: SkillRegistry;
  modelRegistry?: ModelRegistry;
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
  app.use('/health', createHealthRoute(deps.config!, deps.modelRegistry));
  app.use('/debug', createDebugRoute(deps.provider, deps.auditLogger, deps.validator, deps.registry, {
    store: deps.store,
    config: deps.config,
    sessionId: deps.sessionId,
  }));

  // Mount status route if store available
  if (deps.store && deps.config && deps.lockDir) {
    app.use('/status', createStatusRoute({
      store: deps.store,
      defaultBaseUrl: deps.defaultBaseUrl,
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
      store: deps.store,
      provider: deps.provider,
      registry: deps.registry,
    }));
  }

  // Mount resume route if store and config available
  if (deps.store && deps.config && deps.sessionId && deps.sessionDir) {
    app.use('/resume', createResumeRoute({
      store: deps.store,
      config: deps.config,
      auditLogger: deps.auditLogger,
      sessionId: deps.sessionId,
      sessionDir: deps.sessionDir,
    }));
  }

  // Mount entities route if memory is configured
  if (deps.config?.memory?.enabled !== false) {
    const memDataDir = deps.config?.memory?.dataDir ?? '.infrabrain/memory';
    const entityStore = getEntityStore(memDataDir);
    mountEntitiesRoute(app, entityStore);
  }

  // SSE streaming routes (mounted after existing REST routes for backward compatibility)
  app.use('/stream/debug', createStreamDebugRoute({
    provider: deps.provider,
    auditLogger: deps.auditLogger,
    validator: deps.validator,
    registry: deps.registry,
    store: deps.store,
    config: deps.config,
    sessionId: deps.sessionId,
  }));

  if (deps.config && deps.sessionId && deps.sessionDir) {
    app.use('/stream/execute', createStreamExecuteRoute({
      auditLogger: deps.auditLogger,
      config: deps.config,
      sessionId: deps.sessionId,
      sessionDir: deps.sessionDir,
      store: deps.store,
      provider: deps.provider,
      registry: deps.registry,
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
          // 10 minute timeout for long LLM calls over RunPod proxy
          server.timeout = 600_000;
          server.keepAliveTimeout = 600_000;
          server.headersTimeout = 610_000;
          resolve({ app, server });
        });
      });
    },
  };
}
