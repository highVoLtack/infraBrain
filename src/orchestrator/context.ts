import type { SkillFile } from '../skills/types.js';
import type { ToolDeclaration } from '../skills/types.js';
import type { EnrichedSkillSummary } from '../skills/registry.js';
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

/**
 * Generate a tool list section from a tool map for LLM system prompt injection.
 * Lists each tool with its risk level and optional user privilege info.
 */
export function generateToolList(tools: Record<string, ToolDeclaration>): string {
  const entries = Object.entries(tools);
  if (entries.length === 0) return '';

  const lines = entries.map(([name, decl]) => {
    let line = `- \`${name}\` (${decl.risk})`;
    if (decl.user) {
      line += ` runs as uid ${decl.user}`;
    }
    return line;
  });

  return [
    '## YOUR TOOLS',
    'You have access to EXACTLY these tools:',
    ...lines,
    '',
    'Do NOT use any tool not listed here. If you need a tool not listed, state what you need and STOP.',
  ].join('\n');
}

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
  let system = `${MANDATORY_EXECUTION_PROTOCOL}\n\n${skill.sections.systemPrompt}`;

  // Auto-inject YOUR TOOLS section for new map-format skills
  const tools = skill.frontmatter.tools;
  if (!Array.isArray(tools) && Object.keys(tools).length > 0) {
    system += `\n\n${generateToolList(tools)}`;
  }

  return {
    system,
    messages: [
      { role: 'assistant', content: assistantContent },
      { role: 'user', content: userInput },
    ],
  };
}

/**
 * Routing constitution for LLM-based skill selection.
 * Uses Negative Selection protocol: exclude first, then select.
 */
export const ROUTING_CONSTITUTION = `You are a skill router. Given a user query and available skills, select the most appropriate skill.

ROUTING PROTOCOL (Negative Selection):
1. First, EXCLUDE skills where the query matches any "When NOT to Use" reason
2. Among remaining candidates, prefer skills with matching triggers
3. Use priority as tie-breaker (higher = more specific domain expert)
4. If unsure, prefer domain experts (priority 10) over utility skills (priority < 10)

NEVER select a skill when the query clearly matches its "When NOT to Use" list.`;

/**
 * Build a routing prompt listing all skill summaries for LLM-based selection.
 * Accepts enriched summaries with triggers, when_not_to_use, and priority.
 * Skills array is TOON-encoded for token efficiency (uniform array = tabular format).
 */
export function buildRoutingPrompt(
  skills: EnrichedSkillSummary[],
  userInput: string,
): string {
  // Map to enriched objects including triggers, when_not_to_use, and priority
  const enrichedSkills = skills.map(s => ({
    name: s.name,
    description: s.description,
    triggers: s.triggers,
    when_not_to_use: s.when_not_to_use,
    priority: s.priority,
  }));

  const skillList = encodeForLLM(enrichedSkills, 'Available skills');

  return `User query: ${userInput}\n\n${skillList}`;
}
