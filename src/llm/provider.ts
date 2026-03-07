import { streamText, generateText } from 'ai';
import type { LanguageModel } from 'ai';
import type { LLMProvider } from './types.js';

const DIAGNOSIS_BUDGET = 4096;
const COMMAND_BUDGET = 2048;

export function createProvider(model: LanguageModel): LLMProvider {
  return {
    model,

    async *streamDiagnosis(prompt: string, systemPrompt: string): AsyncIterable<string> {
      const result = streamText({
        model,
        system: systemPrompt,
        prompt,
        maxOutputTokens: DIAGNOSIS_BUDGET,
      });

      for await (const chunk of result.textStream) {
        yield chunk;
      }

      const usage = await result.usage;
      console.debug('[LLM] streamDiagnosis usage:', usage);
    },

    async generateCommand(prompt: string, systemPrompt: string): Promise<string> {
      const { text, usage } = await generateText({
        model,
        system: systemPrompt,
        prompt,
        maxOutputTokens: COMMAND_BUDGET,
      });

      console.debug('[LLM] generateCommand usage:', usage);
      return text;
    },
  };
}
