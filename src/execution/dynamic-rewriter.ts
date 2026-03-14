import { z } from 'zod';

/**
 * Zod schema for a rewrite rule declared in skill frontmatter.
 *
 * Each rule describes how to transform a raw command (LLM intent) into
 * an executable command targeting a specific container with optional
 * privilege escalation and command wrapping.
 */
export const RewriteRuleSchema = z.object({
  match: z.string().min(1, 'Regex pattern is required'),
  container: z.string().default('auto'),
  user: z.string().optional(),
  wrapper: z.string().optional(),
  risk: z.enum(['read', 'write', 'destructive']).optional(),
  strip_flags: z.array(z.string()).optional(),
});

export type RewriteRule = z.infer<typeof RewriteRuleSchema>;

/**
 * Resolve a container specification to an actual container name.
 *
 * - "auto" -> first container in the list
 * - specific name -> verify it exists, fallback to first container
 *
 * Returns undefined if the containers list is empty.
 */
function resolveContainer(spec: string, containers: string[]): string | undefined {
  if (containers.length === 0) return undefined;

  if (spec === 'auto') {
    return containers[0];
  }

  // Specific name: verify it exists in discovered containers
  if (containers.includes(spec)) {
    return spec;
  }

  // Fallback to first container
  return containers[0];
}

/**
 * Strip specified flags and their values from a command string.
 *
 * Handles three forms for each flag:
 * - `-h value`     (short flag with space-separated value)
 * - `--host value` (long flag with space-separated value)
 * - `--host=value` (long flag with equals-separated value)
 *
 * Collapses multiple spaces after removal.
 */
function stripFlags(command: string, flags: string[]): string {
  let result = command;

  for (const flag of flags) {
    // Escape special regex chars in flag name
    const escaped = flag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // --flag=value form
    result = result.replace(new RegExp(`\\s+${escaped}=\\S+`, 'g'), '');

    // -flag value or --flag value form
    result = result.replace(new RegExp(`\\s+${escaped}\\s+\\S+`, 'g'), '');
  }

  // Collapse multiple spaces and trim
  return result.replace(/\s{2,}/g, ' ').trim();
}

/**
 * Dynamic command rewriter -- pure function, no side effects.
 *
 * Transforms a raw command (LLM intent) into an executable command
 * by applying the first matching rewrite rule from the active skill.
 *
 * Pipeline per matching rule:
 * 1. Strip flags (if strip_flags defined)
 * 2. Apply wrapper (if wrapper defined, replaces {cmd} placeholder)
 * 3. Resolve container
 * 4. Build `docker exec [-u user] <container> <command>`
 *
 * Passthrough conditions:
 * - Command already starts with `docker exec` (prevent double-wrapping)
 * - No rules match the command
 * - No rules provided
 * - Container cannot be resolved (empty containers list)
 */
export function dynamicRewrite(
  command: string,
  rules: RewriteRule[],
  containers: string[],
): string {
  const trimmed = command.trim();

  // Prevent double-wrapping: if already a docker exec command, pass through
  if (/^docker\s+exec\b/i.test(trimmed)) {
    return trimmed;
  }

  // No rules: pass through
  if (rules.length === 0) {
    return trimmed;
  }

  // Find first matching rule
  for (const rule of rules) {
    const regex = new RegExp(rule.match, 'i');
    if (!regex.test(trimmed)) continue;

    // Resolve container -- if none available, pass through
    const container = resolveContainer(rule.container ?? 'auto', containers);
    if (!container) {
      return trimmed;
    }

    // Apply strip_flags
    let processed = trimmed;
    if (rule.strip_flags && rule.strip_flags.length > 0) {
      processed = stripFlags(processed, rule.strip_flags);
    }

    // Apply wrapper pattern
    if (rule.wrapper) {
      processed = rule.wrapper.replace('{cmd}', processed);
    }

    // Build docker exec command
    const userFlag = rule.user ? `-u ${rule.user} ` : '';
    return `docker exec ${userFlag}${container} ${processed}`;
  }

  // No rule matched: pass through unchanged
  return trimmed;
}
