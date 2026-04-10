/**
 * BGE-M3 embedding generation via Vercel AI SDK.
 * Uses the same @ai-sdk/openai-compatible provider pattern as openai-compat.ts.
 */

import { embed } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

const EXPECTED_DIMENSIONS = 1024;

/**
 * Format error context into a single string suitable for embedding.
 * Concatenates the error prompt with filtered discovery entries.
 */
export function formatEmbeddingInput(
  userPrompt: string,
  filteredDiscovery: Record<string, string>,
): string {
  const discoveryEntries = Object.entries(filteredDiscovery)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');

  return `ERROR: ${userPrompt}\n\nCONTEXT:\n${discoveryEntries}`;
}

/**
 * Generate a 1024-dimensional embedding vector using BGE-M3 via OpenAI-compatible API.
 * Returns null on failure (graceful degradation per CACHE-07).
 */
export async function generateEmbedding(
  text: string,
  baseURL: string,
  modelId: string,
): Promise<number[] | null> {
  try {
    const provider = createOpenAICompatible({
      name: 'infrabrain-embed',
      baseURL,
    });

    const model = provider.textEmbeddingModel(modelId);
    const result = await embed({ model, value: text });

    if (result.embedding.length !== EXPECTED_DIMENSIONS) {
      console.error(
        `Embedding dimension mismatch: expected ${EXPECTED_DIMENSIONS}, got ${result.embedding.length}`,
      );
      return null;
    }

    return result.embedding;
  } catch (err) {
    console.error('Failed to generate embedding:', err);
    return null;
  }
}

/**
 * Quick health check: can the embedding model be reached?
 * Returns false on any failure (graceful degradation).
 */
export async function isEmbeddingAvailable(
  baseURL: string,
  modelId: string,
): Promise<boolean> {
  try {
    const result = await generateEmbedding('health check', baseURL, modelId);
    return result !== null;
  } catch {
    return false;
  }
}
