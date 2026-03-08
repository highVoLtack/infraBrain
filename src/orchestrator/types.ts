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

export type FixStep = z.infer<typeof FixStepSchema>;
export type FixPlan = z.infer<typeof FixPlanSchema>;
export type SkillSelection = z.infer<typeof SkillSelectionSchema>;

export interface OrchestratorResult {
  skill: SkillFile;
  diagnosis: string;
  plan?: FixPlan;
  planMarkdown?: string;
}
