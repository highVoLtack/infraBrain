import { z } from 'zod';
import { ModelRoleSchema } from '../config/types.js';
import { RewriteRuleSchema } from '../execution/dynamic-rewriter.js';

export type { RewriteRule } from '../execution/dynamic-rewriter.js';

export const DiscoveryCommandSchema = z.object({
  command: z.string().min(1, 'Discovery command is required'),
  label: z.string().min(1, 'Discovery label is required'),
});

export type DiscoveryCommand = z.infer<typeof DiscoveryCommandSchema>;

export const SkillFrontmatterSchema = z.object({
  name: z.string().min(1, 'Skill name is required'),
  description: z.string().min(10, 'Skill description must be at least 10 characters'),
  triggers: z.array(z.string()).min(1, 'At least one trigger is required'),
  tools: z.array(z.string()).default([]),
  preferred_model: ModelRoleSchema.optional(),
  version: z.string().optional(),
  author: z.string().optional(),
  priority: z.number().default(0),
  rewrite_rules: z.array(RewriteRuleSchema).default([]),
  discovery: z.array(DiscoveryCommandSchema).default([]),
});

export const SkillSectionsSchema = z.object({
  systemPrompt: z.string().min(1, 'System Prompt section is required'),
  tools: z.string().optional(),
  examples: z.string().optional(),
});

export type SkillFrontmatter = z.infer<typeof SkillFrontmatterSchema>;
export type SkillSections = z.infer<typeof SkillSectionsSchema>;

export interface SkillFile {
  frontmatter: SkillFrontmatter;
  sections: SkillSections;
  rawContent: string;
  filePath: string;
}
