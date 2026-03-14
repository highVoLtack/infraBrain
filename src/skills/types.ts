import { z } from 'zod';
import { ModelRoleSchema } from '../config/types.js';
import { RewriteRuleSchema } from '../execution/dynamic-rewriter.js';

export type { RewriteRule } from '../execution/dynamic-rewriter.js';

export const DiscoveryCommandSchema = z.object({
  command: z.string().min(1, 'Discovery command is required'),
  label: z.string().min(1, 'Discovery label is required'),
});

export type DiscoveryCommand = z.infer<typeof DiscoveryCommandSchema>;

/**
 * Schema for a tool declaration in the unified tool map.
 * Each key in the tools map is a tool name, and the value describes
 * its risk level, optional privilege escalation, wrapping, and flag stripping.
 */
export const ToolDeclarationSchema = z.object({
  risk: z.enum(['read', 'write', 'destructive']),
  user: z.string().optional(),
  wrapper: z.string().optional(),
  strip_flags: z.array(z.string()).optional(),
  container: z.string().default('auto'),
});

export type ToolDeclaration = z.infer<typeof ToolDeclarationSchema>;

export const SkillFrontmatterSchema = z.object({
  name: z.string().min(1, 'Skill name is required'),
  description: z.string().min(10, 'Skill description must be at least 10 characters'),
  triggers: z.array(z.string()).min(1, 'At least one trigger is required'),
  tools: z.union([
    z.array(z.string()),
    z.record(z.string(), ToolDeclarationSchema),
  ]).default({}),
  preferred_model: ModelRoleSchema.optional(),
  priority: z.number().default(0),
  rewrite_rules: z.array(RewriteRuleSchema).default([]),
  discovery: z.array(DiscoveryCommandSchema).default([]),
  negative_triggers: z.array(z.string()).default([]),
  when_not_to_use: z.array(z.string()).default([]),
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
