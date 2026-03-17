import { Command } from 'commander';
import type * as readline from 'node:readline/promises';
import chalk from 'chalk';
import { formatDiagnosis, formatCommand, formatError, formatApprovalResult, formatStatusDashboard, formatHistoryTable, formatResumeSummary, formatDPEVSummary, formatSessionList } from './formatter.js';

/** Simple CLI spinner for long-running operations */
function createSpinner(message: string) {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let i = 0;
  const start = Date.now();
  const interval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - start) / 1000);
    process.stdout.write(`\r${chalk.cyan(frames[i++ % frames.length])} ${message} ${chalk.gray(`(${elapsed}s)`)}`);
  }, 80);
  return {
    update(msg: string) { message = msg; },
    stop(finalMsg?: string) {
      clearInterval(interval);
      const elapsed = Math.floor((Date.now() - start) / 1000);
      process.stdout.write(`\r${finalMsg ?? `${chalk.green('✓')} ${message} ${chalk.gray(`(${elapsed}s)`)}`}\n`);
    },
  };
}
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

// Last debug result — used by /infra:execute to auto-pick the most recent plan
let lastDebugResult: { sessionId: string; fixPlan: FixPlan; target: string; skillName?: string; containers?: string[]; discoveryContext?: Record<string, string> } | undefined;

interface IncompleteSessionInfo {
  sessionId: string;
  target?: string;
  stoppedAtStep: number;
  totalSteps: number;
  stoppedAt: string;
}

interface StructuredDiagnosisResponse {
  steps: Array<{ step: number; label: string; command: string; output: string; finding: string }>;
  rootCause: string;
  correlation: string;
  fixPlan: Array<{ command: string; risk: string; expected: string }>;
}

interface DebugResponse {
  sessionId: string;
  skillMessage?: string;
  discovery?: Record<string, string>;
  diagnosis: string;
  structuredDiagnosis?: StructuredDiagnosisResponse;
  commands: Array<{
    command: string;
    riskLevel: RiskLevel;
    allowed: boolean;
    reason?: string;
  }>;
  fixPlan?: FixPlan;
  skillName?: string;
  containers?: string[];
  incompleteSession?: IncompleteSessionInfo;
}

interface ResumeResponse {
  status: string;
  sessionId: string;
  resumedFrom: number;
  action: string;
  warning?: string;
  stepResults: Array<{ stepIndex: number; status: string }>;
  session?: Record<string, unknown>;
}

interface BackendHealth {
  baseUrl: string;
  connected: boolean;
  models?: string[];
  error?: string;
}

interface HealthResponse {
  status: string;
  backends?: BackendHealth[];
  summary?: 'all_connected' | 'partial' | 'all_disconnected';
  ollama?: 'connected' | 'disconnected';
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

        const spinner = jsonMode ? null : createSpinner('Diagnosing issue via LLM...');

        const res = await fetch(`${config.apiBaseUrl}/debug`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          spinner?.stop(chalk.red('✗ Diagnosis failed'));
          const body = await res.json() as { error: string };
          if (jsonMode) {
            console.log(JSON.stringify(errorEnvelope('debug', body.error)));
            return;
          }
          console.log(formatError(`Error: ${body.error}`));
          return;
        }

        const data = await res.json() as DebugResponse;
        spinner?.stop();

        if (jsonMode) {
          console.log(JSON.stringify(envelope('debug', data)));
          return;
        }

        // Auto-detect incomplete session
        if (data.incompleteSession) {
          const inc = data.incompleteSession;
          const rl = config.rl ?? moduleRl;
          if (rl) {
            console.log(`\nFound incomplete plan for '${inc.target ?? 'unknown'}' at step ${inc.stoppedAtStep}/${inc.totalSteps}.`);
            const answer = await rl.question('Resume from last step or start fresh? (resume/fresh) ');
            if (answer.trim().toLowerCase() === 'resume') {
              try {
                const resumeRes = await fetch(`${config.apiBaseUrl}/resume`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ sessionId: inc.sessionId, action: 'retry' }),
                });
                const resumeData = await resumeRes.json() as ResumeResponse;
                console.log(`\nResumed session ${inc.sessionId}: ${resumeData.status}`);
                if (resumeData.warning) {
                  console.log(formatError(resumeData.warning));
                }
              } catch (err) {
                console.log(formatError(`Resume failed: ${(err as Error).message}`));
              }
              return;
            }
          }
        }

        // Store last debug result for /infra:execute (includes self-healing context)
        if (data.fixPlan && data.sessionId) {
          lastDebugResult = {
            sessionId: data.sessionId,
            fixPlan: data.fixPlan,
            target: (data as unknown as Record<string, unknown>).target as string ?? 'unknown',
            skillName: data.skillName,
            containers: data.containers,
            discoveryContext: data.discovery,
          };
        }

        // Display skill selection message
        if (data.skillMessage) {
          console.log('\n' + data.skillMessage);
        }

        // Display discovery results (ground truth from live system)
        if (data.discovery && Object.keys(data.discovery).length > 0) {
          console.log(chalk.gray('\n  Discovery (live system):'));
          for (const [label, value] of Object.entries(data.discovery)) {
            console.log(chalk.gray(`    ${label}: ${value.replace(/\n/g, ', ')}`));
          }
        }

        // Structured diagnosis: display rootCause + fixPlan table only (no LLM chatter)
        if (data.structuredDiagnosis) {
          const sd = data.structuredDiagnosis;
          console.log('\n' + chalk.bold('Root Cause: ') + sd.rootCause);
          console.log(chalk.gray('Correlation: ') + sd.correlation);
          console.log('');
          // Display structured fix plan as table
          console.log(chalk.bold('  #   Command' + ' '.repeat(52) + 'Risk        Expected'));
          console.log('  ' + '─'.repeat(4) + ' ' + '─'.repeat(56) + ' ' + '─'.repeat(12) + ' ' + '─'.repeat(50));
          for (let i = 0; i < sd.fixPlan.length; i++) {
            const step = sd.fixPlan[i];
            const num = String(i + 1).padEnd(4);
            const cmd = step.command.length > 54 ? step.command.slice(0, 51) + '...' : step.command.padEnd(56);
            const risk = step.risk === 'read' ? chalk.green(step.risk.padEnd(12)) : step.risk === 'write' ? chalk.yellow(step.risk.padEnd(12)) : chalk.red(step.risk.padEnd(12));
            const expected = step.expected.length > 50 ? step.expected.slice(0, 47) + '...' : step.expected;
            console.log(`  ${num} ${cmd} ${risk} ${expected}`);
          }
          console.log(chalk.gray('\n  Run /infra:execute to apply this fix plan.\n'));
        } else {
          // Fallback: display free-text diagnosis
          console.log('\n' + formatDiagnosis(data.diagnosis));

          // Display fix plan if present
          if (data.fixPlan) {
            console.log('\n' + formatPlanTable(data.fixPlan));
            console.log(chalk.gray('  Run /infra:execute to apply this fix plan.\n'));
          }
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

        if (data.backends && data.backends.length > 0) {
          for (const backend of data.backends) {
            if (backend.connected) {
              console.log(`Backend ${backend.baseUrl}: connected`);
              if (backend.models && backend.models.length > 0) {
                console.log('  Models:');
                for (const model of backend.models) {
                  console.log(`    - ${model}`);
                }
              }
            } else {
              console.log(formatError(`Backend ${backend.baseUrl}: disconnected${backend.error ? ` (${backend.error})` : ''}`));
            }
          }
          console.log(`\nSummary: ${data.summary}`);
        } else {
          console.log(formatError('No backends detected. Check your defaultBaseUrl config.'));
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
    .option('--list', 'Show session overview')
    .action(async function (this: Command, options: { session?: string; type?: string; risk?: string; since?: string; until?: string; limit?: string; verbose?: boolean; list?: boolean }) {
      const jsonMode = this.optsWithGlobals().json;
      const verbose = options.verbose ?? false;
      try {
        // Build query params
        const params = new URLSearchParams();

        // --list mode: fetch session overview
        if (options.list) {
          params.set('list', 'true');
          if (options.limit) params.set('limit', options.limit);

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

          const data = await res.json() as { sessions: Array<{ id: string; status: string; target: string; updatedAt: string; eventCount: number }>; count: number };

          if (jsonMode) {
            console.log(JSON.stringify(envelope('history', data)));
            return;
          }

          console.log('\n' + formatSessionList(data.sessions) + '\n');
          return;
        }

        // Default-to-latest (UX-01): when no --session and no other filters, auto-send ?session=last
        const hasFilters = options.type || options.risk || options.since || options.until;
        const isDefaultLatest = !options.session && !hasFilters;

        if (isDefaultLatest) {
          params.set('session', 'last');
        } else if (options.session) {
          params.set('session', options.session);
        }

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

        // Non-verbose: show compact DPEV summary above the table
        if (!verbose && data.entries.length > 0) {
          console.log('\n' + formatDPEVSummary(data.entries as any));
        }

        console.log('\n' + formatHistoryTable(data.entries as any, verbose));

        // Footer hint when showing auto-resolved latest session
        if (isDefaultLatest && data.entries.length > 0) {
          console.log(chalk.gray('Showing latest session. Use --list to see all sessions.'));
        }

        console.log('');
      } catch (err) {
        if (jsonMode) {
          console.log(JSON.stringify(errorEnvelope('history', (err as Error).message)));
          return;
        }
        console.log(formatError(`Failed to connect to API: ${(err as Error).message}`));
      }
    });

  program
    .command('resume')
    .alias('/infra:resume')
    .description('Resume an interrupted fix plan')
    .argument('<session-id>', 'Session ID to resume')
    .action(async function (this: Command, sessionId: string) {
      const jsonMode = this.optsWithGlobals().json;
      try {
        // First fetch session info to show summary (use resume with a GET-like check)
        const rl = config.rl ?? moduleRl;
        let action: 'retry' | 'skip' = 'retry';

        if (!jsonMode && rl) {
          const answer = await rl.question('Retry the failed step or skip to next? (retry/skip) ');
          if (answer.trim().toLowerCase() === 'skip') {
            action = 'skip';
          }
        }

        const res = await fetch(`${config.apiBaseUrl}/resume`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId, action }),
        });

        if (!res.ok) {
          const body = await res.json() as { error: string };
          if (jsonMode) {
            console.log(JSON.stringify(errorEnvelope('resume', body.error)));
            return;
          }
          console.log(formatError(`Error: ${body.error}`));
          return;
        }

        const data = await res.json() as ResumeResponse;

        if (jsonMode) {
          console.log(JSON.stringify(envelope('resume', data)));
          return;
        }

        // Display session summary before execution results
        if (data.session) {
          console.log('\n' + formatResumeSummary(data.session as any));
        }

        console.log(`\nResumed session ${sessionId}: ${data.status}`);
        console.log(`  Resumed from step ${data.resumedFrom}, action: ${data.action}`);

        if (data.warning) {
          console.log(formatError(data.warning));
        }

        const completed = data.stepResults.filter(s => s.status === 'success').length;
        const skipped = data.stepResults.filter(s => s.status === 'skipped').length;
        console.log(`  Results: ${completed} completed, ${skipped} skipped\n`);
      } catch (err) {
        if (jsonMode) {
          console.log(JSON.stringify(errorEnvelope('resume', (err as Error).message)));
          return;
        }
        console.log(formatError(`Failed to connect to API: ${(err as Error).message}`));
      }
    });

  program
    .command('execute')
    .alias('/infra:execute')
    .description('Execute the fix plan from the last /infra:debug diagnosis')
    .option('--admin <name>', 'Admin name for audit trail', 'admin')
    .action(async function (this: Command, options: { admin: string }) {
      const jsonMode = this.optsWithGlobals().json;
      try {
        if (!lastDebugResult) {
          const msg = 'No fix plan available. Run /infra:debug first to generate a diagnosis and fix plan.';
          if (jsonMode) {
            console.log(JSON.stringify(errorEnvelope('execute', msg)));
            return;
          }
          console.log(formatError(msg));
          return;
        }

        const { sessionId, fixPlan, target } = lastDebugResult;

        // Show what we're about to execute and ask for confirmation
        const rl = config.rl ?? moduleRl;
        if (!jsonMode && rl) {
          console.log(`\nExecuting fix plan: ${fixPlan.summary}`);
          console.log(`  Target: ${target}`);
          console.log(`  Steps: ${fixPlan.steps.length}`);
          console.log(`  Session: ${sessionId}\n`);
          const answer = await rl.question('Proceed with execution? (yes/no) ');
          if (answer.trim().toLowerCase() !== 'yes' && answer.trim().toLowerCase() !== 'y') {
            console.log(chalk.gray('Execution cancelled.\n'));
            return;
          }
        }

        const execSpinner = jsonMode ? null : createSpinner('Executing fix plan...');

        const res = await fetch(`${config.apiBaseUrl}/execute`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId,
            fixPlan,
            target,
            adminName: options.admin,
            // Self-healing context from debug route
            skillName: lastDebugResult.skillName,
            containers: lastDebugResult.containers,
            discoveryContext: lastDebugResult.discoveryContext,
          }),
        });

        execSpinner?.stop();

        if (!res.ok) {
          const body = await res.json() as { error: string };
          if (jsonMode) {
            console.log(JSON.stringify(errorEnvelope('execute', body.error)));
            return;
          }
          console.log(formatError(`Execution failed: ${body.error}`));
          return;
        }

        const data = await res.json() as {
          status: string;
          reason?: string;
          stoppedAt?: number;
          stepResults: Array<{
            stepIndex: number;
            status: string;
            runResult?: { stdout: string; stderr: string; exitCode: number };
            retries: number;
            damageCost: number;
          }>;
        };

        if (jsonMode) {
          console.log(JSON.stringify(envelope('execute', data)));
          return;
        }

        // Display results
        const statusColor = data.status === 'completed' ? chalk.green : chalk.red;
        console.log(`\n${chalk.bold('Execution Result:')} ${statusColor(data.status)}`);
        if (data.reason) {
          console.log(`  Reason: ${chalk.yellow(data.reason)}`);
        }

        for (const step of data.stepResults) {
          const icon = step.status === 'success' ? chalk.green('✓') : step.status === 'skipped' ? chalk.gray('○') : chalk.red('✗');
          console.log(`  ${icon} Step ${step.stepIndex + 1}: ${step.status}`);

          if (step.runResult) {
            if (step.runResult.stdout.trim()) {
              console.log(chalk.gray(`    stdout: ${step.runResult.stdout.trim()}`));
            }
            if (step.runResult.stderr.trim()) {
              console.log(chalk.yellow(`    stderr: ${step.runResult.stderr.trim()}`));
            }
            if (step.runResult.exitCode !== 0) {
              console.log(chalk.red(`    exit code: ${step.runResult.exitCode}`));
            }
          }

          if (step.retries > 0) {
            console.log(chalk.yellow(`    retries: ${step.retries}`));
          }
        }

        if (data.stoppedAt !== undefined) {
          console.log(chalk.red(`\n  Execution halted at step ${data.stoppedAt + 1}.`));
        }

        // Show audit hint
        console.log(`\n${chalk.gray(`Audit: /infra:history --session ${sessionId}`)}\n`);

        // Clear the stored plan after execution
        lastDebugResult = undefined;
      } catch (err) {
        if (jsonMode) {
          console.log(JSON.stringify(errorEnvelope('execute', (err as Error).message)));
          return;
        }
        console.log(formatError(`Execution failed: ${(err as Error).message}`));
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
