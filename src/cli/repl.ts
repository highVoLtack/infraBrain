import * as readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import type { Command } from 'commander';
import chalk from 'chalk';
import { REPL_PROMPT, formatError } from './formatter.js';
import { setReadline } from './commands.js';

interface ReplConfig {
  apiBaseUrl: string;
  program: Command;
}

interface HealthResponse {
  status: string;
  ollama: 'connected' | 'disconnected';
  models?: Array<{ name: string }>;
  error?: string;
}

/**
 * Start the interactive REPL loop.
 * Feels like a dedicated tool (psql-style), not a chatbot.
 */
export async function startRepl(config: ReplConfig): Promise<void> {
  const rl = readline.createInterface({
    input: stdin,
    output: stdout,
  });

  // Wire readline into commands for interactive approval prompts
  setReadline(rl);

  // Display welcome banner
  console.log(chalk.bold('\nInfraBrain v1.0.0'));
  console.log(chalk.gray('AI IT Operations Platform\n'));

  // Check Ollama connectivity on startup
  try {
    const res = await fetch(`${config.apiBaseUrl}/health`);
    const data = await res.json() as HealthResponse;

    if (data.ollama === 'connected') {
      console.log(chalk.green('Ollama: connected'));
      if (data.models && data.models.length > 0) {
        console.log(chalk.gray(`Models: ${data.models.map(m => m.name).join(', ')}`));
      }
    } else {
      console.log(chalk.yellow(data.error ?? 'Ollama not detected. Run `ollama serve` first.'));
    }
  } catch {
    console.log(chalk.yellow('Could not reach InfraBrain API. Is the server running?'));
  }

  console.log(chalk.gray('\nType /infra:debug "<prompt>" to diagnose an issue'));
  console.log(chalk.gray('Type /infra:health to check status'));
  console.log(chalk.gray('Type "exit" or "quit" to leave\n'));

  // Handle Ctrl+C gracefully
  rl.on('close', () => {
    console.log(chalk.gray('\nGoodbye.'));
    process.exit(0);
  });

  // REPL loop
  while (true) {
    let input: string;
    try {
      input = await rl.question(REPL_PROMPT);
    } catch {
      // readline closed (Ctrl+C or Ctrl+D)
      break;
    }

    const trimmed = input.trim();

    if (!trimmed) continue;

    // Exit commands
    if (trimmed === 'exit' || trimmed === 'quit') {
      console.log(chalk.gray('Goodbye.'));
      rl.close();
      break;
    }

    // Route /infra: commands to Commander
    if (trimmed.startsWith('/infra:')) {
      // Parse the command: "/infra:debug "test"" -> ["debug", "test"]
      const withoutPrefix = trimmed.replace(/^\/infra:/, '');
      const parts = parseCommandLine(withoutPrefix);

      if (parts.length === 0) {
        console.log(formatError('Unknown command. Try /infra:debug or /infra:health'));
        continue;
      }

      try {
        // Pause readline during command execution to prevent prompt interference
        rl.pause();
        await config.program.parseAsync(parts, { from: 'user' });
      } catch (err) {
        console.log(formatError(`Command error: ${(err as Error).message}`));
      } finally {
        rl.resume();
      }
      continue;
    }

    // Unknown input
    console.log(chalk.gray('Unknown command. Commands start with /infra:'));
    console.log(chalk.gray('  /infra:debug "<prompt>"  - Diagnose an issue'));
    console.log(chalk.gray('  /infra:health            - Check system status'));
  }
}

/**
 * Parse a command line string into arguments, respecting quotes.
 * "/infra:debug "test prompt"" -> ["debug", "test prompt"]
 */
function parseCommandLine(input: string): string[] {
  const args: string[] = [];
  let current = '';
  let inQuote = false;
  let quoteChar = '';

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (inQuote) {
      if (ch === quoteChar) {
        inQuote = false;
      } else {
        current += ch;
      }
    } else if (ch === '"' || ch === "'") {
      inQuote = true;
      quoteChar = ch;
    } else if (ch === ' ') {
      if (current) {
        args.push(current);
        current = '';
      }
    } else {
      current += ch;
    }
  }

  if (current) {
    args.push(current);
  }

  return args;
}
