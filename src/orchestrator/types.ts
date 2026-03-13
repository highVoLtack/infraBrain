import { z } from 'zod';
import type { SkillFile } from '../skills/types.js';

export const FixStepSchema = z.object({
  command: z.string(),
  description: z.string(),
  rollback: z.string(),
  risk: z.enum(['read', 'write', 'destructive']),
});

export const FixPlanSchema = z.object({
  summary: z.string(),
  steps: z.array(FixStepSchema),
  complexity: z.enum(['simple', 'moderate', 'complex']),
});

export const SkillSelectionSchema = z.object({
  selectedSkill: z.string(),
  reasoning: z.string(),
});

/**
 * Schema for a single diagnostic step in the Diagnostic Ladder.
 * Forces the LLM to return structured JSON instead of free-text essays.
 */
export const DiagnosticStepSchema = z.object({
  step: z.number().describe('Step number (0-based)'),
  label: z.string().describe('Short label, e.g. "Container Discovery", "Connection Saturation"'),
  command: z.string().describe('Exact shell command executed (from discovery or diagnostic ladder)'),
  output: z.string().describe('Actual command output observed — NEVER invented or hypothetical'),
  finding: z.string().describe('One-sentence finding derived from the output'),
});

/**
 * Schema for the complete structured diagnosis returned by the LLM.
 * Replaces free-text diagnosis with a strict JSON contract.
 */
export const StructuredDiagnosisSchema = z.object({
  steps: z.array(DiagnosticStepSchema).min(1).max(5).describe('Diagnostic steps, max 5'),
  rootCause: z.string().describe('One-sentence root cause with evidence references'),
  correlation: z.string().describe('Cross-domain correlation: how discovery data maps to the root cause'),
  fixPlan: z.array(z.object({
    command: z.string().describe('Exact command to execute using docker exec <container> — no placeholders, no bare psql'),
    risk: z.enum(['read', 'write', 'destructive']),
    expected: z.string().max(80).describe('One short sentence describing expected outcome, e.g. "Terminates 18 idle connections". No SQL tables, no multi-line output.'),
  })).min(1).max(5).describe('Fix steps, max 5'),
});

export type FixStep = z.infer<typeof FixStepSchema>;
export type FixPlan = z.infer<typeof FixPlanSchema>;
export type SkillSelection = z.infer<typeof SkillSelectionSchema>;
export type DiagnosticStep = z.infer<typeof DiagnosticStepSchema>;
export type StructuredDiagnosis = z.infer<typeof StructuredDiagnosisSchema>;

export interface OrchestratorResult {
  skill: SkillFile;
  diagnosis: string;
  structuredDiagnosis?: StructuredDiagnosis;
  plan?: FixPlan;
  planMarkdown?: string;
}
