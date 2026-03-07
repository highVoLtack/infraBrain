import type { LanguageModel } from 'ai';

export interface LLMProvider {
  model: LanguageModel;
  streamDiagnosis(prompt: string, systemPrompt: string): AsyncIterable<string>;
  generateCommand(prompt: string, systemPrompt: string): Promise<string>;
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
