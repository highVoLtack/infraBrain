import { createOllama } from 'ai-sdk-ollama';

const LLM_TIMEOUT_MS = 300_000; // 5 minutes — allows for slow RunPod proxy + large model inference

export function createOllamaModel(modelName = 'infrabrain', baseURL?: string) {
  const provider = createOllama({
    baseURL: baseURL ?? 'http://localhost:11434',
    fetch: (url, init) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
      return fetch(url, {
        ...init,
        signal: controller.signal,
      }).finally(() => clearTimeout(timeout));
    },
  });
  return provider(modelName);
}
