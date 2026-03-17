import { InfraBrainConfigSchema, type InfraBrainConfig } from './types.js';

export const DEFAULT_CONFIG: InfraBrainConfig = InfraBrainConfigSchema.parse({});

export const DEFAULT_HEALTH_URL = `${DEFAULT_CONFIG.defaultBaseUrl}/models`;
