import { generateObject } from 'ai';
import type { LanguageModel } from 'ai';
import type { SkillRegistry, EnrichedSkillSummary } from '../skills/registry.js';
import type { SkillFile } from '../skills/types.js';
import { LLM_RETRY_OPTIONS } from '../llm/retry.js';
import { SkillSelectionSchema } from './types.js';
import { buildRoutingPrompt, ROUTING_CONSTITUTION } from './context.js';

export interface SelectSkillOptions {
  model: LanguageModel;
  userInput: string;
  registry: SkillRegistry;
  skillOverride?: string;
}

export interface SelectSkillResult {
  skill: SkillFile;
  reasoning: string;
}

/**
 * Level 0 pre-filter: prune skill candidates by positive trigger match
 * and negative trigger exclusion. If no candidates remain after filtering,
 * returns ALL skills as a safety net for LLM routing.
 */
export function preFilterSkills(
  skills: EnrichedSkillSummary[],
  userInput: string,
): EnrichedSkillSummary[] {
  const input = userInput.toLowerCase();

  // Step 1: Find skills with matching positive triggers (substring, case-insensitive)
  const positiveMatches = skills.filter(skill =>
    skill.triggers.some(trigger => input.includes(trigger.toLowerCase()))
  );

  // Step 2: Exclude skills with matching negative triggers
  const afterNegative = positiveMatches.filter(skill =>
    !skill.negative_triggers.some(nt => input.includes(nt.toLowerCase()))
  );

  // Step 3: If no candidates remain after filtering, return ALL skills (LLM safety net)
  if (afterNegative.length === 0) return skills;

  return afterNegative;
}

/**
 * Select the most appropriate skill for a user query.
 * Uses two-tier routing: Level 0 pre-filter (triggers) then Level 1 LLM routing.
 * If skillOverride is provided, looks up directly in registry (skips both tiers).
 * If pre-filter yields exactly 1 candidate, skips LLM call.
 */
export async function selectSkill(options: SelectSkillOptions): Promise<SelectSkillResult> {
  const { model, userInput, registry, skillOverride } = options;

  // Manual override path
  if (skillOverride) {
    const skill = registry.get(skillOverride);
    if (!skill) {
      throw new Error(`Skill "${skillOverride}" not found in registry`);
    }
    return { skill, reasoning: 'Manual override' };
  }

  // Two-tier routing: Level 0 pre-filter + Level 1 LLM
  const allSkills = registry.list();
  const candidates = preFilterSkills(allSkills, userInput);

  // Single-candidate shortcut: skip LLM call
  if (candidates.length === 1) {
    const skill = registry.get(candidates[0].name);
    if (!skill) {
      throw new Error(`Pre-filter selected skill "${candidates[0].name}" which is not in registry`);
    }
    return { skill, reasoning: 'Single trigger match (pre-filter)' };
  }

  // Level 1: LLM routing with enriched prompt
  const prompt = buildRoutingPrompt(candidates, userInput);

  const { object } = await generateObject({
    model,
    schema: SkillSelectionSchema,
    system: ROUTING_CONSTITUTION,
    prompt,
    ...LLM_RETRY_OPTIONS,
  });

  const skill = registry.get(object.selectedSkill);
  if (!skill) {
    throw new Error(`LLM selected skill "${object.selectedSkill}" which is not in registry`);
  }

  return { skill, reasoning: object.reasoning };
}
