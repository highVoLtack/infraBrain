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
import { Box, Text } from 'ink';
import { useDPEV } from '../hooks/useDPEV.js';
import { StreamingText } from '../components/StreamingText.js';
import { DPEVPhaseHeader } from '../components/DPEVPhaseHeader.js';
import { StepCard } from '../components/StepCard.js';
import { ApprovalWrite } from '../components/ApprovalWrite.js';
import { ApprovalDestructive } from '../components/ApprovalDestructive.js';
import { CacheHitBanner } from '../components/CacheHitBanner.js';
import type { DPEVState } from '../types.js';

export interface DPEVPanelProps {
  apiBaseUrl: string;
  prompt?: string;
  replaySession?: DPEVState;
}

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

// ---- Panel Component ----

function DPEVPanelContent({
  state,
  apiBaseUrl,
  onCacheResponse,
  onApprovalResponse,
}: {
  state: DPEVState;
  apiBaseUrl: string;
  onCacheResponse: (useCache: boolean) => void;
  onApprovalResponse: (approved: boolean) => void;
}): React.ReactElement {
  const showCacheHit = shouldShowCacheHitBanner(state);

  return (
    <Box flexDirection="column" flexGrow={1}>
      {/* DPEV Phase Accordion */}
      {state.phases.map((phase, i) => (
        <Box key={`phase-${i}`} flexDirection="column">
          <DPEVPhaseHeader phase={phase} />
          {phase.status === 'active' && (
            <Box marginLeft={2}>
              <StreamingText text={phase.tokens} />
            </Box>
          )}
        </Box>
      ))}

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

      {/* Pending Approval Gate */}
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

      {/* Completion Footer */}
      {state.status === 'complete' && (
        <Box marginTop={1}>
          <Text color="green" bold>Session complete</Text>
          {state.sessionId && <Text dimColor> ({state.sessionId.slice(0, 8)})</Text>}
        </Box>
      )}

      {/* Error Footer */}
      {state.status === 'error' && (
        <Box marginTop={1}>
          <Text color="red" bold>Error occurred</Text>
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
  const { state, dispatch } = useDPEV(apiBaseUrl, prompt);
  const [cacheError, setCacheError] = useState<string | undefined>();
  const [approvalError, setApprovalError] = useState<string | undefined>();

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

  const handleApprovalResponse = useCallback(
    async (approved: boolean) => {
      if (!state.pendingApproval) return;
      try {
        setApprovalError(undefined);
        const res = await fetch(`${apiBaseUrl}/stream/execute/approve`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
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
    [apiBaseUrl, state.pendingApproval, dispatch]
  );

  return (
    <Box flexDirection="column" flexGrow={1}>
      <DPEVPanelContent
        state={state}
        apiBaseUrl={apiBaseUrl}
        onCacheResponse={handleCacheResponse}
        onApprovalResponse={handleApprovalResponse}
      />
      {cacheError && <Text color="red">{cacheError}</Text>}
      {approvalError && <Text color="red">{approvalError}</Text>}
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
