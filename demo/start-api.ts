// Headless API server for demo/testing — no REPL, no stdin dependency
import { join } from 'node:path';
import { loadConfig } from '../src/config/loader.js';
import { createOllamaModel } from '../src/llm/ollama.js';
import { createProvider } from '../src/llm/provider.js';
import { initDatabase } from '../src/state/db.js';
import { createSession } from '../src/state/session.js';
import { WriteThrough } from '../src/state/store.js';
import { AuditLogger } from '../src/audit/logger.js';
import { validateCommand } from '../src/safety/validator.js';
import { createServer } from '../src/api/server.js';
import { SkillRegistry } from '../src/skills/registry.js';

async function main(): Promise<void> {
  const baseDir = process.cwd();
  const config = loadConfig(baseDir);

  const model = createOllamaModel(config.modelName, config.ollamaBaseUrl);
  const provider = createProvider(model);

  const dbPath = join(baseDir, '.infrabrain', 'infrabrain.db');
  const db = initDatabase(dbPath);
  const store = new WriteThrough(db);

  const session = createSession(baseDir);
  const sessionDir = join(baseDir, '.infrabrain', 'sessions', session.sessionId);
  store.persistState(sessionDir, session);

  const auditLogger = new AuditLogger(store, session.sessionId, sessionDir);

  const registry = new SkillRegistry();
  const skillsDir = join(baseDir, config.skillsDir);
  try {
    registry.populate(skillsDir);
    console.log(`[Skills] Loaded ${registry.list().length} skills`);
  } catch {
    console.log(`[Skills] No skills directory found`);
  }

  const { start } = createServer({
    provider,
    auditLogger,
    validator: validateCommand,
    ollamaBaseUrl: config.ollamaBaseUrl,
    registry,
    config,
    sessionId: session.sessionId,
    sessionDir,
    store,
    lockDir: join(baseDir, '.infrabrain', 'locks'),
  });

  await start(config.apiPort);
  console.log(`[API] Listening on http://localhost:${config.apiPort}`);
  console.log(`[LLM] ${config.modelName} @ ${config.ollamaBaseUrl}`);
  console.log(`[Session] ${session.sessionId}`);
  console.log(`[Ready] API-only mode — no REPL`);
}

main().catch((err) => {
  console.error(`Fatal: ${(err as Error).message}`);
  process.exit(1);
});
