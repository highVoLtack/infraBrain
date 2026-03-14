import { promisify } from 'node:util';
import { execFile as execFileCb, exec as execCb } from 'node:child_process';
import type { RunResult } from './types.js';

const execFile = promisify(execFileCb);
const exec = promisify(execCb);

/**
 * Identify the database container from a list of container names.
 * Scans for names containing common DB indicators: postgres, pg, db, mysql, mariadb, redis.
 * Falls back to the first container if no match found.
 */
export function findDbContainer(containers: string[]): string | undefined {
  if (containers.length === 0) return undefined;

  const dbPatterns = [/postgres/i, /\bpg\b/i, /\bdb\b/i, /mysql/i, /mariadb/i, /redis/i, /mongo/i];
  for (const pattern of dbPatterns) {
    const match = containers.find(c => pattern.test(c));
    if (match) return match;
  }

  // No DB-like name found — return first container as fallback
  return containers[0];
}

/**
 * Command rewriter: wraps bare SQL or psql commands in `docker exec`.
 * This shifts the complexity from the LLM prompt into deterministic TypeScript code.
 *
 * Rules:
 * - Bare SQL (starts with SELECT, SHOW, etc.) → `docker exec <container> psql -U postgres -c "<sql>"`
 * - Bare `psql -c "..."` → `docker exec <container> psql -U postgres -c "..."`
 * - Already wrapped in `docker exec` → pass through unchanged
 * - Non-SQL commands → pass through unchanged
 *
 * @param command - The raw command from the LLM or structured diagnosis
 * @param containerName - The target container name (from discovery)
 * @returns The rewritten command, ready for execution
 */
/**
 * Strip `-h <host>` / `--host <host>` / `--host=<host>` from a psql argument string.
 * Forces local unix socket connection inside the container — faster, no password needed.
 *
 * @deprecated Use dynamicRewrite() from dynamic-rewriter.ts instead.
 * Kept for backwards compatibility with existing tests.
 */
export function stripHostFlag(args: string): string {
  return args
    .replace(/\s+-h\s+\S+/g, '')       // -h 172.20.0.2
    .replace(/\s+--host\s+\S+/g, '')   // --host 172.20.0.2
    .replace(/\s+--host=\S+/g, '')     // --host=172.20.0.2
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * @deprecated Use dynamicRewrite() from dynamic-rewriter.ts instead.
 * Kept for backwards compatibility with existing tests.
 */
export function rewriteForContainer(command: string, containerName?: string): string {
  if (!containerName) return command;

  const trimmed = command.trim();

  // Already wrapped in docker exec — still strip -h flags for safety
  if (/^docker\s+exec\b/.test(trimmed)) {
    return stripHostFlag(trimmed);
  }

  // Bare SQL statement (SELECT, SHOW, INSERT, UPDATE, DELETE, WITH, EXPLAIN)
  const sqlPattern = /^(SELECT|SHOW|INSERT|UPDATE|DELETE|WITH|EXPLAIN)\b/i;
  if (sqlPattern.test(trimmed)) {
    // Strip trailing semicolon if present (psql -c doesn't need it)
    const sql = trimmed.replace(/;\s*$/, '');
    return `docker exec ${containerName} psql -U postgres -c "${sql}"`;
  }

  // Bare psql command (e.g. `psql -U postgres -h 172.20.0.2 -c "..."`)
  if (/^psql\b/.test(trimmed)) {
    const psqlArgs = stripHostFlag(trimmed.slice(4).trim());
    return `docker exec ${containerName} psql ${psqlArgs}`;
  }

  // Non-SQL, non-psql — pass through unchanged
  return trimmed;
}

/**
 * Parse a command string into executable and arguments.
 * Handles single and double quoted strings.
 * For complex commands (pipes, redirects), use shell mode instead.
 */
export function parseCommand(command: string): { executable: string; args: string[] } {
  const tokens: string[] = [];
  let current = '';
  let inQuote: string | null = null;

  for (const char of command) {
    if (inQuote) {
      if (char === inQuote) {
        inQuote = null;
      } else {
        current += char;
      }
    } else if (char === '"' || char === "'") {
      inQuote = char;
    } else if (char === ' ' || char === '\t') {
      if (current) {
        tokens.push(current);
        current = '';
      }
    } else {
      current += char;
    }
  }
  if (current) tokens.push(current);

  return { executable: tokens[0], args: tokens.slice(1) };
}

/**
 * Returns true if command contains shell operators (pipe, redirect, chaining).
 * These commands require shell mode (spawn with shell: true).
 */
export function needsShell(command: string): boolean {
  // Check for shell metacharacters: |, >, >>, <, &&, ||, ;, backtick
  return /[|><;`]|&&|\|\|/.test(command);
}

/**
 * Execute a command via child_process.execFile with timeout and AbortController.
 * Always resolves with a RunResult -- never throws.
 * On non-zero exit, extracts stdout/stderr from the error object.
 */
export async function runCommand(
  executable: string,
  args: string[],
  options: { timeout: number; maxBuffer?: number },
): Promise<RunResult> {
  const controller = new AbortController();
  try {
    const { stdout, stderr } = await execFile(executable, args, {
      timeout: options.timeout,
      maxBuffer: options.maxBuffer ?? 1024 * 1024,
      signal: controller.signal,
    });
    return { stdout, stderr, exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; code?: number | string; message?: string };
    return {
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? e.message ?? '',
      exitCode: typeof e.code === 'number' ? e.code : 1,
    };
  }
}

/**
 * Execute a shell command string (supports pipes, subshells, for-loops, etc.).
 * Use for complex commands that need shell interpretation.
 * Always resolves with a RunResult -- never throws.
 */
export async function runShellCommand(
  command: string,
  options: { timeout: number; maxBuffer?: number },
): Promise<RunResult> {
  try {
    const { stdout, stderr } = await exec(command, {
      timeout: options.timeout,
      maxBuffer: options.maxBuffer ?? 1024 * 1024,
    });
    return { stdout, stderr, exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; code?: number | string; message?: string };
    return {
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? e.message ?? '',
      exitCode: typeof e.code === 'number' ? e.code : 1,
    };
  }
}
