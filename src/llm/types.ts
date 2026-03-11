import type { LanguageModel } from 'ai';
import type { ModelRole } from '../config/types.js';

export interface ModelRegistry {
  get(role: ModelRole): LanguageModel;
  getDefault(): LanguageModel;
  entries(): Array<{ role: ModelRole; modelId: string }>;
}

export interface LLMProvider {
  model: LanguageModel;
  registry: ModelRegistry;
  streamDiagnosis(prompt: string, systemPrompt: string): AsyncIterable<string>;
  generateCommand(prompt: string, systemPrompt: string, role?: ModelRole): Promise<string>;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface TaskBudget {
  maxTokens: number;
  taskType: 'diagnosis' | 'command';
}
