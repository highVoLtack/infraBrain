import chalk from 'chalk';
import { RiskLevel } from '../safety/types.js';
import type { ApprovalResult } from './approval.js';
import type { AuditEntry } from '../audit/types.js';

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

// ---------- Status Dashboard ----------

interface StatusData {
  ollama: {
    connected: boolean;
    modelName?: string;
    responseTimeMs?: number;
    error?: string;
  };
  activePlans: Array<{
    sessionId: string;
    status: string;
    currentPlan?: {
      id: string;
      description: string;
      currentStep: number;
      steps: unknown[];
      status: string;
    };
  }>;
  recentSessions: Array<{
    sessionId: string;
    status: string;
    createdAt: string;
    updatedAt: string;
  }>;
  locks: Array<{
    target: string;
    sessionId: string;
    adminName: string;
    createdAt: string;
    pid: number;
    planSummary: string;
  }>;
}

/**
 * Format a status dashboard for CLI display.
 * Glanceable, one-screen output like `docker ps`.
 */
export function formatStatusDashboard(data: StatusData): string {
  const lines: string[] = [];

  // Header
  lines.push(chalk.bold('InfraBrain Status'));
  lines.push('');

  // Ollama section
  if (data.ollama.connected) {
    const model = data.ollama.modelName ?? 'unknown';
    const time = data.ollama.responseTimeMs != null ? `${data.ollama.responseTimeMs}ms` : '';
    lines.push(chalk.green('  Ollama:  Connected') + `  ${model}  ${time}`);
  } else {
    lines.push(chalk.red('  Ollama:  Disconnected') + `  ${data.ollama.error ?? ''}`);
  }
  lines.push('');

  // Active plans section
  lines.push(chalk.bold('  Active Plans'));
  if (data.activePlans.length === 0) {
    lines.push(chalk.dim('  (none)'));
  } else {
    for (const session of data.activePlans) {
      if (session.currentPlan) {
        const plan = session.currentPlan;
        const total = plan.steps.length;
        const current = plan.currentStep;
        const filled = total > 0 ? Math.round((current / total) * 10) : 0;
        const bar = '='.repeat(filled) + '-'.repeat(10 - filled);
        lines.push(`  ${plan.description.padEnd(30)} ${current}/${total} [${bar}]  ${session.sessionId}`);
      } else {
        lines.push(`  ${'(no plan)'.padEnd(30)} ${session.sessionId}`);
      }
    }
  }
  lines.push('');

  // Recent sessions section
  lines.push(chalk.bold('  Recent Sessions'));
  if (data.recentSessions.length === 0) {
    lines.push(chalk.dim('  (none)'));
  } else {
    for (const session of data.recentSessions) {
      const date = session.updatedAt.slice(0, 16).replace('T', ' ');
      const statusColor = session.status === 'completed' ? chalk.green : session.status === 'failed' ? chalk.red : chalk.yellow;
      lines.push(`  ${session.sessionId.padEnd(40)} ${statusColor(session.status.padEnd(12))} ${date}`);
    }
  }

  // Locks section -- only shown when locks exist
  if (data.locks.length > 0) {
    lines.push('');
    lines.push(chalk.bold('  Locks'));
    for (const lock of data.locks) {
      const ageMs = Date.now() - new Date(lock.createdAt).getTime();
      const age = formatAge(ageMs);
      lines.push(`  ${lock.target.padEnd(20)} ${lock.adminName.padEnd(15)} ${age}`);
    }
  }

  return lines.join('\n');
}

// ---------- History Table ----------

/**
 * Format audit entries as a compact table or verbose listing.
 * Compact mode: one line per entry (TIMESTAMP | TYPE | RISK | SUMMARY).
 * Verbose mode: adds reasoning, diffBefore/diffAfter below each entry.
 */
export function formatHistoryTable(entries: AuditEntry[], verbose: boolean): string {
  if (entries.length === 0) {
    return 'No audit entries found matching filters.';
  }

  const COL_TIMESTAMP = 18;
  const COL_TYPE = 22;
  const COL_RISK = 14;
  const COL_SUMMARY = 60;

  const lines: string[] = [];

  // Header
  lines.push(
    chalk.bold(
      'TIMESTAMP'.padEnd(COL_TIMESTAMP) +
        'TYPE'.padEnd(COL_TYPE) +
        'RISK'.padEnd(COL_RISK) +
        'SUMMARY'
    )
  );

  for (const entry of entries) {
    // Format timestamp: MM-DD HH:MM:SS
    const ts = entry.timestamp;
    const d = new Date(ts);
    const month = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    const hh = String(d.getUTCHours()).padStart(2, '0');
    const mm = String(d.getUTCMinutes()).padStart(2, '0');
    const ss = String(d.getUTCSeconds()).padStart(2, '0');
    const shortTs = `${month}-${day} ${hh}:${mm}:${ss}`;

    // Type column (truncated)
    const eventType = entry.eventType.length > COL_TYPE - 2
      ? entry.eventType.slice(0, COL_TYPE - 2)
      : entry.eventType;

    // Risk column with color
    const risk = entry.riskLevel ?? '-';
    let riskFormatted: string;
    switch (risk) {
      case 'read':
        riskFormatted = chalk.green(risk.padEnd(COL_RISK));
        break;
      case 'write':
        riskFormatted = chalk.yellow(risk.padEnd(COL_RISK));
        break;
      case 'destructive':
        riskFormatted = chalk.red(risk.padEnd(COL_RISK));
        break;
      default:
        riskFormatted = risk.padEnd(COL_RISK);
    }

    // Summary: command or decision, truncated
    const summary = (entry.command ?? entry.decision ?? '').slice(0, COL_SUMMARY);

    lines.push(
      shortTs.padEnd(COL_TIMESTAMP) +
        eventType.padEnd(COL_TYPE) +
        riskFormatted +
        summary
    );

    // Verbose details
    if (verbose) {
      if (entry.reasoning) {
        lines.push(chalk.dim(`    Reasoning: ${truncateLines(entry.reasoning, 3)}`));
      }
      if (entry.diffBefore) {
        lines.push(chalk.dim(`    Before: ${truncateLines(entry.diffBefore, 3)}`));
      }
      if (entry.diffAfter) {
        lines.push(chalk.dim(`    After:  ${truncateLines(entry.diffAfter, 3)}`));
      }
    }
  }

  return lines.join('\n');
}

function truncateLines(text: string, maxLines: number): string {
  const lines = text.split('\n');
  if (lines.length <= maxLines) return text;
  return lines.slice(0, maxLines).join('\n') + '...';
}

function formatAge(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
