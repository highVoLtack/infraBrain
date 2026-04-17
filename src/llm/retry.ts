/**
 * Shared retry configuration for Vercel AI SDK calls.
 *
 * The SDK default is 2 retries (observed as "Failed after 3 attempts" —
 * initial call + 2 retries). For cloud providers like Gemini whose
 * OpenAI-compatible endpoint sporadically returns 503 Service Unavailable,
 * that window is too tight. Raising it to 5 gives ~6 attempts total with
 * exponential backoff, which smooths over the typical short outage window
 * without dramatically increasing tail latency on hard failures.
 *
 * Apply this by spreading `...LLM_RETRY_OPTIONS` into generateObject /
 * generateText / streamText / embed calls.
 */

export const DEFAULT_MAX_RETRIES = 5;

export const LLM_RETRY_OPTIONS = {
  maxRetries: DEFAULT_MAX_RETRIES,
} as const;
