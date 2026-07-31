/**
 * useDPEV - DPEV state machine hook
 *
 * dpevReducer is a pure function handling all DPEV phase transitions.
 * useDPEV is the React hook that wires SSE events to dispatch calls.
 */

import { useReducer, useCallback } from 'react';
import { useSSE } from './useSSE.js';
import type {
  DPEVState,
  DPEVAction,
  DPEVPhaseState,
  StepState,
  SSEEventMap,
} from '../types.js';

// ---- Initial State ----

export const initialDPEVState: DPEVState = {
  sessionId: '',
  phases: [],
  activePhaseIndex: -1,
  executionSteps: [],
  status: 'idle',
};

// ---- Pure Reducer (exported for direct testing) ----

export function dpevReducer(state: DPEVState, action: DPEVAction): DPEVState {
  switch (action.type) {
    case 'PHASE_START': {
      const newPhase: DPEVPhaseState = {
        name: action.phase,
        model: action.model,
        startedAt: Date.now(),
        status: 'active',
        tokens: '',
      };
      const phases = [...state.phases, newPhase];
      return {
        ...state,
        phases,
        activePhaseIndex: phases.length - 1,
        status: 'streaming',
      };
    }

    case 'TOKEN': {
      if (state.activePhaseIndex < 0 || state.activePhaseIndex >= state.phases.length) {
        return state;
      }
      const phases = state.phases.map((p, i) =>
        i === state.activePhaseIndex
          ? { ...p, tokens: p.tokens + action.text }
          : p
      );
      return { ...state, phases };
    }

    case 'PHASE_COMPLETE': {
      const idx = state.phases.findIndex(p => p.name === action.phase);
      if (idx === -1) {
        // Phase was never started (e.g. discovery completes instantly) — add it as complete
        const newPhase: DPEVPhaseState = {
          name: action.phase,
          model: action.model ?? '?',
          startedAt: Date.now(),
          status: 'complete',
          tokens: '',
          completedAt: Date.now(),
        };
        return { ...state, phases: [...state.phases, newPhase] };
      }
      const phases = state.phases.map((p, i) =>
        i === idx
          // substatus is cleared so a finished phase never keeps a stale
          // "Calling <model>…" label next to its checkmark (D-05).
          ? { ...p, status: 'complete' as const, completedAt: Date.now(), substatus: undefined }
          : p
      );
      return { ...state, phases };
    }

    case 'CACHE_HIT': {
      return {
        ...state,
        cacheHit: action.provenance,
        status: 'awaiting-approval',
      };
    }

    case 'PLAN_READY': {
      return { ...state, fixPlan: action.fixPlan };
    }

    case 'PLAN_APPROVAL_REQUIRED': {
      return {
        ...state,
        sessionId: action.sessionId,
        fixPlan: action.fixPlan,
        planApprovalPending: true,
        status: 'plan-approval' as const,
      };
    }

    case 'STEP_UPDATE': {
      const stepStatus = action.status as StepState['status'];
      const existingIdx = state.executionSteps.findIndex(
        s => s.stepIndex === action.stepIndex
      );
      let executionSteps: StepState[];
      if (existingIdx >= 0) {
        executionSteps = state.executionSteps.map((s, i) =>
          i === existingIdx
            ? {
                ...s,
                status: stepStatus,
                stdout: action.stdout ?? s.stdout,
                stderr: action.stderr ?? s.stderr,
                // D-17: a later partial update (e.g. status-only) must not erase
                // the command/risk/target/total captured on the first event.
                command: action.command ?? s.command,
                risk: action.risk ?? s.risk,
                target: action.target ?? s.target,
                total: action.total ?? s.total,
              }
            : s
        );
      } else {
        executionSteps = [
          ...state.executionSteps,
          {
            stepIndex: action.stepIndex,
            total: action.total ?? 0,
            command: action.command ?? '',
            risk: action.risk ?? '',
            status: stepStatus,
            stdout: action.stdout,
            stderr: action.stderr,
            target: action.target,
          },
        ];
      }
      const newStatus = state.status !== 'executing' && state.status !== 'awaiting-approval'
        ? 'executing' as const
        : state.status;
      return { ...state, executionSteps, status: newStatus };
    }

    case 'APPROVAL_REQUIRED': {
      return {
        ...state,
        pendingApproval: {
          command: action.command,
          riskLevel: action.riskLevel,
          target: action.target,
          stepIndex: action.stepIndex,
        },
        status: 'awaiting-approval',
      };
    }

    case 'APPROVAL_RESPONSE': {
      // Plan-level approval response: the user approved/rejected the entire fix plan
      // before any step has executed. Route to 'executing' (begin execution) on approve
      // and 'complete' (abort pipeline) on reject.
      if (state.planApprovalPending) {
        return {
          ...state,
          planApprovalPending: false,
          status: action.approved ? 'executing' as const : 'complete' as const,
        };
      }
      // Step-level approval response (existing behaviour): resume execution.
      // Resume to 'executing' if we have execution steps, otherwise 'streaming'
      const resumeStatus = state.executionSteps.length > 0 ? 'executing' as const : 'streaming' as const;
      return {
        ...state,
        pendingApproval: undefined,
        status: resumeStatus,
      };
    }

    case 'VERIFICATION_RESULT': {
      return {
        ...state,
        verificationResult: {
          passed: action.passed,
          executionStatus: action.executionStatus,
        },
      };
    }

    case 'COMPLETE': {
      return {
        ...state,
        sessionId: action.sessionId,
        status: 'complete',
      };
    }

    case 'ERROR': {
      return {
        ...state,
        status: 'error',
        errorMessage: action.message,
      };
    }

    // ---- Phase 19.3 observability actions ----

    case 'SUBSTATUS_UPDATE': {
      // Substatus is a property of whatever is running right now. With no active
      // phase there is nowhere to hang it, so the event is dropped.
      if (state.activePhaseIndex < 0 || state.activePhaseIndex >= state.phases.length) {
        return state;
      }
      const phases = state.phases.map((p, i) =>
        i === state.activePhaseIndex ? { ...p, substatus: action.label } : p
      );
      return { ...state, phases };
    }

    case 'PHASE_FOCUS': {
      const maxIdx = Math.max(0, state.phases.length - 1);
      const clamped = Math.max(0, Math.min(maxIdx, action.index));
      return { ...state, focusedPhaseIndex: clamped };
    }

    case 'PHASE_EXPAND': {
      const expandedPhases = {
        ...(state.expandedPhases ?? {}),
        [action.index]: action.expanded,
      };
      return { ...state, expandedPhases };
    }

    case 'USAGE_UPDATE': {
      // Usage typically arrives AFTER PHASE_COMPLETE (the backend emits it at
      // phase-completion time), so match by name rather than by activePhaseIndex.
      // Search right-to-left: a phase name can repeat across a retried pipeline.
      let targetIdx = -1;
      for (let i = state.phases.length - 1; i >= 0; i--) {
        if (state.phases[i].name === action.phase) {
          targetIdx = i;
          break;
        }
      }
      if (targetIdx < 0) return state;
      const phases = state.phases.map((p, i) =>
        i === targetIdx
          ? {
              ...p,
              usage: {
                inputTokens: action.inputTokens,
                outputTokens: action.outputTokens,
                totalTokens: action.totalTokens,
                costUsd: action.costUsd,
              },
            }
          : p
      );
      return { ...state, phases };
    }

    case 'SESSION_SUMMARY': {
      // Data-only action: never touches status (COMPLETE owns that transition).
      return {
        ...state,
        sessionSummary: {
          totalTokens: action.totalTokens,
          totalCostUsd: action.totalCostUsd,
          potentialSavings: action.potentialSavings,
        },
      };
    }

    default:
      return state;
  }
}

// ---- SSE Event → Action Routing (exported for direct testing) ----

/**
 * Maps one SSE event onto the reducer actions it implies.
 *
 * Lives at module scope (rather than inline in useDPEV) so the mapping itself is
 * unit-testable with a mock dispatch — the D-17 field-propagation bug was a routing
 * bug, invisible to reducer-only tests.
 */
export function handleSSEEvent<K extends keyof SSEEventMap>(
  event: K,
  data: SSEEventMap[K],
  dispatch: React.Dispatch<DPEVAction>,
): void {
  switch (event) {
    case 'dpev:phase': {
      const d = data as SSEEventMap['dpev:phase'];
      if (d.status === 'active') {
        dispatch({ type: 'PHASE_START', phase: d.phase, model: d.model });
      } else if (d.status === 'complete') {
        dispatch({ type: 'PHASE_COMPLETE', phase: d.phase, model: d.model });
      }
      break;
    }
    case 'dpev:token': {
      const d = data as SSEEventMap['dpev:token'];
      dispatch({ type: 'TOKEN', text: d.text });
      break;
    }
    case 'dpev:cache-hit': {
      const d = data as SSEEventMap['dpev:cache-hit'];
      dispatch({
        type: 'CACHE_HIT',
        provenance: {
          similarity: d.similarity,
          confidence: d.confidence,
          sourceSessionId: d.sourceSessionId,
          sourceDate: d.sourceDate,
          skillName: d.skillName,
          provider: d.provider,
          resourceType: d.resourceType,
        },
      });
      break;
    }
    case 'dpev:plan': {
      const d = data as SSEEventMap['dpev:plan'];
      dispatch({ type: 'PLAN_READY', fixPlan: d.fixPlan });
      break;
    }
    case 'dpev:plan-approval': {
      const d = data as SSEEventMap['dpev:plan-approval'];
      dispatch({
        type: 'PLAN_APPROVAL_REQUIRED',
        fixPlan: d.fixPlan,
        sessionId: d.sessionId,
      });
      break;
    }
    case 'dpev:verification': {
      const d = data as SSEEventMap['dpev:verification'];
      dispatch({
        type: 'VERIFICATION_RESULT',
        passed: d.passed,
        executionStatus: d.executionStatus,
      });
      break;
    }
    case 'dpev:substatus': {
      const d = data as SSEEventMap['dpev:substatus'];
      dispatch({ type: 'SUBSTATUS_UPDATE', label: d.label, phase: d.phase });
      break;
    }
    case 'dpev:usage': {
      const d = data as SSEEventMap['dpev:usage'];
      dispatch({
        type: 'USAGE_UPDATE',
        phase: d.phase,
        modelId: d.modelId,
        inputTokens: d.inputTokens,
        outputTokens: d.outputTokens,
        totalTokens: d.totalTokens,
        costUsd: d.costUsd,
      });
      break;
    }
    case 'dpev:session_summary': {
      const d = data as SSEEventMap['dpev:session_summary'];
      dispatch({
        type: 'SESSION_SUMMARY',
        totalTokens: d.totalTokens,
        totalCostUsd: d.totalCostUsd,
        potentialSavings: d.potentialSavings,
      });
      break;
    }
    case 'exec:step': {
      const d = data as SSEEventMap['exec:step'];
      dispatch({
        type: 'STEP_UPDATE',
        stepIndex: d.stepIndex,
        status: d.status,
        stdout: d.stdout,
        stderr: d.stderr,
        // D-17: the backend has always sent these; the handler used to drop them,
        // which is why StepCard rendered "[1/0] ✓ []".
        command: d.command,
        risk: d.risk,
        target: d.target,
        total: d.total,
      });
      break;
    }
    case 'exec:approval': {
      const d = data as SSEEventMap['exec:approval'];
      dispatch({
        type: 'APPROVAL_REQUIRED',
        command: d.command,
        riskLevel: d.riskLevel,
        target: d.target,
        stepIndex: d.stepIndex,
      });
      break;
    }
    case 'dpev:complete': {
      const d = data as SSEEventMap['dpev:complete'];
      dispatch({ type: 'COMPLETE', sessionId: d.sessionId, status: d.status });
      break;
    }
    case 'dpev:error': {
      const d = data as SSEEventMap['dpev:error'];
      dispatch({ type: 'ERROR', message: d.message, phase: d.phase });
      break;
    }
  }
}

// ---- React Hook ----

export function useDPEV(apiBaseUrl: string, prompt: string): {
  state: DPEVState;
  dispatch: React.Dispatch<DPEVAction>;
  connected: boolean;
  sseError?: string;
} {
  const [state, dispatch] = useReducer(dpevReducer, initialDPEVState);

  const onSSEEvent = useCallback(
    <K extends keyof SSEEventMap>(event: K, data: SSEEventMap[K]) => {
      handleSSEEvent(event, data, dispatch);
    },
    []
  );

  const { connected, error: sseError } = useSSE(`${apiBaseUrl}/stream/debug`, onSSEEvent, {
    method: 'POST',
    body: { prompt },
  });

  return { state, dispatch, connected, sseError };
}
