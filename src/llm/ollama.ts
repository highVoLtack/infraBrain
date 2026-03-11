import { createOllama } from 'ai-sdk-ollama';
import type { LanguageModel } from 'ai';
import type { ModelRole, ModelMap } from '../config/types.js';
import type { ModelRegistry } from './types.js';

const LLM_TIMEOUT_MS = 300_000; // 5 minutes — allows for slow RunPod proxy + large model inference

function createOllamaProvider(baseURL: string) {
  return createOllama({
    baseURL,
    fetch: (url, init) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
      return fetch(url, {
        ...init,
        signal: controller.signal,
      }).finally(() => clearTimeout(timeout));
    },
  });
}

export function createOllamaModel(modelName = 'infrabrain', baseURL?: string) {
  const provider = createOllamaProvider(baseURL ?? 'http://localhost:11434');
  return provider(modelName);
}

export function createModelRegistry(modelMap: ModelMap, baseURL: string): ModelRegistry {
  const provider = createOllamaProvider(baseURL);
  const models = new Map<ModelRole, { model: LanguageModel; modelId: string }>();

  for (const role of ['default', 'strategic', 'forensic'] as ModelRole[]) {
    const modelId = modelMap[role];
    models.set(role, { model: provider(modelId), modelId });
  }

  return {
    get(role: ModelRole): LanguageModel {
      const entry = models.get(role);
      if (!entry) throw new Error(`No model configured for role: ${role}`);
      return entry.model;
    },
    getDefault(): LanguageModel {
      return models.get('default')!.model;
    },
    entries(): Array<{ role: ModelRole; modelId: string }> {
      return Array.from(models.entries()).map(([role, { modelId }]) => ({ role, modelId }));
    },
  };
}
