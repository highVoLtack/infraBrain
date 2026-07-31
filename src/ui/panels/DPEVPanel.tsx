/**
 * DPEVPanel - Center panel with streaming DPEV accordion
 *
 * Renders live DPEV progression with collapsing accordion:
 * - Completed phases show 1-line summary (collapsed)
 * - Active phase is fully expanded with streaming text
 * - Cache hit interruption renders CacheHitBanner inline
 * - Execution steps render as StepCard components with approval gates
 *
 * Supports two modes:
 * - Live mode: prompt provided, uses useDPEV hook for SSE streaming
 * - Replay mode: replaySession provided, renders read-only past session
 */

import React, { useState, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import { useDPEV } from '../hooks/useDPEV.js';
import { StreamingText } from '../components/StreamingText.js';
import { MarkdownView } from '../components/MarkdownView.js';
import { DPEVPhaseHeader } from '../components/DPEVPhaseHeader.js';
import { StepCard } from '../components/StepCard.js';
import { ApprovalWrite } from '../components/ApprovalWrite.js';
import { ApprovalDestructive } from '../components/ApprovalDestructive.js';
import { CacheHitBanner } from '../components/CacheHitBanner.js';
import { PlanView } from '../components/PlanView.js';
import type { DPEVAction, DPEVPhaseState, DPEVState } from '../types.js';

export interface DPEVPanelProps {
  apiBaseUrl: string;
  prompt?: string;
  replaySession?: DPEVState;
}

/** D-11: nulls mean "the provider stayed silent" — never render 0 / $0.00. */
const EN_DASH = '–';
/** D-25: the v2.0 compression columns are reserved, not empty. */
const USAGE_V2_SUFFIX = ' · [distilled: — | saved: — (v2.0)]';

// ---- Pure helper: determine if cache hit banner should show ----

export function shouldShowCacheHitBanner(state: DPEVState): boolean {
  return (
    state.cacheHit !== undefined &&
    state.status === 'awaiting-approval' &&
    state.pendingApproval === undefined
  );
}

// ---- Pure helper: determine which approval component to render ----

export function getApprovalType(riskLevel: string): 'write' | 'destructive' {
  return riskLevel === 'destructive' ? 'destructive' : 'write';
}

// ---- Pure helper: which phase the focus cursor sits on right now (D-03) ----

/**
 * `focusedPhaseIndex` is undefined until the user presses a navigation key. Until then
 * the cursor virtually rests on the most recent phase, so the first Up keystroke moves
 * to the previous phase rather than off the end of the list. This is a read-time default
 * only — dispatching PHASE_FOCUS during render would loop.
 */
export function virtualFocusedIndex(state: DPEVState): number {
  return state.focusedPhaseIndex ?? (state.phases.length > 0 ? state.phases.length - 1 : -1);
}

// ---- Pure helper: is the phase-navigation key handler allowed to run? ----

/**
 * Any open approval gate owns the keyboard. Stealing Enter/Esc from an ApprovalWrite or
 * a CacheHitBanner would silently answer a Y/N prompt the user never saw the answer to.
 */
export function isPhaseInputActive(state: DPEVState): boolean {
  return (
    state.pendingApproval === undefined &&
    state.status !== 'awaiting-approval' &&
    state.status !== 'plan-approval'
  );
}

// ---- Pure helper: phase-accordion keyboard map (D-03) ----

/** The subset of Ink's `Key` this handler reads — keeps the helper testable without Ink. */
export interface PhaseInputKey {
  upArrow?: boolean;
  downArrow?: boolean;
  return?: boolean;
  escape?: boolean;
}

/**
 * ↑/k and ↓/j move focus; Enter expands a completed phase; Esc collapses.
 *
 * Focus indices are dispatched unclamped — `PHASE_FOCUS` clamps in the reducer, so the
 * bounds rule lives in exactly one place. Enter is a deliberate no-op on an active phase:
 * it is already streaming its body, and "expanding" it would mean nothing (D-20).
 */
export function handlePhaseInput(
  state: DPEVState,
  input: string,
  key: PhaseInputKey,
  dispatch: (action: DPEVAction) => void,
): void {
  if (state.phases.length === 0) return;
  const currentIdx = virtualFocusedIndex(state);

  if (key.upArrow || input === 'k') {
    dispatch({ type: 'PHASE_FOCUS', index: currentIdx - 1 });
  } else if (key.downArrow || input === 'j') {
    dispatch({ type: 'PHASE_FOCUS', index: currentIdx + 1 });
  } else if (key.return) {
    const focusedPhase = state.phases[currentIdx];
    if (focusedPhase && focusedPhase.status !== 'active') {
      dispatch({ type: 'PHASE_EXPAND', index: currentIdx, expanded: true });
    }
  } else if (key.escape) {
    dispatch({ type: 'PHASE_EXPAND', index: currentIdx, expanded: false });
  }
}

// ---- Pure helper: per-phase usage line (D-09 / D-11 / D-25) ----

/**
 * `in:1687 · out:– · total:– · $– · [distilled: — | saved: — (v2.0)]`
 *
 * Returns undefined when the phase reported no usage at all, so the caller can skip the
 * row rather than print a line of dashes.
 */
export function formatUsageLine(usage: DPEVPhaseState['usage']): string | undefined {
  if (!usage) return undefined;
  const out = usage.outputTokens ?? EN_DASH;
  const total = usage.totalTokens ?? EN_DASH;
  const cost = usage.costUsd !== null && usage.costUsd !== undefined
    ? usage.costUsd.toFixed(4)
    : EN_DASH;
  return `in:${usage.inputTokens} · out:${out} · total:${total} · $${cost}${USAGE_V2_SUFFIX}`;
}

// ---- Panel Component ----

function DPEVPanelContent({
  state,
  apiBaseUrl,
  onCacheResponse,
  onApprovalResponse,
  onPlanApprovalResponse,
}: {
  state: DPEVState;
  apiBaseUrl: string;
  onCacheResponse: (useCache: boolean) => void;
  onApprovalResponse: (approved: boolean) => void;
  onPlanApprovalResponse: (approved: boolean) => void;
}): React.ReactElement {
  const showCacheHit = shouldShowCacheHitBanner(state);
  const focusedIdx = virtualFocusedIndex(state);

  return (
    <Box flexDirection="column" flexGrow={1}>
      {/* DPEV Phase Accordion: focus cursor + substatus + usage + expandable body */}
      {state.phases.map((phase, i) => {
        const isFocused = focusedIdx === i;
        // Active phases are open by default; completed ones stay collapsed until the
        // user expands them (D-01/D-02). Replay passes expandedPhases={} -> all closed (D-04).
        const isExpanded = state.expandedPhases?.[i] ?? (phase.status === 'active');
        const usageLine = formatUsageLine(phase.usage);

        return (
          <Box key={`phase-${phase.name}-${phase.startedAt}`} flexDirection="column">
            <Box>
              <Text color={isFocused ? 'cyanBright' : undefined}>
                {isFocused ? '▸ ' : '  '}
              </Text>
              <DPEVPhaseHeader phase={phase} substatus={phase.substatus} />
            </Box>

            {/* Cost signal stays visible even while the body is collapsed (D-09) */}
            {usageLine && (
              <Box marginLeft={2}>
                <Text dimColor>{usageLine}</Text>
              </Box>
            )}

            {/* D-20: live tokens stay on StreamingText; only a finished phase
                re-renders through MarkdownView, and only when expanded. */}
            {phase.status === 'active' ? (
              <Box marginLeft={2}>
                <StreamingText text={phase.tokens} />
              </Box>
            ) : isExpanded && phase.tokens.length > 0 ? (
              <Box marginLeft={2}>
                <MarkdownView>{phase.tokens}</MarkdownView>
              </Box>
            ) : null}
          </Box>
        );
      })}

      {/* Cache Hit Banner (inline interruption) */}
      {showCacheHit && state.cacheHit && (
        <CacheHitBanner
          confidence={state.cacheHit.confidence}
          similarity={state.cacheHit.similarity}
          sourceSessionId={state.cacheHit.sourceSessionId}
          sourceDate={state.cacheHit.sourceDate}
          skillName={state.cacheHit.skillName}
          provider={state.cacheHit.provider}
          resourceType={state.cacheHit.resourceType}
          onResponse={onCacheResponse}
        />
      )}

      {/* Plan Approval: structured plan + Y/N gate when status === 'plan-approval' */}
      {state.status === 'plan-approval' && state.fixPlan && (
        <Box flexDirection="column" marginTop={1}>
          <PlanView fixPlan={state.fixPlan} />
          <Box marginTop={1}>
            <ApprovalWrite
              command="Execute this plan?"
              riskLevel="write"
              onResponse={onPlanApprovalResponse}
            />
          </Box>
        </Box>
      )}

      {/* Execution Steps */}
      {state.executionSteps.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>Execution</Text>
          {state.executionSteps.map((step) => (
            <StepCard
              key={`step-${step.stepIndex}`}
              step={step}
              isActive={step.status === 'running'}
            />
          ))}
        </Box>
      )}

      {/* Pending Approval Gate (per-step approval during execution) */}
      {state.pendingApproval && state.status === 'awaiting-approval' && (
        <Box marginTop={1}>
          {getApprovalType(state.pendingApproval.riskLevel) === 'destructive' ? (
            <ApprovalDestructive
              command={state.pendingApproval.command}
              target={state.pendingApproval.target}
              onResponse={onApprovalResponse}
            />
          ) : (
            <ApprovalWrite
              command={state.pendingApproval.command}
              riskLevel={state.pendingApproval.riskLevel}
              onResponse={onApprovalResponse}
            />
          )}
        </Box>
      )}

      {/* Verification Result (data-only: renders regardless of status) */}
      {state.verificationResult && (
        <Box marginTop={1} flexDirection="column">
          <Text bold>Verification</Text>
          {state.verificationResult.passed ? (
            <Box gap={1}>
              <Text color="green">{'\u2713'}</Text>
              <Text color="green" bold>Fix verified</Text>
            </Box>
          ) : (
            <Box gap={1}>
              <Text color="red">{'\u2717'}</Text>
              <Text color="red" bold>Fix failed</Text>
              <Text dimColor>({state.verificationResult.executionStatus})</Text>
            </Box>
          )}
        </Box>
      )}

      {/* Completion Footer + cumulative session usage (D-12 / D-24) */}
      {state.status === 'complete' && (
        <Box marginTop={1} flexDirection="column">
          <Box>
            <Text color="green" bold>Session complete</Text>
            {state.sessionId && <Text dimColor> ({state.sessionId.slice(0, 8)})</Text>}
          </Box>
          {state.sessionSummary && (
            <>
              <Text dimColor>
                {`Session: ${state.sessionSummary.totalTokens} tokens · $${state.sessionSummary.totalCostUsd.toFixed(2)}`}
              </Text>
              <Text dimColor>
                {`Saved via Memory: $${(state.sessionSummary.potentialSavings ?? 0).toFixed(2)} (v2.0)`}
              </Text>
            </>
          )}
        </Box>
      )}

      {/* Error Footer */}
      {state.status === 'error' && (
        <Box marginTop={1} flexDirection="column">
          <Text color="red" bold>Error</Text>
          {state.errorMessage && <Text color="red" wrap="wrap">{state.errorMessage}</Text>}
        </Box>
      )}
    </Box>
  );
}

// ---- Live Mode Wrapper (uses useDPEV hook) ----

function LiveDPEVPanel({
  apiBaseUrl,
  prompt,
}: {
  apiBaseUrl: string;
  prompt: string;
}): React.ReactElement {
  const { state, dispatch, connected, sseError } = useDPEV(apiBaseUrl, prompt);
  const [cacheError, setCacheError] = useState<string | undefined>();
  const [approvalError, setApprovalError] = useState<string | undefined>();
  const [planApprovalError, setPlanApprovalError] = useState<string | undefined>();

  const handleCacheResponse = useCallback(
    async (useCache: boolean) => {
      try {
        setCacheError(undefined);
        const res = await fetch(`${apiBaseUrl}/stream/debug/approve`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: state.sessionId, useCache }),
        });
        if (res.ok) {
          dispatch({ type: 'APPROVAL_RESPONSE', approved: useCache });
        } else {
          setCacheError(`Cache approval failed: HTTP ${res.status}`);
        }
      } catch (err) {
        setCacheError(err instanceof Error ? err.message : 'Cache approval failed');
      }
    },
    [apiBaseUrl, state.sessionId, dispatch]
  );

  const handlePlanApprovalResponse = useCallback(
    async (approved: boolean) => {
      try {
        setPlanApprovalError(undefined);
        const res = await fetch(`${apiBaseUrl}/stream/debug/plan-approve`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: state.sessionId, approved }),
        });
        if (res.ok) {
          dispatch({ type: 'APPROVAL_RESPONSE', approved });
        } else {
          setPlanApprovalError(`Plan approval failed: HTTP ${res.status}`);
        }
      } catch (err) {
        setPlanApprovalError(err instanceof Error ? err.message : 'Plan approval failed');
      }
    },
    [apiBaseUrl, state.sessionId, dispatch]
  );

  const handleApprovalResponse = useCallback(
    async (approved: boolean) => {
      if (!state.pendingApproval) return;
      try {
        setApprovalError(undefined);
        // Route to stream-debug step-approve (Plan 01 moved all approvals
        // through /stream/debug to keep a single SSE connection for the UI).
        const res = await fetch(`${apiBaseUrl}/stream/debug/step-approve`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId: state.sessionId,
            stepIndex: state.pendingApproval.stepIndex,
            approved,
          }),
        });
        if (res.ok) {
          dispatch({ type: 'APPROVAL_RESPONSE', approved });
        } else {
          setApprovalError(`Approval failed: HTTP ${res.status}`);
        }
      } catch (err) {
        setApprovalError(err instanceof Error ? err.message : 'Approval failed');
      }
    },
    [apiBaseUrl, state.sessionId, state.pendingApproval, dispatch]
  );

  // Phase accordion navigation (D-03). Disabled whenever an approval gate owns the
  // keyboard so Y/N keystrokes are never intercepted.
  useInput(
    (input, key) => {
      handlePhaseInput(state, input, key, dispatch);
    },
    { isActive: isPhaseInputActive(state) },
  );

  return (
    <Box flexDirection="column" flexGrow={1}>
      {/* Prompt + status */}
      <Box paddingX={1} marginBottom={1}>
        <Text color="cyanBright" bold>{'> '}</Text>
        <Text>{prompt}</Text>
        <Text dimColor>  {
          state.status === 'complete' ? '' :
          state.status === 'error' ? '' :
          sseError ? `(error: ${sseError})` :
          connected ? '(streaming...)' :
          state.phases.length > 0 ? '' :
          '(connecting...)'
        }</Text>
      </Box>
      <DPEVPanelContent
        state={state}
        apiBaseUrl={apiBaseUrl}
        onCacheResponse={handleCacheResponse}
        onApprovalResponse={handleApprovalResponse}
        onPlanApprovalResponse={handlePlanApprovalResponse}
      />
      {cacheError && <Text color="red">{cacheError}</Text>}
      {approvalError && <Text color="red">{approvalError}</Text>}
      {planApprovalError && <Text color="red">{planApprovalError}</Text>}
    </Box>
  );
}

// ---- Main Export ----

export function DPEVPanel({
  apiBaseUrl,
  prompt,
  replaySession,
}: DPEVPanelProps): React.ReactElement {
  // Replay mode: render read-only state
  if (replaySession) {
    return (
      <DPEVPanelContent
        state={replaySession}
        apiBaseUrl={apiBaseUrl}
        onCacheResponse={() => {}}
        onApprovalResponse={() => {}}
        onPlanApprovalResponse={() => {}}
      />
    );
  }

  // Live mode: wire useDPEV hook
  if (prompt) {
    return <LiveDPEVPanel apiBaseUrl={apiBaseUrl} prompt={prompt} />;
  }

  // Idle state
  return (
    <Box flexDirection="column" flexGrow={1}>
      <Text dimColor>No active session</Text>
    </Box>
  );
}
