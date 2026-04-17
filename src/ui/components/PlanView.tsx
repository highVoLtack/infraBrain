/**
 * PlanView - Structured fix plan rendering
 *
 * Renders a FixPlan object as a numbered list of steps with risk-colored
 * badges, descriptions, and an optional summary + complexity indicator.
 *
 * Replaces the raw chalk-coloured planTable string from the pipeline with
 * a native Ink component so the Ink UI can render the plan without relying
 * on ANSI colour escapes that differ between chalk and Ink.
 */

import React from 'react';
import { Box, Text } from 'ink';
import { riskColor } from '../theme.js';

export interface PlanStep {
  index: number;
  command: string;
  description: string;
  risk: 'read' | 'write' | 'destructive';
  rollback: string;
}

/**
 * Pure function: extract renderable plan steps from a fixPlan object.
 * Tolerates undefined, null, and malformed inputs -- returns [] instead of
 * throwing so callers can treat the plan as "empty" when upstream data is
 * missing.
 */
export function formatPlanSteps(fixPlan: object | undefined): PlanStep[] {
  if (!fixPlan || typeof fixPlan !== 'object') return [];
  const plan = fixPlan as {
    steps?: Array<{
      command?: string;
      description?: string;
      risk?: string;
      rollback?: string;
    }>;
  };
  if (!Array.isArray(plan.steps)) return [];
  return plan.steps.map((step, i) => ({
    index: i,
    command: step.command ?? '',
    description: step.description ?? '',
    risk: (step.risk as PlanStep['risk']) ?? 'read',
    rollback: step.rollback ?? '',
  }));
}

export interface PlanViewProps {
  fixPlan: object | undefined;
}

export function PlanView({ fixPlan }: PlanViewProps): React.ReactElement {
  const steps = formatPlanSteps(fixPlan);
  const plan = fixPlan as { summary?: string; complexity?: string } | undefined;

  if (steps.length === 0) {
    return <Text dimColor>No fix plan available</Text>;
  }

  return (
    <Box flexDirection="column">
      {plan?.summary ? <Text bold>{plan.summary}</Text> : null}
      {plan?.complexity ? <Text dimColor>[{plan.complexity}]</Text> : null}
      <Box flexDirection="column" marginTop={1}>
        {steps.map((step) => (
          <Box key={`plan-step-${step.index}`} flexDirection="column">
            <Box gap={1}>
              <Text bold>{step.index + 1}.</Text>
              <Text>{step.command}</Text>
              <Text color={riskColor(step.risk)}>[{step.risk}]</Text>
            </Box>
            {step.description ? (
              <Box marginLeft={3}>
                <Text dimColor>{step.description}</Text>
              </Box>
            ) : null}
          </Box>
        ))}
      </Box>
    </Box>
  );
}
