import type { LLMProvider } from '../../../src/llm/types.js';

/**
 * Factory for creating a mock LLMProvider with deterministic responses.
 *
 * @param diagnosisResponse - The canned diagnosis string returned by generateCommand.
 * @returns A fully-typed LLMProvider mock suitable for E2E testing.
 */
export function createMockLLMProvider(diagnosisResponse: string): LLMProvider {
  return {
    model: {} as any,
    registry: { get: () => ({} as any), getDefault: () => ({} as any), entries: () => [] } as any,
    async *streamDiagnosis() {
      yield 'test';
    },
    async generateCommand(): Promise<string> {
      return diagnosisResponse;
    },
  };
}
