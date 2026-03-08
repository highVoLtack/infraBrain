import { Command } from 'commander';
import type * as readline from 'node:readline/promises';
import { formatDiagnosis, formatCommand, formatError, formatApprovalResult, formatStatusDashboard } from './formatter.js';
import { requestApproval } from './approval.js';
import type { RiskLevel } from '../safety/types.js';
import { formatPlanTable } from '../orchestrator/planner.js';
import type { FixPlan } from '../orchestrator/types.js';
import { envelope, errorEnvelope } from './json-envelope.js';

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

  return program;
}

/**
 * Set the readline instance for interactive approval prompts.
 * Called by startRepl after creating the readline interface.
 */
export function setReadline(rl: readline.Interface): void {
  moduleRl = rl;
}
