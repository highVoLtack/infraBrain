/**
 * LLM-based intent classification for memory queries.
 * Uses Vercel AI SDK generateObject with workerModel to classify incoming
 * user prompts as memory queries, action queries, or combined.
 *
 * Classification output drives memory skill routing and response formatting.
 * Graceful degradation: on LLM failure, treats query as action (safe default).
 */

import { generateObject } from 'ai';
import type { LanguageModel } from 'ai';
import { z } from 'zod';
import { LLM_RETRY_OPTIONS } from '../llm/retry.js';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const IntentSchema = z.object({
  type: z.enum(['memory', 'action', 'combined']),
  search_query: z.string(),
  time_range: z.object({
    from: z.string().optional(),
    to: z.string().optional(),
  }).optional(),
  format_hint: z.enum(['list', 'narrative', 'combined']),
});

export type IntentResult = z.infer<typeof IntentSchema>;

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

function buildClassifierSystemPrompt(): string {
  const now = new Date().toISOString();
  return `You are an intent classifier for an AI infrastructure assistant called InfraBrain.
Your job is to classify user prompts into one of three categories:

1. "memory" - The user is asking about past incidents, history, or stored knowledge.
   Examples: "what did we fix last week?", "have we seen this before?", "past nginx issues", "was hatten wir letzte Woche?"

2. "action" - The user is reporting a current problem that needs diagnosis/fixing.
   Examples: "redis is down", "nginx returns 502", "disk is full", "container keeps crashing"

3. "combined" - The user wants both memory recall AND action.
   Examples: "we had this before, fix it the same way", "this looks like last week's issue, what did we do?"

For each classification, also extract:
- search_query: A concise search query extracted from the prompt (strip conversational noise, keep technical terms)
- time_range: If the user mentions a time period, convert to absolute ISO 8601 dates. Current date/time: ${now}
  - "last week" = from 7 days ago to now
  - "yesterday" = from start of yesterday to end of yesterday
  - "im Maerz" / "in March" = from March 1 to March 31 of current year
  - If no time reference, omit time_range
- format_hint: How the response should be formatted
  - "list" for enumeration queries ("what did we fix?", "show incidents")
  - "narrative" for analysis queries ("summarize our issues", "what patterns do we see?")
  - "combined" for queries that need both or for action+memory combined intents

The system supports both German and English queries. Classify based on intent, not language.`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Classify user prompt intent using LLM structured output.
 * On failure, returns safe fallback: treat as action query.
 *
 * @param prompt - User's natural language input
 * @param workerModel - Vercel AI SDK LanguageModel instance (worker role)
 * @returns Classified intent with search query, optional time range, and format hint
 */
export async function classifyIntent(
  prompt: string,
  workerModel: LanguageModel,
): Promise<IntentResult> {
  try {
    const { object } = await generateObject({
      model: workerModel,
      schema: IntentSchema,
      system: buildClassifierSystemPrompt(),
      prompt,
      ...LLM_RETRY_OPTIONS,
    });

    return object;
  } catch {
    // Graceful degradation: treat as action if classifier fails
    return {
      type: 'action',
      search_query: prompt,
      format_hint: 'combined',
    };
  }
}
