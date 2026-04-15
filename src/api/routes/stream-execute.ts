import { Router } from 'express';
import type { Request, Response } from 'express';
import type { AuditLogger } from '../../audit/logger.js';
import type { InfraBrainConfig } from '../../config/types.js';
import type { LLMProvider } from '../../llm/types.js';
import type { SkillRegistry } from '../../skills/registry.js';
import type { WriteThrough } from '../../state/store.js';
import { FixPlanSchema } from '../../orchestrator/types.js';
import { executePlan } from '../../execution/executor.js';
import { runCommand } from '../../execution/runner.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StreamExecuteRouteDeps {
  auditLogger: AuditLogger;
  config: InfraBrainConfig;
  sessionId: string;
  sessionDir: string;
  store?: WriteThrough;
  provider?: LLMProvider;
  registry?: SkillRegistry;
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
// Module-scoped approval map for step approvals
// ---------------------------------------------------------------------------

const stepApprovals = new Map<string, { resolve: (approved: boolean) => void }>();

// Key format: `${sessionId}:${stepIndex}`
function approvalKey(sessionId: string, stepIndex: number): string {
  return `${sessionId}:${stepIndex}`;
}

// ---------------------------------------------------------------------------
// Route Factory
// ---------------------------------------------------------------------------

/**
 * Create the /stream/execute route.
 * POST / streams execution step events via SSE.
 * POST /approve resolves pending step approvals.
 */
export function createStreamExecuteRoute(deps: StreamExecuteRouteDeps): Router {
  const router = Router();

  // POST / -- SSE streaming execution
  router.post('/', async (req: Request, res: Response) => {
    const { sessionId, fixPlan, target, adminName } = req.body ?? {};

    // Validate input -- return 400 JSON (not SSE)
    if (!sessionId || typeof sessionId !== 'string') {
      res.status(400).json({ error: 'sessionId is required' });
      return;
    }
    if (!fixPlan) {
      res.status(400).json({ error: 'fixPlan is required' });
      return;
    }
    if (!target || typeof target !== 'string') {
      res.status(400).json({ error: 'target is required' });
      return;
    }
    if (!adminName || typeof adminName !== 'string') {
      res.status(400).json({ error: 'adminName is required' });
      return;
    }

    // Validate fixPlan schema
    const planResult = FixPlanSchema.safeParse(fixPlan);
    if (!planResult.success) {
      res.status(400).json({ error: 'Invalid fixPlan', details: planResult.error.issues });
      return;
    }

    // Initialize SSE stream
    initSSE(res);

    const plan = planResult.data;

    // Emit initial exec:step pending events for all steps
    for (let i = 0; i < plan.steps.length; i++) {
      sendEvent(res, 'exec:step', {
        stepIndex: i,
        total: plan.steps.length,
        command: plan.steps[i].command,
        risk: plan.steps[i].risk,
        status: 'pending',
        target,
      });
    }

    // Handle client disconnect -- reject all pending approvals
    req.on('close', () => {
      for (const [key, pending] of stepApprovals.entries()) {
        if (key.startsWith(`${sessionId}:`)) {
          pending.resolve(false);
          stepApprovals.delete(key);
        }
      }
    });

    try {
      // Build a mock runner that wraps the real execution but emits SSE events
      const result = await executePlan(plan, target, {
        runner: {
          run: async (executable, args, options) => {
            return runCommand(executable, args, options);
          },
        },
        requestApproval: async (command: string, risk: string) => {
          if (risk === 'read') {
            // READ steps auto-approve
            return { approved: true };
          }

          // For WRITE/DESTRUCTIVE steps, emit approval event and wait
          const stepIndex = plan.steps.findIndex(s => s.command === command);
          const effectiveIndex = stepIndex >= 0 ? stepIndex : 0;

          sendEvent(res, 'exec:approval', {
            command,
            riskLevel: risk,
            target,
            stepIndex: effectiveIndex,
          });

          // Wait for POST /approve to resolve
          return new Promise<{ approved: boolean }>((resolve) => {
            const key = approvalKey(sessionId, effectiveIndex);
            stepApprovals.set(key, {
              resolve: (approved: boolean) => resolve({ approved }),
            });
          });
        },
        auditLogger: deps.auditLogger,
        config: deps.config,
        sessionId: deps.sessionId,
        sessionDir: deps.sessionDir,
      });

      // Emit step results
      for (const stepResult of result.stepResults) {
        sendEvent(res, 'exec:step', {
          stepIndex: stepResult.stepIndex,
          total: plan.steps.length,
          command: plan.steps[stepResult.stepIndex]?.command ?? '',
          risk: plan.steps[stepResult.stepIndex]?.risk ?? 'read',
          status: stepResult.status,
          stdout: stepResult.runResult?.stdout,
          stderr: stepResult.runResult?.stderr,
          target,
        });
      }

      // Send completion event
      sendEvent(res, 'dpev:complete', {
        sessionId,
        status: result.status,
      });
    } catch (err) {
      sendEvent(res, 'dpev:error', {
        message: (err as Error).message,
      });
    } finally {
      // Clean up any remaining approval resolvers for this session
      for (const key of stepApprovals.keys()) {
        if (key.startsWith(`${sessionId}:`)) {
          stepApprovals.delete(key);
        }
      }
      res.end();
    }
  });

  // POST /approve -- step approval (regular JSON endpoint, NOT SSE)
  router.post('/approve', (req: Request, res: Response) => {
    const { stepIndex, approved, sessionId: reqSessionId } = req.body ?? {};

    if (stepIndex === undefined || typeof stepIndex !== 'number') {
      res.status(400).json({ error: 'stepIndex is required' });
      return;
    }

    // Look up by session ID if provided, otherwise search all sessions
    let key: string | undefined;
    if (reqSessionId) {
      key = approvalKey(reqSessionId, stepIndex);
    } else {
      // Find any session with this stepIndex pending
      for (const k of stepApprovals.keys()) {
        if (k.endsWith(`:${stepIndex}`)) {
          key = k;
          break;
        }
      }
    }

    if (!key || !stepApprovals.has(key)) {
      res.status(404).json({ error: 'No pending approval for this step' });
      return;
    }

    const pending = stepApprovals.get(key)!;
    pending.resolve(!!approved);
    stepApprovals.delete(key);

    res.status(200).json({ ok: true });
  });

  return router;
}
