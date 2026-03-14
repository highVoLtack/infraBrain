import { z } from 'zod';
import type { ToolDeclaration } from '../skills/types.js';

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
 * Parsed components of a `docker exec` command.
 */
interface DockerExecParts {
  flags: string[];
  container: string;
  inner: string;
}

/**
 * Docker exec flags that consume the next token as a value.
 */
const DOCKER_EXEC_VALUE_FLAGS = new Set([
  '-u', '--user',
  '-e', '--env',
  '-w', '--workdir',
]);

/**
 * Parse a `docker exec [-flags] <container> <inner-command>` string
 * into its component parts.
 *
 * Returns null if the command is not a docker exec, or if it lacks
 * a container name or inner command.
 */
function parseDockerExec(cmd: string): DockerExecParts | null {
  const match = cmd.match(/^docker\s+exec\s+(.+)$/i);
  if (!match) return null;

  const tokens = match[1].split(/\s+/);
  const flags: string[] = [];
  let i = 0;

  while (i < tokens.length && tokens[i].startsWith('-')) {
    const flag = tokens[i];
    if (DOCKER_EXEC_VALUE_FLAGS.has(flag) && i + 1 < tokens.length) {
      flags.push(flag, tokens[i + 1]);
      i += 2;
    } else {
      flags.push(flag); // -it, -i, -t, --privileged, etc.
      i += 1;
    }
  }

  if (i >= tokens.length) return null; // No container found
  const container = tokens[i];
  const inner = tokens.slice(i + 1).join(' ');
  if (!inner) return null; // No inner command

  return { flags, container, inner };
}

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

  // Docker-exec-aware rewriting: parse, apply rules to inner command, reassemble
  if (/^docker\s+exec\b/i.test(trimmed)) {
    const parsed = parseDockerExec(trimmed);
    if (!parsed) return trimmed; // Unparseable docker exec -- pass through

    // Strip -it/-i/-t from existing flags (belt-and-suspenders with validator.ts)
    let cleanFlags = parsed.flags.filter(f => !['-it', '-ti', '-i', '-t'].includes(f));

    // Try to match inner command against rules (first-match-wins)
    for (const rule of rules) {
      const regex = new RegExp(rule.match, 'i');
      if (!regex.test(parsed.inner)) continue;

      // Apply strip_flags to inner command
      let processed = parsed.inner;
      if (rule.strip_flags && rule.strip_flags.length > 0) {
        processed = stripFlags(processed, rule.strip_flags);
      }

      // Apply wrapper to inner command
      if (rule.wrapper) {
        processed = rule.wrapper.replace('{cmd}', processed);
      }

      // Inject -u if rule specifies user and not already present in flags
      if (rule.user && !cleanFlags.includes('-u') && !cleanFlags.includes('--user')) {
        cleanFlags = ['-u', rule.user, ...cleanFlags];
      }

      const flagStr = cleanFlags.length > 0 ? ' ' + cleanFlags.join(' ') : '';
      return `docker exec${flagStr} ${parsed.container} ${processed}`;
    }

    // No rule matched inner command: return cleaned docker exec (-it stripped)
    const flagStr = cleanFlags.length > 0 ? ' ' + cleanFlags.join(' ') : '';
    return `docker exec${flagStr} ${parsed.container} ${parsed.inner}`;
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

/**
 * Convert a unified tool map (from skill frontmatter) into RewriteRule[] format
 * compatible with dynamicRewrite().
 *
 * Each tool name becomes a `^toolName\b` regex match pattern. All declaration
 * fields (container, user, wrapper, risk, strip_flags) are forwarded directly.
 */
export function toolsToRewriteRules(tools: Record<string, ToolDeclaration>): RewriteRule[] {
  return Object.entries(tools).map(([name, decl]) => {
    // Escape special regex chars in tool name
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return {
      match: `^${escaped}\\b`,
      container: decl.container ?? 'auto',
      ...(decl.user !== undefined && { user: decl.user }),
      ...(decl.wrapper !== undefined && { wrapper: decl.wrapper }),
      ...(decl.risk !== undefined && { risk: decl.risk }),
      ...(decl.strip_flags !== undefined && { strip_flags: decl.strip_flags }),
    };
  });
}
