import type { SkillFile } from '../skills/types.js';

export interface SkillMessages {
  system: string;
  messages: Array<{ role: 'assistant' | 'user'; content: string }>;
}

/**
 * Build a multi-message conversation from a skill's context.
 * System prompt as system message, skill context (tools + examples) as assistant message,
 * user input as user message.
 */
export function buildMessages(skill: SkillFile, userInput: string): SkillMessages {
  const contextParts: string[] = [];

  if (skill.sections.tools) {
    contextParts.push(`Tools:\n${skill.sections.tools}`);
  }
  if (skill.sections.examples) {
    contextParts.push(`Examples:\n${skill.sections.examples}`);
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
 */
export function buildRoutingPrompt(
  skills: Array<{ name: string; description: string }>,
  userInput: string,
): string {
  const skillList = skills
    .map((s) => `- ${s.name}: ${s.description}`)
    .join('\n');

  return `User query: ${userInput}\n\nAvailable skills:\n${skillList}`;
}
