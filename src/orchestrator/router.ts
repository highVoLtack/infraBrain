import { generateObject } from 'ai';
import type { LanguageModel } from 'ai';
import type { SkillRegistry } from '../skills/registry.js';
import type { SkillFile } from '../skills/types.js';
import { SkillSelectionSchema } from './types.js';
import { buildRoutingPrompt } from './context.js';

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
 * Select the most appropriate skill for a user query.
 * If skillOverride is provided, looks up directly in registry (skips LLM).
 * Otherwise uses LLM-based routing via generateObject.
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

  // LLM routing path
  const skills = registry.list();
  const prompt = buildRoutingPrompt(skills, userInput);

  const { object } = await generateObject({
    model,
    schema: SkillSelectionSchema,
    system: 'You are a skill router. Given a user query and available skills, select the most appropriate skill.',
    prompt,
  });

  const skill = registry.get(object.selectedSkill);
  if (!skill) {
    throw new Error(`LLM selected skill "${object.selectedSkill}" which is not in registry`);
  }

  return { skill, reasoning: object.reasoning };
}
