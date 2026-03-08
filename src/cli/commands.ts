import { Command } from 'commander';
import type * as readline from 'node:readline/promises';
import { formatDiagnosis, formatCommand, formatError, formatApprovalResult, formatStatusDashboard, formatHistoryTable } from './formatter.js';
import { requestApproval } from './approval.js';
import type { RiskLevel } from '../safety/types.js';
import { formatPlanTable } from '../orchestrator/planner.js';
import type { FixPlan } from '../orchestrator/types.js';
import { envelope, errorEnvelope } from './json-envelope.js';
import { parseTimeInput } from './time-parser.js';

export interface CommandConfig {
  apiBaseUrl: string;
  rl?: readline.Interface;
}

// Module-level rl reference for late binding (REPL creates rl after commands are registered)
let moduleRl: readline.Interface | undefined;

interface DebugResponse {
  sessionId: string;
  skillMessage?: string;
  diagnosis: string;
  commands: Array<{
    command: string;
    riskLevel: RiskLevel;
    allowed: boolean;
    reason?: string;
  }>;
  fixPlan?: FixPlan;
}

interface HealthResponse {
  status: string;
  ollama: 'connected' | 'disconnected';
  models?: Array<{ name: string }>;
  error?: string;
}

/**
 * Register CLI commands. All commands call the REST API internally
 * (API is the single execution path, per user decision).
 */
export function registerCommands(config: CommandConfig): Command {
  const program = new Command();
  program.name('infrabrain');
  program.description('AI IT operations platform');
  program.option('--json', 'Output in machine-parseable JSON format');

  program
    .command('debug')
    .alias('/infra:debug')
    .description('Diagnose an infrastructure issue')
    .argument('<prompt>', 'Description of the issue to diagnose')
    .option('--skill <name>', 'Override skill selection')
    .action(async function (this: Command, prompt: string, options: { skill?: string }) {
      const jsonMode = this.optsWithGlobals().json;
      try {
        const body: Record<string, string> = { prompt };
        if (options.skill) {
          body.skill = options.skill;
        }

        const res = await fetch(`${config.apiBaseUrl}/debug`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          const body = await res.json() as { error: string };
          if (jsonMode) {
            console.log(JSON.stringify(errorEnvelope('debug', body.error)));
            return;
          }
          console.log(formatError(`Error: ${body.error}`));
          return;
        }

        const data = await res.json() as DebugResponse;

        if (jsonMode) {
          console.log(JSON.stringify(envelope('debug', data)));
          return;
        }

        // Display skill selection message
        if (data.skillMessage) {
          console.log('\n' + data.skillMessage);
        }

        // Display diagnosis
        console.log('\n' + formatDiagnosis(data.diagnosis));

        // Display fix plan if present
        if (data.fixPlan) {
          console.log('\n' + formatPlanTable(data.fixPlan));
        }

        // Display commands with risk levels and approval gate
        if (data.commands.length > 0) {
          console.log('\nSuggested commands:');
          for (const cmd of data.commands) {
            console.log('  ' + formatCommand(cmd.command, cmd.riskLevel, cmd.allowed));

            // Approval gate: only for allowed commands when readline is available (interactive mode)
            const rl = config.rl ?? moduleRl;
            if (cmd.allowed && rl) {
              const result = await requestApproval(cmd.command, cmd.riskLevel as RiskLevel, rl);
              console.log('  ' + formatApprovalResult(result));
            }
          }
        }
        console.log('');
      } catch (err) {
        if (jsonMode) {
          console.log(JSON.stringify(errorEnvelope('debug', (err as Error).message)));
          return;
        }
        console.log(formatError(`Failed to connect to API: ${(err as Error).message}`));
      }
    });

  program
    .command('health')
    .alias('/infra:health')
    .description('Check Ollama connectivity and model status')
    .action(async function (this: Command) {
      const jsonMode = this.optsWithGlobals().json;
      try {
        const res = await fetch(`${config.apiBaseUrl}/health`);
        const data = await res.json() as HealthResponse;

        if (jsonMode) {
          console.log(JSON.stringify(envelope('health', data)));
          return;
        }

        if (data.ollama === 'connected') {
          console.log(`Ollama: connected`);
          if (data.models && data.models.length > 0) {
            console.log('Models:');
            for (const model of data.models) {
              console.log(`  - ${model.name}`);
            }
          }
        } else {
          console.log(formatError(data.error ?? 'Ollama not connected'));
        }
      } catch (err) {
        if (jsonMode) {
          console.log(JSON.stringify(errorEnvelope('health', (err as Error).message)));
          return;
        }
        console.log(formatError(`Failed to connect to API: ${(err as Error).message}`));
      }
    });

  program
    .command('status')
    .alias('/infra:status')
    .description('Show system status dashboard (Ollama health, active plans, sessions, locks)')
    .action(async function (this: Command) {
      const jsonMode = this.optsWithGlobals().json;
      try {
        const res = await fetch(`${config.apiBaseUrl}/status`);

        if (!res.ok) {
          const body = await res.json() as { error: string };
          if (jsonMode) {
            console.log(JSON.stringify(errorEnvelope('status', body.error)));
            return;
          }
          console.log(formatError(`Error: ${body.error}`));
          return;
        }

        const data = await res.json();

        if (jsonMode) {
          console.log(JSON.stringify(envelope('status', data)));
          return;
        }

        console.log('\n' + formatStatusDashboard(data) + '\n');
      } catch (err) {
        if (jsonMode) {
          console.log(JSON.stringify(errorEnvelope('status', (err as Error).message)));
          return;
        }
        console.log(formatError(`Failed to connect to API: ${(err as Error).message}`));
      }
    });

  program
    .command('history')
    .alias('/infra:history')
    .description('Query the audit log with filters')
    .option('--session <id>', 'Filter by session ID')
    .option('--type <event>', 'Filter by event type')
    .option('--risk <level>', 'Filter by risk level')
    .option('--since <time>', 'Filter entries after time (e.g., "1h ago", ISO 8601)')
    .option('--until <time>', 'Filter entries before time (e.g., "30m ago", ISO 8601)')
    .option('--limit <n>', 'Maximum entries to return (default 20)', '20')
    .option('--verbose', 'Show expanded entry details')
    .action(async function (this: Command, options: { session?: string; type?: string; risk?: string; since?: string; until?: string; limit?: string; verbose?: boolean }) {
      const jsonMode = this.optsWithGlobals().json;
      const verbose = options.verbose ?? false;
      try {
        // Build query params
        const params = new URLSearchParams();
        if (options.session) params.set('session', options.session);
        if (options.type) params.set('type', options.type);
        if (options.risk) params.set('risk', options.risk);
        if (options.since) {
          // Validate time input client-side for better error messages
          parseTimeInput(options.since);
          params.set('since', options.since);
        }
        if (options.until) {
          parseTimeInput(options.until);
          params.set('until', options.until);
        }
        if (options.limit) params.set('limit', options.limit);
        if (verbose) params.set('verbose', 'true');

        const qs = params.toString();
        const url = `${config.apiBaseUrl}/history${qs ? `?${qs}` : ''}`;
        const res = await fetch(url);

        if (!res.ok) {
          const body = await res.json() as { error: string };
          if (jsonMode) {
            console.log(JSON.stringify(errorEnvelope('history', body.error)));
            return;
          }
          console.log(formatError(`Error: ${body.error}`));
          return;
        }

        const data = await res.json() as { entries: Array<Record<string, unknown>>; count: number; filters: Record<string, string> };

        if (jsonMode) {
          // In verbose JSON mode, include full entry details; in non-verbose, include as-is
          console.log(JSON.stringify(envelope('history', data)));
          return;
        }

        console.log('\n' + formatHistoryTable(data.entries as any, verbose) + '\n');
      } catch (err) {
        if (jsonMode) {
          console.log(JSON.stringify(errorEnvelope('history', (err as Error).message)));
          return;
        }
        console.log(formatError(`Failed to connect to API: ${(err as Error).message}`));
      }
    });

  return program;
}

/**
 * Set the readline instance for interactive approval prompts.
 * Called by startRepl after creating the readline interface.
 */
export function setReadline(rl: readline.Interface): void {
  moduleRl = rl;
}
