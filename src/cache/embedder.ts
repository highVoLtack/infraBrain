/**
 * Embedding generation via Vercel AI SDK.
 * Uses the same @ai-sdk/openai-compatible provider pattern as openai-compat.ts.
 * Supports any embedding model (BGE-M3 local, Gemini cloud, etc.).
 */

import { embed } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { LLM_RETRY_OPTIONS } from '../llm/retry.js';

/** Known embedding dimensions per model family. Used for validation. */
const KNOWN_DIMENSIONS: Record<string, number> = {
  'bge-m3': 1024,
  'gemini-embedding-001': 3072,
  'gemini-embedding-2-preview': 3072,
};

/** Cache the detected dimension after first successful embedding */
let detectedDimension: number | null = null;

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

export interface EmbeddingOptions {
  apiKey?: string;
}

/**
 * Generate an embedding vector via OpenAI-compatible API.
 * Returns null on failure (graceful degradation per CACHE-07).
 */
export async function generateEmbedding(
  text: string,
  baseURL: string,
  modelId: string,
  opts?: EmbeddingOptions,
): Promise<number[] | null> {
  try {
    const provider = createOpenAICompatible({
      name: 'infrabrain-embed',
      baseURL,
      ...(opts?.apiKey ? { apiKey: opts.apiKey } : {}),
    });

    const model = provider.textEmbeddingModel(modelId);
    const result = await embed({ model, value: text, ...LLM_RETRY_OPTIONS });

    // Validate dimensions: use known table or lock to first observed
    const expected = KNOWN_DIMENSIONS[modelId] ?? detectedDimension;
    if (expected && result.embedding.length !== expected) {
      console.error(
        `Embedding dimension mismatch: expected ${expected}, got ${result.embedding.length}`,
      );
      return null;
    }
    if (!detectedDimension) detectedDimension = result.embedding.length;

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
  opts?: EmbeddingOptions,
): Promise<boolean> {
  try {
    const result = await generateEmbedding('health check', baseURL, modelId, opts);
    return result !== null;
  } catch {
    return false;
  }
}

/** Get the expected dimensions for a given embedding model (defaults to 1024) */
export function getEmbeddingDimensions(modelId: string): number {
  return KNOWN_DIMENSIONS[modelId] ?? detectedDimension ?? 1024;
}
