import type { ModelRole } from '../config/types.js';

/**
 * Execution mode for the inference scheduler.
 * - 'parallel': 2+ distinct backend URLs are available -- tasks can overlap
 * - 'sequential': only 1 backend URL (or no probe yet) -- tasks run one after another
 */
export type InferenceMode = 'parallel' | 'sequential';

/**
 * Result of probing a single backend via its /models endpoint.
 */
export interface BackendStatus {
  baseUrl: string;
  available: boolean;
  models: string[];
  responseTimeMs: number;
}

/**
 * A unit of inference work to be dispatched by the scheduler.
 * The scheduler wraps `execute` with timing instrumentation but does NOT
 * own the model call itself -- callers provide arbitrary async functions.
 */
export interface InferenceTask<T> {
  /** Human-readable label for timing logs: "9B-noise-filter", "122B-diagnosis" */
  label: string;
  /** Maps to registry.get(role) for backend resolution */
  role: ModelRole;
  /** The actual inference work -- scheduler wraps this with timing */
  execute: () => Promise<T>;
}

/**
 * Result of a single inference task after dispatch.
 * Mirrors PromiseSettledResult semantics with added timing instrumentation.
 */
export interface InferenceResult<T> {
  label: string;
  status: 'fulfilled' | 'rejected';
  value?: T;
  reason?: string;
  /** Milliseconds since epoch when execute() was called */
  startMs: number;
  /** Milliseconds since epoch when execute() settled */
  endMs: number;
  /** endMs - startMs */
  durationMs: number;
}

/**
 * Configuration for the InferenceScheduler.
 */
export interface SchedulerConfig {
  /** How long to cache probe results in ms (default: 30000) */
  probeTTLMs: number;
  /** Per-backend probe timeout in ms (default: 3000) */
  probeTimeoutMs: number;
}
