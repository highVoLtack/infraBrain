import { InfraBrainConfigSchema, type InfraBrainConfig } from './types.js';

export const DEFAULT_CONFIG: InfraBrainConfig = InfraBrainConfigSchema.parse({});

export const OLLAMA_HEALTH_URL = `${DEFAULT_CONFIG.ollamaBaseUrl}/api/tags`;
