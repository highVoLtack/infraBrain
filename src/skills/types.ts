import { z } from 'zod';
import { ModelRoleSchema } from '../config/types.js';

/**
 * Schema for a single rewrite rule declared in skill frontmatter.
 * Defined inline until Plan 01 creates the canonical dynamic-rewriter module.
 */
export const RewriteRuleSchema = z.object({
  match: z.string(),
  container: z.string().default('auto'),
  user: z.string().optional(),
  wrapper: z.string().optional(),
  risk: z.enum(['read', 'write', 'destructive']).optional(),
  strip_flags: z.array(z.string()).optional(),
});

export type RewriteRule = z.infer<typeof RewriteRuleSchema>;

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
