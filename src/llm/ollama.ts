import { ollama } from 'ai-sdk-ollama';

export function createOllamaModel(modelName = 'llama3.3:70b') {
  return ollama(modelName);
}
