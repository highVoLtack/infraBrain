/**
 * SSE Event Protocol Types for DPEV streaming
 *
 * Defines all event types flowing from Express SSE endpoints to Ink UI client.
 * Every subsequent UI plan imports these types.
 */

// ---- SSE Event Name Constants ----

export const SSE_EVENT_NAMES = {
  PHASE: 'dpev:phase',
  TOKEN: 'dpev:token',
  DIAGNOSIS: 'dpev:diagnosis',
  CACHE_HIT: 'dpev:cache-hit',
  PLAN: 'dpev:plan',
  PLAN_APPROVAL: 'dpev:plan-approval',
  VERIFICATION: 'dpev:verification',
  SUBSTATUS: 'dpev:substatus',
  USAGE: 'dpev:usage',
  SESSION_SUMMARY: 'dpev:session_summary',
  STEP: 'exec:step',
  APPROVAL: 'exec:approval',
  COMPLETE: 'dpev:complete',
  ERROR: 'dpev:error',
} as const;

// ---- SSE Event Payloads ----

export interface SSEEventMap {
  'dpev:phase': {
    phase: 'routing' | 'discovery' | 'diagnosis' | 'plan' | 'execution' | 'verification';
    model: string;
    status: 'active' | 'complete';
  };
  'dpev:token': {
    text: string;
    phase: string;
  };
  'dpev:diagnosis': {
    rootCause: string;
    correlation: string;
    structuredDiagnosis: object;
  };
  'dpev:cache-hit': {
    similarity: number;
    confidence: number;
    sourceSessionId: string;
    sourceDate: string;
    skillName: string;
    provider?: string;
    resourceType?: string;
  };
  'dpev:plan': {
    fixPlan: object;
    planTable: string;
  };
  'dpev:plan-approval': {
    fixPlan: object;
    sessionId: string;
  };
  'dpev:verification': {
    passed: boolean;
    executionStatus: string;
    discoveryOutput?: Record<string, string>;
  };
  /** D-06/D-07: granular pipeline activity label for the active-phase indicator. */
  'dpev:substatus': {
    label: string;
    phase?: string;
  };
  /** D-09/D-11: per-phase LLM usage. Null fields render as an em-dash, never $0. */
  'dpev:usage': {
    phase: string;
    modelId: string;
    inputTokens: number;
    outputTokens: number | null;
    totalTokens: number | null;
    costUsd: number | null;
  };
  /** D-12/D-24: cumulative session footer. potentialSavings is always null in v1.3. */
  'dpev:session_summary': {
    sessionId: string;
    totalTokens: number;
    totalCostUsd: number;
    potentialSavings: number | null;
  };
  'exec:step': {
    stepIndex: number;
    total: number;
    command: string;
    risk: string;
    status: 'pending' | 'running' | 'success' | 'failed' | 'skipped';
    stdout?: string;
    stderr?: string;
    provider?: string;
    target?: string;
  };
  'exec:approval': {
    command: string;
    riskLevel: string;
    target: string;
    stepIndex: number;
  };
  'dpev:complete': {
    sessionId: string;
    status: string;
  };
  'dpev:error': {
    message: string;
    phase?: string;
  };
}

// ---- Layout Types ----

export type LayoutMode = 'full' | 'compact' | 'minimal';
export type PanelId = 'left' | 'center' | 'right';

// ---- DPEV State Machine Types ----

export interface DPEVPhaseState {
  name: string;
  model: string;
  startedAt: number;
  completedAt?: number;
  status: 'active' | 'complete' | 'error';
  tokens: string;
}

export interface StepState {
  stepIndex: number;
  total: number;
  command: string;
  risk: string;
  status: 'pending' | 'running' | 'success' | 'failed' | 'skipped';
  stdout?: string;
  stderr?: string;
  provider?: string;
  target?: string;
}

export interface ApprovalRequest {
  command: string;
  riskLevel: string;
  target: string;
  stepIndex: number;
}

export interface CacheHitProvenance {
  similarity: number;
  confidence: number;
  sourceSessionId: string;
  sourceDate: string;
  skillName: string;
  provider?: string;
  resourceType?: string;
}

export interface DPEVState {
  sessionId: string;
  phases: DPEVPhaseState[];
  activePhaseIndex: number;
  cacheHit?: CacheHitProvenance;
  fixPlan?: object;
  executionSteps: StepState[];
  pendingApproval?: ApprovalRequest;
  planApprovalPending?: boolean;
  verificationResult?: { passed: boolean; executionStatus: string };
  status: 'idle' | 'streaming' | 'awaiting-approval' | 'plan-approval' | 'executing' | 'complete' | 'error';
  errorMessage?: string;
}

export type DPEVAction =
  | { type: 'PHASE_START'; phase: string; model: string }
  | { type: 'PHASE_COMPLETE'; phase: string; model?: string }
  | { type: 'TOKEN'; text: string }
  | { type: 'CACHE_HIT'; provenance: CacheHitProvenance }
  | { type: 'PLAN_READY'; fixPlan: object }
  | { type: 'PLAN_APPROVAL_REQUIRED'; fixPlan: object; sessionId: string }
  | { type: 'STEP_UPDATE'; stepIndex: number; status: string; stdout?: string; stderr?: string }
  | { type: 'APPROVAL_REQUIRED'; command: string; riskLevel: string; target: string; stepIndex: number }
  | { type: 'APPROVAL_RESPONSE'; approved: boolean }
  | { type: 'VERIFICATION_RESULT'; passed: boolean; executionStatus: string }
  | { type: 'COMPLETE'; sessionId: string; status: string }
  | { type: 'ERROR'; message: string; phase?: string };
