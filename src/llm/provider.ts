import { streamText, generateText } from 'ai';
import type { LanguageModel } from 'ai';
import type { ModelRole } from '../config/types.js';
import type { LLMProvider, ModelRegistry, TaskBudget } from './types.js';
import { checkBudget } from './token-budget.js';
import { LLM_RETRY_OPTIONS } from './retry.js';

const DIAGNOSIS_BUDGET = 4096;
const COMMAND_BUDGET = 2048;

/**
 * Role-specific output token limits.
 * Forensic models (e.g. DeepSeek R1) need more space for internal
 * Chain of Thought (<think> blocks) before producing the answer.
 */
const ROLE_OUTPUT_LIMITS: Record<string, number> = {
  forensic: 4096,
  strategic: 4096,
  default: 2048,
  worker: 2048,
  vision: 2048,
};

function getOutputLimit(role?: ModelRole): number {
  if (!role) return COMMAND_BUDGET;
  return ROLE_OUTPUT_LIMITS[role] ?? COMMAND_BUDGET;
}

export function createProvider(model: LanguageModel, registry?: ModelRegistry): LLMProvider {
  const fallbackRegistry: ModelRegistry = {
    get: () => model,
    getDefault: () => model,
    entries: () => [{ role: 'default' as ModelRole, modelId: (model as any).modelId ?? 'unknown' }],
  };

  const activeRegistry = registry ?? fallbackRegistry;

  return {
    model,
    registry: activeRegistry,

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
        ...LLM_RETRY_OPTIONS,
      });

      for await (const chunk of result.textStream) {
        yield chunk;
      }

      const usage = await result.usage;
      console.debug('[LLM] streamDiagnosis usage:', usage);
    },

    async generateCommand(prompt: string, systemPrompt: string, role?: ModelRole): Promise<string> {
      const targetModel = role ? activeRegistry.get(role) : model;
      const outputLimit = getOutputLimit(role);

      // Pre-flight token budget enforcement — use role-aware limit
      const budget: TaskBudget = { maxTokens: outputLimit, taskType: 'command' };
      const budgetCheck = checkBudget(prompt, systemPrompt, budget);
      if (!budgetCheck.allowed) {
        throw new Error(
          `Token budget exceeded for command: estimated ${budgetCheck.estimatedTokens} tokens, budget ${budgetCheck.budgetTokens} (overflow: ${budgetCheck.overflow})`,
        );
      }

      const { text, usage } = await generateText({
        model: targetModel,
        system: systemPrompt,
        prompt,
        maxOutputTokens: outputLimit,
        ...LLM_RETRY_OPTIONS,
      });

      const modelId = (targetModel as any).modelId ?? 'unknown';
      console.debug(`[LLM] generateCommand (model: ${modelId}, role: ${role ?? 'default'}) usage:`, usage);
      return text;
    },
  };
}
