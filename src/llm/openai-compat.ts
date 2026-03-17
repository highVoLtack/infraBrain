import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModel } from 'ai';
import type { ModelRole, ModelMap } from '../config/types.js';
import type { ModelRegistry } from './types.js';

const LLM_TIMEOUT_MS = 600_000; // 10 minutes -- allows for slow RunPod proxy + large model inference

const ROLES: ModelRole[] = ['default', 'strategic', 'forensic', 'worker', 'vision', 'triage', 'embedding'];

function createCompatProvider(baseURL: string) {
  return createOpenAICompatible({
    name: 'infrabrain',
    baseURL,
    fetch: (url, init) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
      return fetch(url, {
        ...init,
        signal: controller.signal,
      }).finally(() => clearTimeout(timeout));
    },
    supportsStructuredOutputs: true,
  });
}

export function createCompatModel(modelName: string, baseURL = 'http://localhost:11434/v1'): LanguageModel {
  const provider = createCompatProvider(baseURL);
  return provider(modelName);
}

export function createModelRegistry(modelMap: ModelMap, defaultBaseUrl: string): ModelRegistry {
  const models = new Map<ModelRole, { model: LanguageModel; modelId: string }>();
  const providerCache = new Map<string, ReturnType<typeof createCompatProvider>>();

  function getProvider(baseUrl: string) {
    if (!providerCache.has(baseUrl)) {
      providerCache.set(baseUrl, createCompatProvider(baseUrl));
    }
    return providerCache.get(baseUrl)!;
  }

  for (const role of ROLES) {
    const entry = modelMap[role];
    const { modelId, baseUrl } = typeof entry === 'string'
      ? { modelId: entry, baseUrl: defaultBaseUrl }
      : { modelId: entry.model, baseUrl: entry.baseUrl };

    const provider = getProvider(baseUrl);
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
