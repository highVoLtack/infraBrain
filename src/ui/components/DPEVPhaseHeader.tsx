/**
 * DPEVPhaseHeader - Per-phase header with model name and elapsed timer
 *
 * Shows phase name (uppercased, bold), active model name (dimmed),
 * and a live-updating elapsed time counter for active phases.
 */

import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { statusIcon } from '../theme.js';
import type { DPEVPhaseState } from '../types.js';

export interface DPEVPhaseHeaderProps {
  phase: DPEVPhaseState;
}

function formatElapsed(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return `${minutes}m ${remaining}s`;
}

export function DPEVPhaseHeader({ phase }: DPEVPhaseHeaderProps): React.ReactElement {
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

  return (
    <Box gap={1}>
      <Text>{icon}</Text>
      <Text bold>{phase.name.toUpperCase()}</Text>
      <Text dimColor>{phase.model}</Text>
      <Text dimColor>{formatElapsed(elapsedSeconds)}</Text>
    </Box>
  );
}
