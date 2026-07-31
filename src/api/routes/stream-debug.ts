import { Router } from 'express';
import type { Request, Response } from 'express';
import type { LLMProvider } from '../../llm/types.js';
import type { AuditLogger } from '../../audit/logger.js';
import { AuditLogger as AuditLoggerClass } from '../../audit/logger.js';
import type { ValidationResult } from '../../safety/types.js';
import type { SkillRegistry } from '../../skills/registry.js';
import type { WriteThrough } from '../../state/store.js';
import type { InfraBrainConfig } from '../../config/types.js';
import type { SessionState } from '../../state/types.js';
import type { FixStep } from '../../orchestrator/types.js';
import { v7 as uuidv7 } from 'uuid';
import { join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { runDPEV } from '../../orchestrator/pipeline.js';
import type { CacheHitProvenance, DPEVResult } from '../../orchestrator/pipeline.js';
import { executePlan } from '../../execution/executor.js';
import { runCommand } from '../../execution/runner.js';
import { runParallelDiscovery } from '../../orchestrator/discovery.js';
import { DEFAULT_CONFIG } from '../../config/defaults.js';
import {
  recordUsage,
  getSessionSummary,
  clearSessionUsage,
} from '../../state/session-usage.js';

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
  baseDir?: string;
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

/**
 * Emit the cumulative session usage footer (D-12).
 * Called at every non-disconnect session-end path, just before dpev:complete.
 * `potentialSavings` is always null in v1.3 -- the v2.0 Caveman pipeline fills it (D-24).
 */
function emitSessionSummary(res: Response, sessionId: string): void {
  const totals = getSessionSummary(sessionId);
  sendEvent(res, 'dpev:session_summary', {
    sessionId,
    totalTokens: totals?.totalTokens ?? 0,
    totalCostUsd: totals?.totalCostUsd ?? 0,
    potentialSavings: null,
  });
}

// ---------------------------------------------------------------------------
// Module-scoped approval maps for concurrent session safety
// ---------------------------------------------------------------------------

const cacheApprovals = new Map<string, { resolve: (useCache: boolean) => void }>();
const planApprovals = new Map<string, { resolve: (approved: boolean) => void }>();
const stepApprovals = new Map<string, { resolve: (approved: boolean) => void }>();

function stepApprovalKey(sessionId: string, stepIndex: number): string {
  return `${sessionId}:${stepIndex}`;
}

// ---------------------------------------------------------------------------
// Route Factory
// ---------------------------------------------------------------------------

/**
 * Create the /stream/debug route.
 * POST / streams DPEV pipeline events via SSE, then gates on plan approval,
 *        chains execution through the same SSE, runs verification, and
 *        emits a final dpev:complete with the real execution outcome.
 * POST /approve         -- cache hit approval
 * POST /plan-approve    -- plan approval gate (TERM-E02 backend)
 * POST /step-approve    -- per-step approval for write/destructive steps
 */
export function createStreamDebugRoute(deps: StreamDebugRouteDeps): Router {
  const router = Router();

  // POST / -- SSE streaming DPEV pipeline + execution + verification
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

    // --- Session persistence: create session dir and initial state ---
    let sessionDir: string | undefined;
    let sessionState: SessionState | undefined;
    let sessionAuditLogger: AuditLogger = deps.auditLogger;

    if (deps.store) {
      try {
        const baseDir = deps.baseDir ?? process.cwd();
        sessionDir = join(baseDir, '.infrabrain', 'sessions', sessionId);
        mkdirSync(sessionDir, { recursive: true });
        writeFileSync(join(sessionDir, 'audit.jsonl'), '');

        const now = new Date().toISOString();
        sessionState = {
          sessionId,
          createdAt: now,
          updatedAt: now,
          status: 'active',
          target: prompt,
        };
        deps.store.persistState(sessionDir, sessionState);

        // Create a fresh AuditLogger for this SSE session
        sessionAuditLogger = new AuditLoggerClass(deps.store, sessionId, sessionDir);
      } catch {
        // Session persistence is non-critical -- continue without it
      }
    }

    // Persist session state helper (no-op if store unavailable)
    const updateSessionStatus = (status: SessionState['status']): void => {
      if (deps.store && sessionDir && sessionState) {
        try {
          sessionState = {
            ...sessionState,
            status,
            updatedAt: new Date().toISOString(),
          };
          deps.store.persistState(sessionDir, sessionState);
        } catch { /* session persistence is non-critical */ }
      }
    };

    // Create onEvent callback that relays pipeline events to SSE.
    // dpev:usage is additionally folded into the per-session aggregator (D-12)
    // before being forwarded verbatim to the client.
    const onEvent = (event: string, data: unknown): void => {
      if (event === 'dpev:usage') {
        const d = data as {
          modelId: string;
          inputTokens: number;
          outputTokens: number | null;
        };
        try {
          recordUsage(sessionId, d.modelId, d.inputTokens, d.outputTokens ?? 0);
        } catch { /* usage aggregation is non-critical */ }
      }
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

    // Handle client disconnect -- reject all pending approvals for this session
    req.on('close', () => {
      const cachePending = cacheApprovals.get(sessionId);
      if (cachePending) {
        cachePending.resolve(false);
        cacheApprovals.delete(sessionId);
      }
      const planPending = planApprovals.get(sessionId);
      if (planPending) {
        planPending.resolve(false);
        planApprovals.delete(sessionId);
      }
      for (const key of Array.from(stepApprovals.keys())) {
        if (key.startsWith(`${sessionId}:`)) {
          stepApprovals.get(key)?.resolve(false);
          stepApprovals.delete(key);
        }
      }
      // NOTE: session-usage totals are deliberately NOT cleared here. On
      // http.IncomingMessage this 'close' fires as soon as the request body
      // stream ends -- i.e. long before the pipeline finishes -- so clearing
      // here would wipe the totals before dpev:session_summary is emitted.
      // The finally block below is the single cleanup point and always runs,
      // including when the client really did disconnect.
    });

    let dpevResult: DPEVResult | undefined;

    try {
      dpevResult = await runDPEV({
        prompt,
        skillOverride: skillOverride as string | undefined,
        provider: deps.provider,
        registry: deps.registry,
        auditLogger: sessionAuditLogger,
        validator: deps.validator,
        store: deps.store,
        config: deps.config,
        sessionId,
        noCache: noCache === true,
        onEvent,
        requestCacheApproval,
      });

      // --- Plan approval gate (TERM-E02 backend) ---
      // Only gate if we have a fixPlan with steps. Cache hits + hallucination errors bypass.
      const hasActionablePlan = !!(dpevResult.fixPlan && dpevResult.fixPlan.steps.length > 0);

      if (hasActionablePlan) {
        // Mark session as plan-ready (not completed) while we wait
        updateSessionStatus('plan-ready');

        // Emit plan approval event and wait for user response
        sendEvent(res, 'dpev:plan-approval', {
          fixPlan: dpevResult.fixPlan,
          sessionId,
        });

        const approved = await new Promise<boolean>((resolve) => {
          planApprovals.set(sessionId, { resolve });
        });
        planApprovals.delete(sessionId);

        if (!approved) {
          // User rejected plan -- end cleanly, status completed with plan_rejected
          updateSessionStatus('completed');
          emitSessionSummary(res, sessionId);
          sendEvent(res, 'dpev:complete', { sessionId, status: 'plan_rejected' });
          res.end();
          return;
        }

        // User approved plan -- chain to execution
        await runExecutionAndVerification({
          res,
          sessionId,
          sessionDir,
          dpevResult,
          deps,
          sessionAuditLogger,
          updateSessionStatus,
        });
        return;
      }

      // No actionable plan: treat as failure (not success).
      // fixPlan is undefined when the LLM planner silently fails (e.g. typo prompt
      // produces unparseable output). Emitting dpev:complete success here would
      // hide the failure behind a misleading "Session complete" banner.
      updateSessionStatus('failed');
      sendEvent(res, 'dpev:error', {
        message:
          'Planning produced no actionable steps. Try rephrasing your prompt (e.g. check for typos and use specific service names).',
        phase: 'plan',
      });
      emitSessionSummary(res, sessionId);
      sendEvent(res, 'dpev:complete', { sessionId, status: 'failed' });
    } catch (err) {
      // Pipeline error -- mark failed, emit dpev:error
      updateSessionStatus('failed');
      sendEvent(res, 'dpev:error', {
        message: (err as Error).message,
      });
    } finally {
      // Clean up approval map for this session
      cacheApprovals.delete(sessionId);
      planApprovals.delete(sessionId);
      // Drop the per-session usage totals (D-12) -- the summary has already been sent
      clearSessionUsage(sessionId);
      for (const key of Array.from(stepApprovals.keys())) {
        if (key.startsWith(`${sessionId}:`)) {
          stepApprovals.delete(key);
        }
      }
      if (!res.writableEnded) {
        res.end();
      }
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

  // POST /plan-approve -- plan approval gate (TERM-E02 backend)
  router.post('/plan-approve', (req: Request, res: Response) => {
    const { sessionId, approved } = req.body ?? {};

    if (!sessionId || typeof sessionId !== 'string') {
      res.status(400).json({ error: 'sessionId is required' });
      return;
    }

    const pending = planApprovals.get(sessionId);
    if (!pending) {
      res.status(404).json({ error: 'No pending plan approval for this session' });
      return;
    }

    pending.resolve(!!approved);
    planApprovals.delete(sessionId);

    res.status(200).json({ ok: true });
  });

  // POST /step-approve -- per-step approval for write/destructive steps
  router.post('/step-approve', (req: Request, res: Response) => {
    const { sessionId, stepIndex, approved } = req.body ?? {};

    if (!sessionId || typeof sessionId !== 'string') {
      res.status(400).json({ error: 'sessionId is required' });
      return;
    }
    if (typeof stepIndex !== 'number') {
      res.status(400).json({ error: 'stepIndex is required' });
      return;
    }

    const key = stepApprovalKey(sessionId, stepIndex);
    const pending = stepApprovals.get(key);
    if (!pending) {
      res.status(404).json({ error: 'No pending step approval for this session/step' });
      return;
    }

    pending.resolve(!!approved);
    stepApprovals.delete(key);

    res.status(200).json({ ok: true });
  });

  return router;
}

// ---------------------------------------------------------------------------
// Execution + Verification helper
// ---------------------------------------------------------------------------

interface ExecuteAndVerifyArgs {
  res: Response;
  sessionId: string;
  sessionDir: string | undefined;
  dpevResult: DPEVResult;
  deps: StreamDebugRouteDeps;
  sessionAuditLogger: AuditLogger;
  updateSessionStatus: (status: SessionState['status']) => void;
}

async function runExecutionAndVerification(args: ExecuteAndVerifyArgs): Promise<void> {
  const { res, sessionId, sessionDir, dpevResult, deps, sessionAuditLogger, updateSessionStatus } = args;
  const fixPlan = dpevResult.fixPlan!;
  const target = dpevResult.target ?? 'unknown';
  const config = deps.config ?? DEFAULT_CONFIG;

  // --- Execution phase ---
  sendEvent(res, 'dpev:phase', { phase: 'execution', model: 'executor', status: 'active' });

  try {
    sessionAuditLogger.logExecution('dpev_phase_start', { phase: 'execution', model: 'executor' });
  } catch { /* non-critical */ }

  // Emit initial exec:step pending events (same pattern as stream-execute.ts)
  for (let i = 0; i < fixPlan.steps.length; i++) {
    sendEvent(res, 'exec:step', {
      stepIndex: i,
      total: fixPlan.steps.length,
      command: fixPlan.steps[i].command,
      risk: fixPlan.steps[i].risk,
      status: 'pending',
      target,
    });
  }

  const executionStart = Date.now();
  let executionResult: Awaited<ReturnType<typeof executePlan>> | undefined;

  try {
    executionResult = await executePlan(fixPlan, target, {
      runner: {
        run: async (executable: string, execArgs: string[], runOptions) => {
          return runCommand(executable, execArgs, runOptions);
        },
      },
      requestApproval: async (command: string, risk: FixStep['risk']) => {
        if (risk === 'read') {
          return { approved: true };
        }

        const stepIndex = fixPlan.steps.findIndex(s => s.command === command);
        const effectiveIndex = stepIndex >= 0 ? stepIndex : 0;

        sendEvent(res, 'exec:approval', {
          command,
          riskLevel: risk,
          target,
          stepIndex: effectiveIndex,
        });

        return new Promise<{ approved: boolean }>((resolve) => {
          const key = stepApprovalKey(sessionId, effectiveIndex);
          stepApprovals.set(key, {
            resolve: (approved: boolean) => resolve({ approved }),
          });
        });
      },
      auditLogger: sessionAuditLogger,
      config,
      sessionId,
      sessionDir: sessionDir ?? join(process.cwd(), '.infrabrain', 'sessions', sessionId),
    });

    // Emit final step results
    for (const stepResult of executionResult.stepResults) {
      sendEvent(res, 'exec:step', {
        stepIndex: stepResult.stepIndex,
        total: fixPlan.steps.length,
        command: fixPlan.steps[stepResult.stepIndex]?.command ?? '',
        risk: fixPlan.steps[stepResult.stepIndex]?.risk ?? 'read',
        status: stepResult.status,
        stdout: stepResult.runResult?.stdout,
        stderr: stepResult.runResult?.stderr,
        target,
      });
    }
  } catch (err) {
    sendEvent(res, 'dpev:error', {
      message: `Execution failed: ${(err as Error).message}`,
      phase: 'execution',
    });
    updateSessionStatus('failed');
    emitSessionSummary(res, sessionId);
    sendEvent(res, 'dpev:complete', { sessionId, status: 'failed' });
    return;
  }

  sendEvent(res, 'dpev:phase', { phase: 'execution', model: 'executor', status: 'complete' });

  try {
    sessionAuditLogger.logExecution('dpev_phase_complete', {
      phase: 'execution',
      model: 'executor',
      duration_ms: Date.now() - executionStart,
    });
  } catch { /* non-critical */ }

  // --- Verification phase ---
  sendEvent(res, 'dpev:phase', { phase: 'verification', model: 'executor', status: 'active' });

  try {
    sessionAuditLogger.logExecution('dpev_phase_start', { phase: 'verification', model: 'executor' });
  } catch { /* non-critical */ }

  const verificationStart = Date.now();
  let verificationPassed = executionResult.status === 'completed';
  let freshDiscovery: Record<string, string> = {};

  try {
    if (dpevResult.discoveryCommands && dpevResult.discoveryCommands.length > 0) {
      const { raw } = await runParallelDiscovery(dpevResult.discoveryCommands);
      freshDiscovery = raw;
    }
  } catch {
    // Verification re-run is non-critical -- proceed with execution status alone
  }

  sendEvent(res, 'dpev:verification', {
    passed: verificationPassed,
    executionStatus: executionResult.status,
    discoveryOutput: freshDiscovery,
  });

  sendEvent(res, 'dpev:phase', { phase: 'verification', model: 'executor', status: 'complete' });

  try {
    sessionAuditLogger.logExecution('dpev_phase_complete', {
      phase: 'verification',
      model: 'executor',
      duration_ms: Date.now() - verificationStart,
    });
  } catch { /* non-critical */ }

  // --- Final session status ---
  emitSessionSummary(res, sessionId);
  if (executionResult.status === 'completed') {
    updateSessionStatus('completed');
    sendEvent(res, 'dpev:complete', { sessionId, status: 'success' });
  } else {
    updateSessionStatus('failed');
    sendEvent(res, 'dpev:complete', { sessionId, status: 'failed' });
  }
}
