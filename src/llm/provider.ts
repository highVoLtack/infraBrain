import { streamText, generateText } from 'ai';
import type { LanguageModel } from 'ai';
import type { LLMProvider, TaskBudget } from './types.js';
import { checkBudget } from './token-budget.js';

const DIAGNOSIS_BUDGET = 4096;
const COMMAND_BUDGET = 2048;

export function createProvider(model: LanguageModel): LLMProvider {
  return {
    model,

    async *streamDiagnosis(prompt: string, systemPrompt: string): AsyncIterable<string> {
      // Pre-flight token budget enforcement
      const budget: TaskBudget = { maxTokens: DIAGNOSIS_BUDGET, taskType: 'diagnosis' };
      const budgetCheck = checkBudget(prompt, systemPrompt, budget);
      if (!budgetCheck.allowed) {
        throw new Error(
          `Token budget exceeded for diagnosis: estimated ${budgetCheck.estimatedTokens} tokens, budget ${budgetCheck.budgetTokens} (overflow: ${budgetCheck.overflow})`,
        );
      }

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
      // Pre-flight token budget enforcement
      const budget: TaskBudget = { maxTokens: COMMAND_BUDGET, taskType: 'command' };
      const budgetCheck = checkBudget(prompt, systemPrompt, budget);
      if (!budgetCheck.allowed) {
        throw new Error(
          `Token budget exceeded for command: estimated ${budgetCheck.estimatedTokens} tokens, budget ${budgetCheck.budgetTokens} (overflow: ${budgetCheck.overflow})`,
        );
      }

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
