import type { SkillFile } from './types.js';

/**
 * Enforces a skill's per-skill tool allowlist on a command string.
 * Splits on shell operators and checks each sub-command's base command.
 *
 * Returns allowed: true if the skill has an empty tools array (no restriction)
 * or if all sub-commands' base commands are in the skill's tools list.
 */
export function enforceSkillAllowlist(
  command: string,
  skill: SkillFile,
): { allowed: boolean; reason?: string } {
  const allowedTools = skill.frontmatter.tools;

  // Empty tools array means no restriction
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
