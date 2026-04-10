/**
 * Qwen3 tokenizer wrapper singleton for accurate BPE token counting.
 * Replaces the estimateTokens() heuristic in src/llm/token-budget.ts.
 */

import { fromPreTrained } from '@lenml/tokenizer-qwen3';

type Tokenizer = ReturnType<typeof fromPreTrained>;

let _tokenizer: Tokenizer | null = null;

/**
 * Returns the singleton Qwen3 tokenizer instance.
 * Lazy-initialized on first call (~100-500ms for vocabulary loading).
 */
export function getTokenizer(): Tokenizer {
  if (!_tokenizer) {
    _tokenizer = fromPreTrained();
  }
  return _tokenizer;
}

/**
 * Count tokens in a text string using the Qwen3 BPE tokenizer.
 * Returns 0 for empty strings.
 */
export function countTokens(text: string): number {
  if (text.length === 0) return 0;
  return getTokenizer().encode(text).length;
}
