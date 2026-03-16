import { z } from 'zod';

export const ModelRoleSchema = z.enum(['default', 'strategic', 'forensic', 'worker', 'vision', 'triage', 'embedding']);
export type ModelRole = z.infer<typeof ModelRoleSchema>;

export const ModelMapSchema = z.object({
  default: z.string().default('infrabrain'),
  strategic: z.string().default('llama3.3:70b'),
  forensic: z.string().default('deepseek-r1:32b'),
  worker: z.string().default('qwen2.5-coder:7b'),
  vision: z.string().default('llama3.2-vision'),
  triage: z.string().default('infrabrain'),
  embedding: z.string().default('bge-m3'),
});
export type ModelMap = z.infer<typeof ModelMapSchema>;

export const InfraBrainConfigSchema = z.object({
  ollamaBaseUrl: z.string().default('http://localhost:11434'),
  modelName: z.string().default('infrabrain'),
  modelMap: ModelMapSchema.default({
    default: 'infrabrain',
    strategic: 'llama3.3:70b',
    forensic: 'deepseek-r1:32b',
    worker: 'qwen2.5-coder:7b',
    vision: 'llama3.2-vision',
    triage: 'infrabrain',
    embedding: 'bge-m3',
  }),
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
  resumeWindowMs: z.number().default(86400000),
  locks: z.object({
    staleTimeoutMs: z.number().default(3600000),
  }).default({ staleTimeoutMs: 3600000 }),
  execution: z.object({
    commandTimeoutMs: z.number().default(30000),
    maxBufferBytes: z.number().default(1024 * 1024),
  }).default({ commandTimeoutMs: 30000, maxBufferBytes: 1024 * 1024 }),
  selfHealing: z.object({
    maxAttempts: z.number().default(5),
    correctionTimeoutMs: z.number().default(15000),
    restartVerificationDelayMs: z.number().default(3000),
  }).default({ maxAttempts: 5, correctionTimeoutMs: 15000, restartVerificationDelayMs: 3000 }),
});

export type InfraBrainConfig = z.infer<typeof InfraBrainConfigSchema>;
