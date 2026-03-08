import { z } from 'zod';

export const InfraBrainConfigSchema = z.object({
  ollamaBaseUrl: z.string().default('http://localhost:11434'),
  modelName: z.string().default('llama3.3:70b'),
  apiPort: z.number().default(3000),
  sessionDir: z.string().default('.infrabrain'),
  skillsDir: z.string().default('skills'),
  tokenBudgets: z.object({
    diagnosis: z.number().default(4096),
    command: z.number().default(2048),
  }).default({ diagnosis: 4096, command: 2048 }),
  circuitBreaker: z.object({
    maxRetries: z.number().default(3),
    retryDelayMs: z.number().default(1000),
  }).default({ maxRetries: 3, retryDelayMs: 1000 }),
  damageBudget: z.object({
    maxPoints: z.number().default(10),
  }).default({ maxPoints: 10 }),
  locks: z.object({
    staleTimeoutMs: z.number().default(3600000),
  }).default({ staleTimeoutMs: 3600000 }),
  execution: z.object({
    commandTimeoutMs: z.number().default(30000),
    maxBufferBytes: z.number().default(1024 * 1024),
  }).default({ commandTimeoutMs: 30000, maxBufferBytes: 1024 * 1024 }),
});

export type InfraBrainConfig = z.infer<typeof InfraBrainConfigSchema>;
