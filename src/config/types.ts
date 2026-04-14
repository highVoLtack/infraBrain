import { z } from 'zod';

export const ModelRoleSchema = z.enum(['default', 'strategic', 'forensic', 'worker', 'vision', 'triage', 'embedding']);
export type ModelRole = z.infer<typeof ModelRoleSchema>;

export const ModelMapEntrySchema = z.union([
  z.string(),
  z.object({
    model: z.string(),
    baseUrl: z.string(),
  }),
]);
export type ModelMapEntry = z.infer<typeof ModelMapEntrySchema>;

export const ModelMapSchema = z.object({
  default: ModelMapEntrySchema.default('infrabrain'),
  strategic: ModelMapEntrySchema.default('llama3.3:70b'),
  forensic: ModelMapEntrySchema.default('deepseek-r1:32b'),
  worker: ModelMapEntrySchema.default('qwen2.5-coder:7b'),
  vision: ModelMapEntrySchema.default('llama3.2-vision'),
  triage: ModelMapEntrySchema.default('infrabrain'),
  embedding: ModelMapEntrySchema.default('bge-m3'),
});
export type ModelMap = z.infer<typeof ModelMapSchema>;

// Internal schema without backwards-compat preprocessing
const InfraBrainConfigSchemaInner = z.object({
  defaultBaseUrl: z.string().default('http://localhost:11434/v1'),
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
  contextWindow: z.number().default(32768),
  cache: z.object({
    enabled: z.boolean().default(true),
    similarityThreshold: z.number().default(0.85),
    softZoneFloor: z.number().default(0.75),
    dataDir: z.string().default('.infrabrain/cache'),
    confidenceWeights: z.object({
      w_sim: z.number().default(0.5),
      w_rec: z.number().default(0.3),
      w_suc: z.number().default(0.2),
      decayLambda: z.number().default(0.1),
    }).default({}),
  }).default({}),
  memory: z.object({
    enabled: z.boolean().default(true),
    dataDir: z.string().default('.infrabrain/memory'),
    decayLambda: z.number().default(0.02), // Much slower than cache's 0.1
    l2SimilarityThreshold: z.number().default(0.7),
    l2Limit: z.number().default(3),
    tokenBudgets: z.object({
      l0: z.number().default(100),
      l1: z.number().default(500),
      l2l3: z.number().default(1000),
    }).default({}),
  }).default({}),
});

// Backwards-compatible schema: maps legacy ollamaBaseUrl to defaultBaseUrl
export const InfraBrainConfigSchema = z.preprocess((val) => {
  if (val && typeof val === 'object' && !Array.isArray(val)) {
    const obj = val as Record<string, unknown>;
    // Map legacy ollamaBaseUrl to defaultBaseUrl (only if defaultBaseUrl not already set)
    if ('ollamaBaseUrl' in obj && !('defaultBaseUrl' in obj)) {
      const { ollamaBaseUrl, ...rest } = obj;
      return { ...rest, defaultBaseUrl: ollamaBaseUrl };
    }
    // If both are set, remove ollamaBaseUrl (defaultBaseUrl takes precedence)
    if ('ollamaBaseUrl' in obj && 'defaultBaseUrl' in obj) {
      const { ollamaBaseUrl, ...rest } = obj;
      return rest;
    }
  }
  return val;
}, InfraBrainConfigSchemaInner);

export type InfraBrainConfig = z.infer<typeof InfraBrainConfigSchemaInner>;
