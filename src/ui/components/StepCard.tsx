/**
 * StepCard - Execution step card with risk badge and status
 *
 * Shows step number, command, risk-colored badge, status icon,
 * and auto-expands stdout/stderr on failure or when active.
 */

import React from 'react';
import { Box, Text } from 'ink';
import { Spinner } from '@inkjs/ui';
import { statusIcon, riskColor } from '../theme.js';
import type { StepState } from '../types.js';

export interface StepCardProps {
  step: StepState;
  isActive?: boolean;
}

const STEP_ICONS: Record<string, string> = {
  pending: '\u00B7',   // · middle dot
  success: '\u2713',   // checkmark
  failed: '\u2717',    // cross
  skipped: '\u2013',   // en-dash
};

function truncateOutput(text: string, maxLines: number = 10): string {
  const lines = text.split('\n');
  if (lines.length <= maxLines) return text;
  return lines.slice(-maxLines).join('\n');
}

export function StepCard({ step, isActive }: StepCardProps): React.ReactElement {
  const stepNumber = `${step.stepIndex + 1}/${step.total}`;
  const showOutput = step.status === 'failed' || isActive;
  const color = riskColor(step.risk);

  return (
    <Box flexDirection="column">
      <Box gap={1}>
        <Text dimColor>[{stepNumber}]</Text>
        {step.status === 'running' ? (
          <Spinner label="" />
        ) : (
          <Text>{STEP_ICONS[step.status] ?? '\u00B7'}</Text>
        )}
        <Text>{step.command}</Text>
        <Text color={color}>[{step.risk}]</Text>
        {step.target && <Text dimColor>on {step.target}</Text>}
      </Box>
      {showOutput && step.stdout && (
        <Box marginLeft={4}>
          <Text dimColor>{truncateOutput(step.stdout)}</Text>
        </Box>
      )}
      {showOutput && step.stderr && (
        <Box marginLeft={4}>
          <Text color="red">{truncateOutput(step.stderr)}</Text>
        </Box>
      )}
    </Box>
  );
}
