import type { SkillFile } from './types.js';

/**
 * Enforces a skill's per-skill tool allowlist on a command string.
 * Splits on shell operators and checks each sub-command's base command.
 *
 * Handles both tool formats:
 * - Legacy string[]: used directly as allowlist
 * - New Record<string, ToolDeclaration>: Object.keys() used as allowlist
 *
 * Returns allowed: true if the skill has an empty tools list/map (no restriction)
 * or if all sub-commands' base commands are in the skill's tools list.
 */
export function enforceSkillAllowlist(
  command: string,
  skill: SkillFile,
): { allowed: boolean; reason?: string } {
  const tools = skill.frontmatter.tools;

  // Derive allowlist from either format
  const allowedTools: string[] = Array.isArray(tools)
    ? tools
    : Object.keys(tools);

  // Empty tools means no restriction
  if (allowedTools.length === 0) {
    return { allowed: true };
  }

  // Split on shell operators: ;, &&, ||, |
  const subCommands = command.split(/\s*(?:;|&&|\|\||\|)\s*/);

  for (const sub of subCommands) {
    const trimmed = sub.trim();
    if (!trimmed) continue;

    const baseCommand = trimmed.split(/\s+/)[0];
    if (!allowedTools.includes(baseCommand)) {
      return {
        allowed: false,
        reason: `Command "${baseCommand}" is not in skill "${skill.frontmatter.name}" tool allowlist [${allowedTools.join(', ')}]`,
      };
    }
  }

  return { allowed: true };
}
