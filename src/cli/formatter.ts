import chalk from 'chalk';
import { RiskLevel } from '../safety/types.js';
import type { ApprovalResult } from './approval.js';

/**
 * REPL prompt -- tool-like (psql-style), not chatbot.
 */
export const REPL_PROMPT = chalk.cyan('infrabrain> ');

/**
 * Format LLM diagnostic output with chalk styling.
 */
export function formatDiagnosis(text: string): string {
  return chalk.white(text);
}

/**
 * Format a command with color-coded display based on risk level.
 * - Green: READ (safe)
 * - Yellow: WRITE (moderate)
 * - Red: DESTRUCTIVE (dangerous)
 * - Gray + strikethrough: BLOCKED
 */
export function formatCommand(command: string, riskLevel: RiskLevel, allowed: boolean): string {
  if (!allowed) {
    return chalk.gray.strikethrough(command) + chalk.red(' [BLOCKED]');
  }

  switch (riskLevel) {
    case RiskLevel.READ:
      return chalk.green(command) + chalk.gray(' [read]');
    case RiskLevel.WRITE:
      return chalk.yellow(command) + chalk.yellow(' [write]');
    case RiskLevel.DESTRUCTIVE:
      return chalk.red(command) + chalk.red.bold(' [DESTRUCTIVE]');
    case RiskLevel.BLOCKED:
      return chalk.gray.strikethrough(command) + chalk.red(' [BLOCKED]');
  }
}

/**
 * Format an approval result for human-readable display.
 */
export function formatApprovalResult(result: ApprovalResult): string {
  if (result.approved) {
    return chalk.green(`Approved: ${result.command} (${result.approvalType})`);
  }
  return chalk.red(`Rejected: ${result.command} (${result.approvalType})`);
}

/**
 * Format an error message.
 */
export function formatError(error: string): string {
  return chalk.red(error);
}
