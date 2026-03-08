import { createOllama } from 'ai-sdk-ollama';

export function createOllamaModel(modelName = 'llama3.3:70b', baseURL?: string) {
  const provider = createOllama({ baseURL: baseURL ?? 'http://localhost:11434' });
  return provider(modelName);
}
