import type * as readline from 'node:readline/promises';
import chalk from 'chalk';
import { RiskLevel } from '../safety/types.js';

export interface ApprovalResult {
  approved: boolean;
  approvalType: 'auto' | 'y_n' | 'typed_confirmation' | 'blocked';
  command: string;
  riskLevel: RiskLevel;
}

/**
 * Extract the target from a command string.
 * For docker commands: extracts the container/image name (last non-flag argument).
 * For file commands: extracts the file path.
 * Fallback: last whitespace-separated token.
 */
export function extractTarget(command: string): string {
  const parts = command.trim().split(/\s+/);

  // Filter out flags (tokens starting with -)
  const nonFlags = parts.filter((p) => !p.startsWith('-'));

  // Return the last non-flag token (skip the command verb(s))
  // For "docker rm nginx" -> ["docker", "rm", "nginx"] -> "nginx"
  // For "rm /tmp/file.txt" -> ["rm", "/tmp/file.txt"] -> "/tmp/file.txt"
  if (nonFlags.length > 1) {
    return nonFlags[nonFlags.length - 1];
  }

  // Fallback: last token overall
  return parts[parts.length - 1];
}

/**
 * Request human approval for a command based on its risk level.
 *
 * - READ: Auto-approve with log line
 * - WRITE: Y/n prompt (Y is default, empty = approve)
 * - DESTRUCTIVE: Typed confirmation of target name required
 * - BLOCKED: Hard rejection, no prompt
 */
export async function requestApproval(
  command: string,
  riskLevel: RiskLevel,
  rl: readline.Interface,
): Promise<ApprovalResult> {
  switch (riskLevel) {
    case RiskLevel.READ: {
      console.log(chalk.gray(`[auto-approved] ${command}`));
      return {
        approved: true,
        approvalType: 'auto',
        command,
        riskLevel,
      };
    }

    case RiskLevel.WRITE: {
      const answer = await rl.question(
        chalk.yellow(`Execute "${command}"? [Y/n] `),
      );
      const approved = answer.toLowerCase() !== 'n';
      return {
        approved,
        approvalType: 'y_n',
        command,
        riskLevel,
      };
    }

    case RiskLevel.DESTRUCTIVE: {
      const target = extractTarget(command);
      const confirmation = await rl.question(
        chalk.red(`DESTRUCTIVE: "${command}"\nType "${target}" to confirm: `),
      );
      const approved = confirmation === target;
      return {
        approved,
        approvalType: 'typed_confirmation',
        command,
        riskLevel,
      };
    }

    case RiskLevel.BLOCKED: {
      console.log(
        chalk.red.bold(`BLOCKED: "${command}" -- command is not allowed`),
      );
      return {
        approved: false,
        approvalType: 'blocked',
        command,
        riskLevel,
      };
    }
  }
}
