/**
 * DPEVPhaseHeader - Per-phase header with model name, elapsed timer,
 * timer coloring (D-08), and an optional substatus slot (D-05).
 *
 * Phase 19.3 additions:
 * - timerColor pure function: cyan for LLM phases, yellow for execution, gray when complete
 * - substatus prop: renders "⟁ {label}" below the header row while the phase is active
 */

import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { statusIcon } from '../theme.js';
import type { DPEVPhaseState } from '../types.js';

export interface DPEVPhaseHeaderProps {
  phase: DPEVPhaseState;
  substatus?: string;
}

function formatElapsed(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return `${minutes}m ${remaining}s`;
}

/**
 * Pure function: choose the timer color for a phase's current status (D-08).
 *
 * - complete → gray (the phase fades once it is done)
 * - execution → yellow (shell work, the risky part)
 * - everything else (routing / discovery / diagnosis / plan / verification, plus any
 *   future LLM phase such as distillation) → cyanBright
 *
 * `complete` is checked first so a finished execution phase fades to gray rather than
 * staying yellow. Exported for unit testing.
 */
export function timerColor(phaseName: string, status: string): string {
  if (status === 'complete') return 'gray';
  if (phaseName === 'execution') return 'yellow';
  return 'cyanBright';
}

export function DPEVPhaseHeader({ phase, substatus }: DPEVPhaseHeaderProps): React.ReactElement {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    // Only tick for truly live phases. In replay mode, buildReplayState
    // may temporarily set status='active' with a pre-computed completedAt;
    // those should render a fixed elapsed time, not a running timer.
    if (phase.status === 'active' && phase.completedAt === undefined) {
      const interval = setInterval(() => {
        setNow(Date.now());
      }, 1000);
      return () => clearInterval(interval);
    }
    return undefined;
  }, [phase.status, phase.completedAt]);

  const endTime = phase.completedAt ?? now;
  const elapsedSeconds = Math.floor((endTime - phase.startedAt) / 1000);
  const icon = statusIcon(phase.status);
  const color = timerColor(phase.name, phase.status);
  const isActive = phase.status === 'active';

  // Fall back to the phase.substatus field (set by SUBSTATUS_UPDATE) when the caller
  // passes no explicit prop, so a panel can render headers without threading the label
  // through for every phase. An explicit prop always wins.
  const effectiveSubstatus = substatus ?? phase.substatus;

  return (
    <Box flexDirection="column">
      <Box gap={1}>
        <Text>{icon}</Text>
        <Text bold>{phase.name.toUpperCase()}</Text>
        <Text dimColor>{phase.model}</Text>
        <Text bold={isActive} dimColor={phase.status === 'complete'} color={color}>
          {formatElapsed(elapsedSeconds)}
        </Text>
      </Box>
      {isActive && effectiveSubstatus ? (
        <Box marginLeft={2}>
          <Text dimColor>{`⟁ ${effectiveSubstatus}`}</Text>
        </Box>
      ) : null}
    </Box>
  );
}
