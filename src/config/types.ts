import { z } from 'zod';

export const InfraBrainConfigSchema = z.object({
  ollamaBaseUrl: z.string().default('http://localhost:11434'),
  modelName: z.string().default('llama3.3:70b'),
  apiPort: z.number().default(3000),
  sessionDir: z.string().default('.infrabrain'),
  tokenBudgets: z.object({
    diagnosis: z.number().default(4096),
    command: z.number().default(2048),
  }).default({ diagnosis: 4096, command: 2048 }),
});

export type InfraBrainConfig = z.infer<typeof InfraBrainConfigSchema>;
