import type { SkillFile } from '../skills/types.js';
import { encodeForLLM, measureSavings } from '../llm/toon-encoder.js';

const DEV_MODE = process.env.NODE_ENV !== 'production';

/**
 * Mandatory execution protocol injected into every skill's system prompt.
 * Prevents hallucination of container names, IPs, PIDs, and placeholder values.
 */
const MANDATORY_EXECUTION_PROTOCOL = `
## MANDATORY EXECUTION PROTOCOL

You are NOT a tutor. You are a production execution engine.
NEVER use placeholders like <...>, [PID], or example names.
If data is missing from the Discovery section, your first step MUST be a READ command to find it.
If you provide a Fix Plan with non-existent IDs or names, the system will halt and you will fail.
NEVER generate hypothetical examples, sample output, or "assume the following" language.
Every value you reference (container names, IPs, PIDs, ports, file paths) MUST come from actual command output or the Discovery context provided to you.
`.trim();

export interface SkillMessages {
  system: string;
  messages: Array<{ role: 'assistant' | 'user'; content: string }>;
}

/**
 * Build a multi-message conversation from a skill's context.
 * System prompt as system message, skill context (tools + examples) as assistant message,
 * user input as user message.
 *
 * The MANDATORY_EXECUTION_PROTOCOL is prepended to every skill's system prompt
 * to enforce strict grounding in real discovery data.
 *
 * Structured data sections (tools, examples) are TOON-encoded for token efficiency.
 * System prompt and user input remain plain text.
 */
export function buildMessages(skill: SkillFile, userInput: string): SkillMessages {
  const contextParts: string[] = [];

  if (skill.sections.tools) {
    if (DEV_MODE) {
      const savings = measureSavings(skill.sections.tools);
      console.log(`[DEV] TOON Tools: ${savings.jsonTokens} (JSON) -> ${savings.toonTokens} (TOON) | Saved: ${savings.savingsPercent.toFixed(1)}%`);
    }
    contextParts.push(encodeForLLM(skill.sections.tools, 'Tools'));
  }
  if (skill.sections.examples) {
    if (DEV_MODE) {
      const savings = measureSavings(skill.sections.examples);
      console.log(`[DEV] TOON Examples: ${savings.jsonTokens} (JSON) -> ${savings.toonTokens} (TOON) | Saved: ${savings.savingsPercent.toFixed(1)}%`);
    }
    contextParts.push(encodeForLLM(skill.sections.examples, 'Examples'));
  }

  const assistantContent = contextParts.length > 0
    ? contextParts.join('\n\n')
    : 'No additional context available.';

  // Prepend mandatory execution protocol to skill's system prompt
  const system = `${MANDATORY_EXECUTION_PROTOCOL}\n\n${skill.sections.systemPrompt}`;

  return {
    system,
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
