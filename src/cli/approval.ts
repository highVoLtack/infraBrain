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
 * Container-aware: for `docker exec <container>` commands, extracts the container name
 * (first non-flag token after "exec"), NOT the last argument (which is often a SQL string).
 * For other docker commands: extracts the container/image name.
 * For file commands: extracts the file path.
 * Fallback: last whitespace-separated token.
 */
export function extractTarget(command: string): string {
  const parts = command.trim().split(/\s+/);

  // Docker exec: extract container name (first non-flag token after "exec")
  // e.g. "docker exec postgres-demo psql -U postgres -c ..." -> "postgres-demo"
  // e.g. "docker exec -u postgres postgres-demo psql ..." -> "postgres-demo"
  const execIndex = parts.indexOf('exec');
  if (parts[0] === 'docker' && execIndex >= 0) {
    for (let i = execIndex + 1; i < parts.length; i++) {
      // Skip flags like -u, -it, -e, --user, etc.
      if (parts[i].startsWith('-')) {
        // If it's a flag that takes a value (e.g. -u postgres), skip the next token too
        if (/^-[uew]$/.test(parts[i]) || /^--user$|^--env$|^--workdir$/.test(parts[i])) {
          i++; // skip the flag's value
        }
        continue;
      }
      // First non-flag token after exec is the container name
      return parts[i];
    }
  }

  // Docker subcommands (rm, stop, restart, etc.): container is the last non-flag token
  if (parts[0] === 'docker') {
    const nonFlags = parts.filter((p) => !p.startsWith('-'));
    if (nonFlags.length > 2) {
      return nonFlags[2]; // docker <subcommand> <target>
    }
  }

  // Filter out flags (tokens starting with -)
  const nonFlags = parts.filter((p) => !p.startsWith('-'));

  // Return the last non-flag token (skip the command verb(s))
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
