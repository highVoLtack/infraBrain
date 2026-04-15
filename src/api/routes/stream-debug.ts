import { Router } from 'express';
import type { Request, Response } from 'express';
import type { LLMProvider } from '../../llm/types.js';
import type { AuditLogger } from '../../audit/logger.js';
import type { ValidationResult } from '../../safety/types.js';
import type { SkillRegistry } from '../../skills/registry.js';
import type { WriteThrough } from '../../state/store.js';
import type { InfraBrainConfig } from '../../config/types.js';
import { v7 as uuidv7 } from 'uuid';
import { runDPEV } from '../../orchestrator/pipeline.js';
import type { CacheHitProvenance } from '../../orchestrator/pipeline.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StreamDebugRouteDeps {
  provider: LLMProvider;
  auditLogger: AuditLogger;
  validator: (command: string) => ValidationResult;
  registry?: SkillRegistry;
  store?: WriteThrough;
  config?: InfraBrainConfig;
  sessionId?: string;
}

// ---------------------------------------------------------------------------
// SSE Helpers
// ---------------------------------------------------------------------------

function initSSE(res: Response): void {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
}

function sendEvent(res: Response, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

// ---------------------------------------------------------------------------
// Module-scoped approval map for concurrent session safety
// ---------------------------------------------------------------------------

const cacheApprovals = new Map<string, { resolve: (useCache: boolean) => void }>();

// ---------------------------------------------------------------------------
// Route Factory
// ---------------------------------------------------------------------------

/**
 * Create the /stream/debug route.
 * POST / streams DPEV pipeline events via SSE.
 * POST /approve resolves pending cache hit decisions.
 */
export function createStreamDebugRoute(deps: StreamDebugRouteDeps): Router {
  const router = Router();

  // POST / -- SSE streaming DPEV pipeline
  router.post('/', async (req: Request, res: Response) => {
    const { prompt, skill: skillOverride, noCache } = req.body ?? {};

    // Validate prompt -- return 400 JSON (not SSE) since client can't parse SSE before connection
    if (!prompt || typeof prompt !== 'string') {
      res.status(400).json({ error: 'prompt is required' });
      return;
    }

    // Initialize SSE stream
    initSSE(res);

    const sessionId = deps.sessionId ?? uuidv7();

    // Create onEvent callback that relays pipeline events to SSE
    const onEvent = (event: string, data: unknown): void => {
      sendEvent(res, event, data);
    };

    // Create requestCacheApproval callback:
    // Sends dpev:cache-hit SSE event, then returns a Promise that resolves
    // when the user responds via POST /stream/debug/approve
    const requestCacheApproval = (provenance: CacheHitProvenance): Promise<boolean> => {
      sendEvent(res, 'dpev:cache-hit', {
        similarity: provenance.similarity,
        confidence: provenance.confidence,
        sourceSessionId: provenance.originalSessionId,
        sourceDate: provenance.originalDate,
        skillName: provenance.skillName,
      });

      return new Promise<boolean>((resolve) => {
        cacheApprovals.set(sessionId, { resolve });
      });
    };

    // Handle client disconnect
    req.on('close', () => {
      const pending = cacheApprovals.get(sessionId);
      if (pending) {
        pending.resolve(false); // Reject cache on disconnect
        cacheApprovals.delete(sessionId);
      }
    });

    try {
      await runDPEV({
        prompt,
        skillOverride: skillOverride as string | undefined,
        provider: deps.provider,
        registry: deps.registry,
        auditLogger: deps.auditLogger,
        validator: deps.validator,
        store: deps.store,
        config: deps.config,
        sessionId,
        noCache: noCache === true,
        onEvent,
        requestCacheApproval,
      });

      // Send completion event
      sendEvent(res, 'dpev:complete', { sessionId, status: 'success' });
    } catch (err) {
      // Send error event
      sendEvent(res, 'dpev:error', {
        message: (err as Error).message,
      });
    } finally {
      // Clean up approval map
      cacheApprovals.delete(sessionId);
      res.end();
    }
  });

  // POST /approve -- cache hit approval (regular JSON endpoint, NOT SSE)
  router.post('/approve', (req: Request, res: Response) => {
    const { sessionId, useCache } = req.body ?? {};

    if (!sessionId || typeof sessionId !== 'string') {
      res.status(400).json({ error: 'sessionId is required' });
      return;
    }

    const pending = cacheApprovals.get(sessionId);
    if (!pending) {
      res.status(404).json({ error: 'No pending cache hit approval for this session' });
      return;
    }

    // Resolve the pending Promise
    pending.resolve(!!useCache);
    cacheApprovals.delete(sessionId);

    res.status(200).json({ ok: true });
  });

  return router;
}
