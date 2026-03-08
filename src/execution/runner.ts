import { promisify } from 'node:util';
import { execFile as execFileCb } from 'node:child_process';
import type { RunResult } from './types.js';

const execFile = promisify(execFileCb);

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
