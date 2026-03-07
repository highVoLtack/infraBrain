// InfraBrain - AI IT Operations Platform
// Application entry point: wires LLM, state, safety, API, and CLI together

import { join } from 'node:path';
import chalk from 'chalk';

import { loadConfig } from './config/loader.js';
import { createOllamaModel } from './llm/ollama.js';
import { createProvider } from './llm/provider.js';
import { initDatabase } from './state/db.js';
import { createSession } from './state/session.js';
import { WriteThrough } from './state/store.js';
import { AuditLogger } from './audit/logger.js';
import { validateCommand } from './safety/validator.js';
import { createServer } from './api/server.js';
import { registerCommands } from './cli/commands.js';
import { startRepl } from './cli/repl.js';

// Re-exports for library usage
export { createProvider } from './llm/provider.js';
export { createOllamaModel } from './llm/ollama.js';
export type { LLMProvider, TokenUsage, TaskBudget } from './llm/types.js';
export { estimateTokens, checkBudget, trackUsage } from './llm/token-budget.js';
export type { BudgetCheck } from './llm/token-budget.js';

async function main(): Promise<void> {
  const baseDir = process.cwd();

  // Load configuration
  const config = loadConfig(baseDir);

  // Initialize LLM
  const model = createOllamaModel(config.modelName);
  const provider = createProvider(model);

  // Initialize state storage
  const dbPath = join(baseDir, '.infrabrain', 'infrabrain.db');
  const db = initDatabase(dbPath);
  const store = new WriteThrough(db);

  // Create session
  const session = createSession(baseDir);
  const sessionDir = join(baseDir, '.infrabrain', 'sessions', session.sessionId);

  // Persist initial session state
  store.persistState(sessionDir, session);

  // Create audit logger
  const auditLogger = new AuditLogger(store, session.sessionId, sessionDir);

  // Create Express server
  const apiBaseUrl = `http://localhost:${config.apiPort}`;
  const { app, start } = createServer({
    provider,
    auditLogger,
    validator: validateCommand,
    ollamaBaseUrl: config.ollamaBaseUrl,
  });

  // Start server
  const { server } = await start(config.apiPort);
  console.log(chalk.gray(`[API] Listening on ${apiBaseUrl}`));

  // Register CLI commands
  const program = registerCommands({ apiBaseUrl });

  // Check if one-shot mode (CLI args present)
  const args = process.argv.slice(2);
  if (args.length > 0) {
    // One-shot mode: parse args and exit
    try {
      await program.parseAsync(args, { from: 'user' });
    } catch (err) {
      console.error(chalk.red(`Error: ${(err as Error).message}`));
    }
    server.close();
    db.close();
    return;
  }

  // Interactive REPL mode
  await startRepl({ apiBaseUrl, program });

  // Cleanup on exit
  server.close();
  db.close();
}

// Run application
main().catch((err) => {
  console.error(chalk.red(`Fatal error: ${(err as Error).message}`));

  // Handle common startup errors with helpful messages
  if ((err as Error).message?.includes('ECONNREFUSED')) {
    console.error(chalk.yellow('Hint: Is Ollama running? Try `ollama serve`'));
  }
  if ((err as Error).message?.includes('EACCES') || (err as Error).message?.includes('EPERM')) {
    console.error(chalk.yellow('Hint: Check file permissions for .infrabrain/ directory'));
  }

  process.exit(1);
});
