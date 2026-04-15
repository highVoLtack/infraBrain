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
          ? { ...p, status: 'complete' as const, completedAt: Date.now() }
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

    case 'STEP_UPDATE': {
      const stepStatus = action.status as StepState['status'];
      const existingIdx = state.executionSteps.findIndex(
        s => s.stepIndex === action.stepIndex
      );
      let executionSteps: StepState[];
      if (existingIdx >= 0) {
        executionSteps = state.executionSteps.map((s, i) =>
          i === existingIdx
            ? { ...s, status: stepStatus, stdout: action.stdout ?? s.stdout, stderr: action.stderr ?? s.stderr }
            : s
        );
      } else {
        executionSteps = [
          ...state.executionSteps,
          {
            stepIndex: action.stepIndex,
            total: 0,
            command: '',
            risk: '',
            status: stepStatus,
            stdout: action.stdout,
            stderr: action.stderr,
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
      // Resume to 'executing' if we have execution steps, otherwise 'streaming'
      const resumeStatus = state.executionSteps.length > 0 ? 'executing' as const : 'streaming' as const;
      return {
        ...state,
        pendingApproval: undefined,
        status: resumeStatus,
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

    default:
      return state;
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

  const handleSSEEvent = useCallback(
    <K extends keyof SSEEventMap>(event: K, data: SSEEventMap[K]) => {
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
        case 'exec:step': {
          const d = data as SSEEventMap['exec:step'];
          dispatch({
            type: 'STEP_UPDATE',
            stepIndex: d.stepIndex,
            status: d.status,
            stdout: d.stdout,
            stderr: d.stderr,
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
    },
    []
  );

  const { connected, error: sseError } = useSSE(`${apiBaseUrl}/stream/debug`, handleSSEEvent, {
    method: 'POST',
    body: { prompt },
  });

  return { state, dispatch, connected, sseError };
}
