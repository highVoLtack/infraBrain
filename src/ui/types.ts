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
  STEP: 'exec:step',
  APPROVAL: 'exec:approval',
  COMPLETE: 'dpev:complete',
  ERROR: 'dpev:error',
} as const;

// ---- SSE Event Payloads ----

export interface SSEEventMap {
  'dpev:phase': {
    phase: 'discovery' | 'diagnosis' | 'plan' | 'execution' | 'verification';
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
  status: 'idle' | 'streaming' | 'awaiting-approval' | 'executing' | 'complete' | 'error';
}

export type DPEVAction =
  | { type: 'PHASE_START'; phase: string; model: string }
  | { type: 'PHASE_COMPLETE'; phase: string }
  | { type: 'TOKEN'; text: string }
  | { type: 'CACHE_HIT'; provenance: CacheHitProvenance }
  | { type: 'PLAN_READY'; fixPlan: object }
  | { type: 'STEP_UPDATE'; stepIndex: number; status: string; stdout?: string; stderr?: string }
  | { type: 'APPROVAL_REQUIRED'; command: string; riskLevel: string; target: string; stepIndex: number }
  | { type: 'APPROVAL_RESPONSE'; approved: boolean }
  | { type: 'COMPLETE'; sessionId: string; status: string }
  | { type: 'ERROR'; message: string; phase?: string };
