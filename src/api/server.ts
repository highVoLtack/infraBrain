import express from 'express';
import type { Server } from 'node:http';
import type { LLMProvider } from '../llm/types.js';
import type { AuditLogger } from '../audit/logger.js';
import type { ValidationResult } from '../safety/types.js';
import { createHealthRoute } from './routes/health.js';
import { createDebugRoute } from './routes/debug.js';

export interface ServerDeps {
  provider: LLMProvider;
  auditLogger: AuditLogger;
  validator: (command: string) => ValidationResult;
  ollamaBaseUrl: string;
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
  app.use('/debug', createDebugRoute(deps.provider, deps.auditLogger, deps.validator));

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
