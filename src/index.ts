// InfraBrain - AI IT Operations Platform
// Application entry point: wires LLM, state, safety, API, and CLI together

import { join } from 'node:path';
import chalk from 'chalk';
import React from 'react';
import { render } from 'ink';

import { loadConfig } from './config/loader.js';
import { createCompatModel, createModelRegistry } from './llm/openai-compat.js';
import { createProvider } from './llm/provider.js';
import { initDatabase } from './state/db.js';
import { createSession } from './state/session.js';
import { WriteThrough } from './state/store.js';
import { AuditLogger } from './audit/logger.js';
import { validateCommand } from './safety/validator.js';
import { createServer } from './api/server.js';
import { registerCommands } from './cli/commands.js';
import { App } from './ui/App.js';
import { SkillRegistry } from './skills/registry.js';
import { getCacheStore } from './cache/lance-store.js';
import { runStartupInvalidation } from './cache/invalidation.js';
import { isEmbeddingAvailable } from './cache/embedder.js';
import { resolveEmbeddingConfig } from './config/types.js';

// Re-exports for library usage
export { createProvider } from './llm/provider.js';
export { createCompatModel, createModelRegistry } from './llm/openai-compat.js';
export type { LLMProvider, ModelRegistry, TokenUsage, TaskBudget } from './llm/types.js';
export type { ModelRole, ModelMap } from './config/types.js';
export { estimateTokens, checkBudget, trackUsage } from './llm/token-budget.js';
export type { BudgetCheck } from './llm/token-budget.js';

async function main(): Promise<void> {
  const baseDir = process.cwd();

  // Load configuration
  const config = loadConfig(baseDir);

  // Initialize LLM with multi-model registry
  const modelRegistry = createModelRegistry(config.modelMap, config.defaultBaseUrl);
  const model = modelRegistry.getDefault();
  const provider = createProvider(model, modelRegistry);

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

  // Load skills
  const registry = new SkillRegistry();
  const skillsDir = join(baseDir, config.skillsDir);
  try {
    registry.populate(skillsDir);
    const loadedSkills = registry.list();
    console.log(chalk.gray(`[Skills] Loaded ${loadedSkills.length} skills from ${config.skillsDir}`));
  } catch {
    console.log(chalk.gray(`[Skills] No skills directory found at ${config.skillsDir}`));
  }

  // Initialize fix cache: startup invalidation + embedding model check
  try {
    const cacheDataDir = config.cache?.dataDir ?? '.infrabrain/cache';
    const cacheStore = getCacheStore(cacheDataDir);
    await cacheStore.init();
    await runStartupInvalidation(cacheStore, skillsDir, join(cacheDataDir, 'skill-hashes.json'));
    console.log(chalk.gray('[Cache] Fix cache initialized'));

    // Check if embedding model is available
    const embCfg = resolveEmbeddingConfig(config);
    const embeddingOk = await isEmbeddingAvailable(embCfg.baseURL, embCfg.modelId, { apiKey: embCfg.apiKey });
    if (!embeddingOk) {
      console.log(chalk.yellow('[Cache] WARNING: Embedding model not reachable -- cache lookups will degrade gracefully'));
    }
  } catch (cacheErr) {
    console.log(chalk.yellow(`[Cache] Fix cache init failed (non-critical): ${(cacheErr as Error).message}`));
  }

  // Create Express server
  const { app, start } = createServer({
    provider,
    auditLogger,
    validator: validateCommand,
    defaultBaseUrl: config.defaultBaseUrl,
    registry,
    modelRegistry,
    config,
    sessionId: session.sessionId,
    sessionDir,
    store,
    lockDir: join(baseDir, '.infrabrain', 'locks'),
  });

  // Start server (auto-finds free port if configured port is busy)
  const { server } = await start(config.apiPort);
  const actualPort = (server.address() as { port: number })?.port ?? config.apiPort;
  const apiBaseUrl = `http://localhost:${actualPort}`;
  console.log(chalk.gray(`[API] Listening on ${apiBaseUrl}`));

  // Register CLI commands
  const program = registerCommands({ apiBaseUrl, config });

  // Check if one-shot mode (CLI args present) or --json mode
  const args = process.argv.slice(2);
  const isJsonMode = args.includes('--json');
  const hasArgs = args.filter(a => a !== '--json').length > 0;

  if (hasArgs || isJsonMode) {
    // One-shot / --json mode: bypass Ink, use Commander directly
    try {
      await program.parseAsync(args, { from: 'user' });
    } catch (err) {
      console.error(chalk.red(`Error: ${(err as Error).message}`));
    }
    server.close();
    db.close();
    return;
  }

  // Interactive Ink mode: replaces readline REPL
  // Move startup messages before Ink render (Ink takes over stdout -- RESEARCH.md Pitfall 2)
  console.log(chalk.bold('InfraBrain v1.3'));
  console.log(chalk.gray('Starting Ink terminal UI...\n'));

  // Signal handlers: restore terminal state on crash (RESEARCH.md Pitfall 5)
  process.on('SIGINT', () => {
    server.close();
    db.close();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    server.close();
    db.close();
    process.exit(0);
  });

  // Render Ink App (replaces startRepl)
  const { waitUntilExit } = render(
    React.createElement(App, { apiBaseUrl }),
    { exitOnCtrlC: true },
  );
  await waitUntilExit();

  // Cleanup on exit
  server.close();
  db.close();
}

// Run application
main().catch((err) => {
  console.error(chalk.red(`Fatal error: ${(err as Error).message}`));

  // Handle common startup errors with helpful messages
  if ((err as Error).message?.includes('ECONNREFUSED')) {
    console.error(chalk.yellow('Hint: Is your LLM backend running? Check defaultBaseUrl in config.'));
  }
  if ((err as Error).message?.includes('EACCES') || (err as Error).message?.includes('EPERM')) {
    console.error(chalk.yellow('Hint: Check file permissions for .infrabrain/ directory'));
  }

  process.exit(1);
});
