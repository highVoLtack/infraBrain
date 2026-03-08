import type { SkillFile } from '../skills/types.js';
import { encodeForLLM } from '../llm/toon-encoder.js';

export interface SkillMessages {
  system: string;
  messages: Array<{ role: 'assistant' | 'user'; content: string }>;
}

/**
 * Build a multi-message conversation from a skill's context.
 * System prompt as system message, skill context (tools + examples) as assistant message,
 * user input as user message.
 *
 * Structured data sections (tools, examples) are TOON-encoded for token efficiency.
 * System prompt and user input remain plain text.
 */
export function buildMessages(skill: SkillFile, userInput: string): SkillMessages {
  const contextParts: string[] = [];

  if (skill.sections.tools) {
    contextParts.push(encodeForLLM(skill.sections.tools, 'Tools'));
  }
  if (skill.sections.examples) {
    contextParts.push(encodeForLLM(skill.sections.examples, 'Examples'));
  }

  const assistantContent = contextParts.length > 0
    ? contextParts.join('\n\n')
    : 'No additional context available.';

  return {
    system: skill.sections.systemPrompt,
    messages: [
      { role: 'assistant', content: assistantContent },
      { role: 'user', content: userInput },
    ],
  };
}

/**
 * Build a routing prompt listing all skill summaries for LLM-based selection.
 * Skills array is TOON-encoded for token efficiency (uniform array = tabular format).
 */
export function buildRoutingPrompt(
  skills: Array<{ name: string; description: string }>,
  userInput: string,
): string {
  const skillList = encodeForLLM(skills, 'Available skills');

  return `User query: ${userInput}\n\n${skillList}`;
}
