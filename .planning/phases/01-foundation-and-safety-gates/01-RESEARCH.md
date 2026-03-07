# Phase 1: Foundation and Safety Gates - Research

**Researched:** 2026-03-07
**Domain:** Node.js/TypeScript CLI platform with LLM integration, safety gates, and audit logging
**Confidence:** HIGH

## Summary

Phase 1 builds the entire platform skeleton from scratch: LLM provider abstraction (Vercel AI SDK v6 + Ollama), Express REST API, custom REPL CLI, command validation with risk-tiered approval gates, dual-write state storage (files + SQLite), and structured audit logging. This is a greenfield TypeScript project targeting Node.js 22+ with ESM.

The key technical decisions are well-supported by the current ecosystem. Vercel AI SDK v6 is stable (6.0.116) with a dedicated Ollama community provider (`ai-sdk-ollama@^3.x`). Express 5 is now the stable default on npm. `better-sqlite3` remains the clear choice over the experimental `node:sqlite` module. The streaming architecture (stream diagnostic reasoning, buffer command output for safety validation) is well-supported by AI SDK's `streamText` with `onChunk` callbacks.

**Primary recommendation:** Use AI SDK v6 with `ai-sdk-ollama@^3.x`, Express 5.x, `better-sqlite3`, Commander.js for CLI parsing, and Node.js `readline` for the REPL loop. TypeScript with ESM (`"type": "module"`), `tsx` for development, `tsup` for builds.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Both REPL and one-shot CLI modes: interactive REPL is primary, one-shot commands for scripting/CI
- Custom REPL built on Node.js readline + Commander.js for command parsing
- Feature-based flat repo layout: src/llm/, src/cli/, src/safety/, src/state/, src/audit/
- Express with minimal routes (/debug, /health) for the REST API backend
- CLI calls the API internally; API is the single execution path
- Vercel AI SDK with Ollama adapter for LLM communication
- Streaming with buffered sections: stream diagnostic reasoning live to CLI, buffer command/action outputs for safety validation before display
- Fixed context window budget per task type (e.g., 4K for diagnosis, 2K for commands) -- hard limits prevent silent truncation
- Llama 3.3 70B as the only model for Phase 1
- Session-based file structure: .infrabrain/sessions/{session-id}/ containing state.json, audit.jsonl, diffs/
- better-sqlite3 for SQLite (synchronous API, fastest Node binding, battle-tested)
- Audit entries capture: what was diagnosed, options LLM considered, why it chose this option, before/after state diffs (no full LLM transcripts)
- Write-through sync model: every state change writes to both file and SQLite atomically; files are source of truth, SQLite is queryable index
- Hardcoded safety defaults (never rm -rf /, etc.) + config file overrides for allowlist/blocklist patterns
- Pattern-based regex rules for risk tier classification: read-only, write, destructive
- Inline approval UX with context: read auto-approve with log, write gets [Y/n], destructive requires typed confirmation
- Hard stop on rejected/blocked commands: log rejection, explain to admin, no retry or LLM alternatives

### Claude's Discretion
- Express route structure and middleware setup
- REPL prompt styling and UX details
- SQLite schema design (tables, indexes)
- Exact regex patterns for command classification defaults
- Config file format (YAML vs JSON) for allowlist/blocklist overrides

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| CORE-01 | Abstracted LLM provider interface with Ollama as default | AI SDK v6 provider pattern; `ai-sdk-ollama` wraps Ollama behind standard `LanguageModel` interface |
| CORE-02 | Pluggable LLM providers without code changes | AI SDK provider architecture -- swap `ollama()` for any AI SDK provider; abstraction layer in `src/llm/` |
| CORE-09 | Track context token budget, prevent silent truncation | AI SDK `usage` property on streamText/generateText results; implement pre-call token counting |
| CORE-10 | Validate generated commands against whitelist/blocklist | Custom regex-based validation in `src/safety/`; no library needed -- pattern matching is straightforward |
| SAFE-01 | Read-only commands auto-approve | Risk classifier + approval gate in `src/safety/`; regex patterns for read-only commands |
| SAFE-02 | Write commands require Y/N approval | Node.js readline question prompt in approval gate |
| SAFE-03 | Destructive commands require typed confirmation | Readline prompt requiring target name match; Docker-style UX pattern |
| SAFE-09 | Log every decision as structured JSON | JSONL append to `audit.jsonl` + SQLite insert via `better-sqlite3` |
| SAFE-10 | Capture before/after state diffs for every change | JSON diff library or custom shallow diff; store in session diffs/ directory |
| INTF-01 | CLI commands via `/infra:debug` etc. | Commander.js command registration + REPL dispatch |
| INTF-05 | REST API backend serves all CLI functionality | Express 5 with /debug and /health routes |
| INTF-06 | Persist fix plan state to disk (file + SQLite) | Write-through to `state.json` + SQLite; `better-sqlite3` synchronous writes |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `ai` (Vercel AI SDK) | ^6.0.0 | Unified LLM abstraction, streaming, tool calling | Industry standard for TypeScript LLM integration; provider-agnostic |
| `ai-sdk-ollama` | ^3.0.0 | Ollama provider for AI SDK | Official community provider listed on ai-sdk.dev; built on ollama-js client; requires AI SDK v6 |
| `express` | ^5.0.0 | REST API server | Express 5 is now stable default on npm; async error handling built-in |
| `better-sqlite3` | ^11.0.0 | SQLite database | Synchronous API (no callback hell), fastest Node.js SQLite binding, battle-tested |
| `commander` | ^13.0.0 | CLI command parsing | De facto standard for Node.js CLIs; TypeScript support; subcommand architecture |
| `zod` | ^3.23.0 | Schema validation | Required peer dependency of ai-sdk-ollama; useful throughout for config/input validation |
| `typescript` | ^5.7.0 | Type system | Required for the project |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `tsx` | ^4.0.0 | TypeScript execution without compilation | Development: run .ts files directly |
| `tsup` | ^8.0.0 | TypeScript bundler | Build: compile to dist/ for distribution |
| `uuid` | ^11.0.0 | Session ID generation | Creating unique session identifiers |
| `chalk` | ^5.0.0 | Terminal colors | REPL output formatting, risk level color coding |
| `vitest` | ^3.0.0 | Test framework | All testing: unit, integration; native ESM + TypeScript |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `better-sqlite3` | `node:sqlite` (built-in) | Still experimental in Node 22/23; no flag required in 23.4+ but stability 1.1; use better-sqlite3 for production reliability |
| `ai-sdk-ollama` | `ollama-ai-provider-v2` | Direct HTTP calls, fewer features; ai-sdk-ollama is recommended for tool calling and advanced features |
| `ai-sdk-ollama` | Direct `ollama` npm package | Loses AI SDK abstraction; defeats CORE-02 pluggability requirement |
| `commander` | `yargs` / `oclif` | Commander is lighter, sufficient for this use case, and well-documented |
| `express` | `fastify` | Express 5 is sufficient; team familiarity likely higher; minimal routes don't need Fastify perf |
| JSON config | YAML config (`js-yaml`) | JSON is simpler, no extra dependency, sufficient for allowlist/blocklist patterns |

**Installation:**
```bash
npm install ai ai-sdk-ollama express better-sqlite3 commander zod uuid chalk
npm install -D typescript tsx tsup vitest @types/node @types/express @types/better-sqlite3 @types/uuid
```

## Architecture Patterns

### Recommended Project Structure
```
src/
  llm/
    provider.ts          # LLM provider abstraction (createProvider, generateText, streamText wrappers)
    ollama.ts            # Ollama-specific provider config
    token-budget.ts      # Context window budget tracking/enforcement
  cli/
    repl.ts              # Interactive REPL (readline-based)
    commands.ts          # Commander.js command definitions
    approval.ts          # Human-in-the-loop approval prompts
    formatter.ts         # Output formatting (chalk, structured display)
  safety/
    classifier.ts        # Risk level classification (read/write/destructive)
    validator.ts         # Command allowlist/blocklist validation
    rules.ts             # Hardcoded + configurable safety rules
    types.ts             # RiskLevel enum, ValidationResult types
  state/
    session.ts           # Session lifecycle (create, load, persist)
    store.ts             # Write-through storage (file + SQLite)
    db.ts                # SQLite schema, migrations, queries
  audit/
    logger.ts            # Structured JSON audit logging
    types.ts             # AuditEntry types
  api/
    server.ts            # Express app setup
    routes/
      debug.ts           # POST /debug endpoint
      health.ts          # GET /health endpoint
  config/
    defaults.ts          # Hardcoded safety defaults, default config values
    loader.ts            # Config file loading and validation
    types.ts             # Config schema (Zod)
  index.ts               # Entry point
```

### Pattern 1: Provider Abstraction
**What:** Wrap AI SDK behind a project-specific interface so providers can be swapped without touching business logic.
**When to use:** All LLM calls go through this abstraction.
**Example:**
```typescript
// src/llm/provider.ts
import { streamText, generateText, LanguageModel } from 'ai';

export interface LLMProvider {
  model: LanguageModel;
  streamDiagnosis(prompt: string, systemPrompt: string): AsyncIterable<string>;
  generateCommand(prompt: string, systemPrompt: string): Promise<string>;
}

export function createProvider(model: LanguageModel): LLMProvider {
  return {
    model,
    async *streamDiagnosis(prompt, systemPrompt) {
      const result = streamText({
        model,
        system: systemPrompt,
        prompt,
        maxTokens: 4096, // Fixed budget for diagnosis
      });
      for await (const chunk of result.textStream) {
        yield chunk;
      }
    },
    async generateCommand(prompt, systemPrompt) {
      const { text, usage } = await generateText({
        model,
        system: systemPrompt,
        prompt,
        maxTokens: 2048, // Fixed budget for commands
      });
      return text;
    },
  };
}
```

### Pattern 2: Write-Through Dual Storage
**What:** Every state mutation writes to both the session file and SQLite atomically.
**When to use:** All state changes (session creation, audit entries, plan updates).
**Example:**
```typescript
// src/state/store.ts
import Database from 'better-sqlite3';
import { writeFileSync } from 'node:fs';

export class WriteThrough {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');  // Better concurrent read perf
    this.db.pragma('synchronous = NORMAL');
  }

  persistState(sessionDir: string, state: SessionState): void {
    // File write first (source of truth)
    writeFileSync(
      `${sessionDir}/state.json`,
      JSON.stringify(state, null, 2)
    );
    // SQLite index update (synchronous, same tick)
    const stmt = this.db.prepare(
      'INSERT OR REPLACE INTO sessions (id, state, updated_at) VALUES (?, ?, ?)'
    );
    stmt.run(state.sessionId, JSON.stringify(state), new Date().toISOString());
  }
}
```

### Pattern 3: Streaming with Buffered Safety Gate
**What:** Stream diagnostic reasoning to terminal in real-time, but buffer any generated commands and pass through safety validation before displaying.
**When to use:** When the LLM response contains both reasoning text and actionable commands.
**Example:**
```typescript
// Conceptual pattern for buffered streaming
async function processLLMResponse(provider: LLMProvider, prompt: string) {
  const stream = provider.streamDiagnosis(prompt, SYSTEM_PROMPT);
  let buffer = '';
  let inCommandBlock = false;

  for await (const chunk of stream) {
    if (detectCommandBlockStart(chunk, buffer)) {
      inCommandBlock = true;
    }
    if (inCommandBlock) {
      buffer += chunk;
      if (detectCommandBlockEnd(buffer)) {
        const command = extractCommand(buffer);
        const validation = await validateCommand(command);
        if (validation.allowed) {
          displayBufferedCommand(command, validation.riskLevel);
        } else {
          displayRejection(command, validation.reason);
        }
        buffer = '';
        inCommandBlock = false;
      }
    } else {
      // Stream reasoning text directly to terminal
      process.stdout.write(chunk);
    }
  }
}
```

### Pattern 4: Risk-Tiered Approval Gate
**What:** Different approval UX based on command risk classification.
**When to use:** Before any command execution.
**Example:**
```typescript
// src/cli/approval.ts
import * as readline from 'node:readline/promises';

export async function requestApproval(
  command: string,
  riskLevel: RiskLevel,
  rl: readline.Interface
): Promise<boolean> {
  switch (riskLevel) {
    case RiskLevel.READ:
      // Auto-approve, log only
      console.log(chalk.gray(`[auto-approved] ${command}`));
      return true;

    case RiskLevel.WRITE:
      const answer = await rl.question(
        chalk.yellow(`Execute "${command}"? [Y/n] `)
      );
      return answer.toLowerCase() !== 'n';

    case RiskLevel.DESTRUCTIVE:
      const target = extractTarget(command);
      const confirmation = await rl.question(
        chalk.red(`DESTRUCTIVE: "${command}"\nType "${target}" to confirm: `)
      );
      return confirmation === target;
  }
}
```

### Anti-Patterns to Avoid
- **Direct Ollama HTTP calls:** Always go through AI SDK provider abstraction. Direct HTTP calls bypass CORE-02 pluggability.
- **Async SQLite in hot paths:** Use better-sqlite3's synchronous API. Async SQLite adds complexity for no benefit in single-process CLI tools.
- **Shared mutable state between CLI and API:** The API should be stateless per-request; session state lives in the store layer, not in Express middleware.
- **Shell execution of commands (Phase 1):** Phase 1 validates and classifies commands but does NOT execute them. Execution is Phase 3 (sub-agents with sandboxing). Do not build `child_process.exec` in this phase.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| LLM streaming/text generation | Custom HTTP client to Ollama | `ai` + `ai-sdk-ollama` | Handles SSE parsing, token counting, error recovery, provider abstraction |
| CLI argument parsing | Manual argv parsing | `commander` | Handles help generation, validation, subcommands, error messages |
| SQLite bindings | `node:sqlite` or raw FFI | `better-sqlite3` | Production-proven, synchronous API, fastest binding, not experimental |
| UUID generation | `crypto.randomUUID()` or custom | `uuid` v11 | Cross-platform consistency, v7 time-ordered UUIDs for session IDs |
| Terminal colors | ANSI escape codes | `chalk` | Handles color support detection, nesting, template literals |
| Schema validation | Manual if/else checks | `zod` | Already a dependency (ai-sdk-ollama peer dep); composable, TypeScript inference |

**Key insight:** Phase 1 establishes patterns for all subsequent phases. Using established libraries now prevents having to replace hand-rolled solutions later when they inevitably fail on edge cases.

## Common Pitfalls

### Pitfall 1: Ollama Not Running
**What goes wrong:** AI SDK throws cryptic connection errors when Ollama is not started or model is not pulled.
**Why it happens:** Ollama runs as a separate process; the app has no control over it.
**How to avoid:** Add a health check at startup that calls Ollama's `/api/tags` endpoint. If it fails, print a clear error message: "Ollama not detected at http://localhost:11434. Run `ollama serve` first."
**Warning signs:** `ECONNREFUSED` errors during LLM calls.

### Pitfall 2: Model Not Pulled
**What goes wrong:** Ollama returns an error because `llama3.3:70b` (or whatever model name) is not downloaded.
**Why it happens:** Admin forgot to `ollama pull` the model.
**How to avoid:** At startup, verify the model exists via Ollama API. Print: "Model llama3.3:70b not found. Run `ollama pull llama3.3:70b` first."
**Warning signs:** Ollama 404 or model-not-found errors.

### Pitfall 3: ESM Import Extensions
**What goes wrong:** Runtime errors like "Cannot find module" even though TypeScript compiles fine.
**Why it happens:** With `"type": "module"` in package.json, Node.js requires `.js` extensions in imports. TypeScript resolves `.js` to `.ts` during compilation, but forgetting the extension breaks at runtime.
**How to avoid:** Always use `.js` extensions in import paths. Configure tsconfig with `"moduleResolution": "NodeNext"` and `"module": "NodeNext"`.
**Warning signs:** Works with `tsx` but fails after `tsup` build.

### Pitfall 4: SQLite WAL Mode and Concurrent Access
**What goes wrong:** Database locked errors or data corruption.
**Why it happens:** Default SQLite journal mode doesn't handle concurrent readers/writers well.
**How to avoid:** Enable WAL mode (`db.pragma('journal_mode = WAL')`) immediately after opening the database. For this single-process app, this is more than sufficient.
**Warning signs:** `SQLITE_BUSY` errors.

### Pitfall 5: Readline Interface Conflicts
**What goes wrong:** REPL stops accepting input or displays garbled output when streaming LLM text.
**Why it happens:** Writing to stdout while readline has an active prompt corrupts the display.
**How to avoid:** Use `rl.pause()` before streaming LLM output and `rl.resume()` after. Or clear the current line before writing and redraw the prompt after.
**Warning signs:** Prompt text appearing in the middle of LLM output.

### Pitfall 6: Synchronous File Writes Blocking Event Loop
**What goes wrong:** REPL becomes unresponsive during state persistence.
**Why it happens:** `writeFileSync` blocks the event loop. Normally fine for small writes, but can stall if audit.jsonl grows large.
**How to avoid:** Keep state.json small (current state only). Use append-only writes for audit.jsonl (`appendFileSync`). For Phase 1 volumes, sync writes are acceptable; optimize later if needed.
**Warning signs:** Noticeable lag after command approval.

### Pitfall 7: Token Budget Enforcement
**What goes wrong:** Ollama silently truncates input that exceeds context window, producing nonsensical output.
**Why it happens:** Ollama doesn't error on oversized prompts; it truncates.
**How to avoid:** Count tokens before sending. AI SDK returns `usage` with `promptTokens` and `completionTokens`. Implement a pre-flight check using a rough tokenizer (4 chars ~ 1 token for English) or use Ollama's tokenize endpoint if available.
**Warning signs:** LLM responses that seem to "forget" earlier context.

## Code Examples

### Project Initialization
```typescript
// package.json (key fields)
{
  "name": "infrabrain",
  "type": "module",
  "scripts": {
    "dev": "tsx src/index.ts",
    "build": "tsup src/index.ts --format esm --dts",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

```json
// tsconfig.json (key fields)
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "declaration": true,
    "sourceMap": true
  },
  "include": ["src/**/*"]
}
```

### Ollama Provider Setup
```typescript
// src/llm/ollama.ts
import { ollama } from 'ai-sdk-ollama';

export function createOllamaModel(modelName = 'llama3.3:70b') {
  return ollama(modelName);
}
```

### Express API Server
```typescript
// src/api/server.ts
import express from 'express';
import { debugRoute } from './routes/debug.js';
import { healthRoute } from './routes/health.js';

export function createServer(port = 3000) {
  const app = express();
  app.use(express.json());

  app.use('/debug', debugRoute);
  app.use('/health', healthRoute);

  // Express 5: async error handler works natively
  app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error(err);
    res.status(500).json({ error: err.message });
  });

  return app.listen(port, () => {
    console.log(`InfraBrain API listening on port ${port}`);
  });
}
```

### SQLite Schema
```typescript
// src/state/db.ts
import Database from 'better-sqlite3';

export function initDatabase(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      state TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      event_type TEXT NOT NULL,
      risk_level TEXT,
      command TEXT,
      decision TEXT,
      reasoning TEXT,
      diff_before TEXT,
      diff_after TEXT,
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    );

    CREATE INDEX IF NOT EXISTS idx_audit_session ON audit_log(session_id);
    CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp);
    CREATE INDEX IF NOT EXISTS idx_audit_event_type ON audit_log(event_type);
  `);

  return db;
}
```

### Command Risk Classifier
```typescript
// src/safety/classifier.ts
export enum RiskLevel {
  READ = 'read',
  WRITE = 'write',
  DESTRUCTIVE = 'destructive',
  BLOCKED = 'blocked',
}

interface ClassificationRule {
  pattern: RegExp;
  level: RiskLevel;
}

// Hardcoded defaults -- cannot be overridden by config
const BLOCKED_PATTERNS: RegExp[] = [
  /rm\s+-rf\s+\/(?:\s|$)/,          // rm -rf /
  /mkfs\./,                           // format filesystem
  /dd\s+if=.*of=\/dev\//,            // dd to device
  /:(){ :\|:& };:/,                   // fork bomb
  /chmod\s+-R\s+777\s+\//,           // chmod 777 /
];

const DEFAULT_RULES: ClassificationRule[] = [
  // Read-only
  { pattern: /^docker\s+ps/, level: RiskLevel.READ },
  { pattern: /^docker\s+logs/, level: RiskLevel.READ },
  { pattern: /^docker\s+inspect/, level: RiskLevel.READ },
  { pattern: /^cat\s+/, level: RiskLevel.READ },
  { pattern: /^ls\s+/, level: RiskLevel.READ },
  { pattern: /^systemctl\s+status/, level: RiskLevel.READ },
  // Write
  { pattern: /^docker\s+restart/, level: RiskLevel.WRITE },
  { pattern: /^docker\s+start/, level: RiskLevel.WRITE },
  { pattern: /^docker\s+stop/, level: RiskLevel.WRITE },
  { pattern: /^systemctl\s+restart/, level: RiskLevel.WRITE },
  // Destructive
  { pattern: /^docker\s+rm/, level: RiskLevel.DESTRUCTIVE },
  { pattern: /^docker\s+rmi/, level: RiskLevel.DESTRUCTIVE },
  { pattern: /^rm\s+/, level: RiskLevel.DESTRUCTIVE },
];

export function classifyCommand(command: string, customRules?: ClassificationRule[]): RiskLevel {
  // Blocked patterns always checked first (hardcoded, non-overridable)
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(command)) return RiskLevel.BLOCKED;
  }
  // Custom rules override defaults
  const rules = customRules ?? DEFAULT_RULES;
  for (const rule of rules) {
    if (rule.pattern.test(command)) return rule.level;
  }
  // Default: treat unknown commands as WRITE (safe default)
  return RiskLevel.WRITE;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| AI SDK v4/v5 | AI SDK v6 | Late 2025 | New v3 Language Model Spec; agent/tool approval support; no major breaking changes from v5 |
| Express 4 | Express 5 | Oct 2024 (5.0), Mar 2025 (5.1 = default) | Async error handling built-in, ReDoS protection, dropped Node <18 |
| `node:sqlite` experimental | Still experimental (stability 1.1) | Node 22.5+ | Not ready for production; `better-sqlite3` remains the standard |
| `ollama-ai-provider` (sgomez) | `ai-sdk-ollama` (jagreehal) | 2025 | Listed on official ai-sdk.dev; built on official ollama-js; recommended for advanced features |
| CommonJS | ESM default | 2024-2025 | `"type": "module"` in package.json; use `.js` extensions in imports |

**Deprecated/outdated:**
- `ollama-ai-provider` (sgomez, v1.2.0): Older community provider, less actively maintained than `ai-sdk-ollama`
- Express 4: Still works but 5 is now the npm default; no reason to use 4 for new projects
- `node:sqlite`: Experimental; do not use in production yet

## Open Questions

1. **Exact Ollama model name for Llama 3.3 70B**
   - What we know: Ollama uses names like `llama3.3:70b` or `llama3.3:70b-instruct-q4_K_M`
   - What's unclear: Which exact tag the admin will have pulled; quantization variant matters for 70B on local hardware
   - Recommendation: Make model name configurable with a sensible default (`llama3.3:70b`). Document required VRAM (~40GB for Q4 quantization).

2. **Config file format for safety overrides**
   - What we know: User left this to Claude's discretion
   - Recommendation: Use JSON. It avoids a `js-yaml` dependency, is natively parseable, and matches the rest of the data format (state.json, audit.jsonl). File: `.infrabrain/config.json`.

3. **Token counting before LLM call**
   - What we know: AI SDK returns token usage after completion. Ollama has a `/api/tokenize` endpoint (undocumented, may not be in all versions).
   - What's unclear: Whether Ollama's tokenize endpoint is reliable for Llama 3.3 70B
   - Recommendation: Use rough estimation (4 chars per token) for pre-flight checks. Validate with actual `usage` from AI SDK responses. Log warnings when approaching budget.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest ^3.0.0 |
| Config file | `vitest.config.ts` -- Wave 0 |
| Quick run command | `npx vitest run --reporter=verbose` |
| Full suite command | `npx vitest run --coverage` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CORE-01 | LLM provider interface returns responses | integration | `npx vitest run tests/llm/provider.test.ts -t "provider"` | Wave 0 |
| CORE-02 | Provider swap without code changes | unit | `npx vitest run tests/llm/provider.test.ts -t "pluggable"` | Wave 0 |
| CORE-09 | Token budget enforcement | unit | `npx vitest run tests/llm/token-budget.test.ts` | Wave 0 |
| CORE-10 | Command allowlist/blocklist validation | unit | `npx vitest run tests/safety/validator.test.ts` | Wave 0 |
| SAFE-01 | Read commands auto-approve | unit | `npx vitest run tests/safety/approval.test.ts -t "read"` | Wave 0 |
| SAFE-02 | Write commands require Y/N | unit | `npx vitest run tests/safety/approval.test.ts -t "write"` | Wave 0 |
| SAFE-03 | Destructive commands require typed confirmation | unit | `npx vitest run tests/safety/approval.test.ts -t "destructive"` | Wave 0 |
| SAFE-09 | Structured JSON audit logging | unit | `npx vitest run tests/audit/logger.test.ts` | Wave 0 |
| SAFE-10 | Before/after state diffs captured | unit | `npx vitest run tests/audit/logger.test.ts -t "diff"` | Wave 0 |
| INTF-01 | CLI command routing | integration | `npx vitest run tests/cli/commands.test.ts` | Wave 0 |
| INTF-05 | REST API serves debug/health | integration | `npx vitest run tests/api/routes.test.ts` | Wave 0 |
| INTF-06 | State persisted to file + SQLite | unit | `npx vitest run tests/state/store.test.ts` | Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run --reporter=verbose`
- **Per wave merge:** `npx vitest run --coverage`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `vitest.config.ts` -- framework configuration
- [ ] `tests/llm/provider.test.ts` -- LLM provider interface tests (mock Ollama)
- [ ] `tests/llm/token-budget.test.ts` -- token budget tracking
- [ ] `tests/safety/validator.test.ts` -- command validation (allowlist/blocklist)
- [ ] `tests/safety/approval.test.ts` -- risk classification and approval logic
- [ ] `tests/safety/classifier.test.ts` -- risk level classification
- [ ] `tests/audit/logger.test.ts` -- audit logging and state diffs
- [ ] `tests/cli/commands.test.ts` -- CLI command parsing and routing
- [ ] `tests/api/routes.test.ts` -- Express route integration tests
- [ ] `tests/state/store.test.ts` -- write-through dual storage
- [ ] `tests/state/db.test.ts` -- SQLite schema and queries
- [ ] Framework install: `npm install -D vitest @vitest/coverage-v8`

## Sources

### Primary (HIGH confidence)
- [ai-sdk.dev/providers/community-providers/ollama](https://ai-sdk.dev/providers/community-providers/ollama) -- Official AI SDK Ollama provider listing
- [ai-sdk.dev/docs/reference/ai-sdk-core/stream-text](https://ai-sdk.dev/docs/reference/ai-sdk-core/stream-text) -- streamText API reference, callbacks, usage
- [github.com/jagreehal/ai-sdk-ollama](https://github.com/jagreehal/ai-sdk-ollama) -- ai-sdk-ollama v3+ requires AI SDK v6, streaming examples
- [expressjs.com/2025/03/31/v5-1-latest-release.html](https://expressjs.com/2025/03/31/v5-1-latest-release.html) -- Express 5.1 now default on npm
- [vercel.com/blog/ai-sdk-6](https://vercel.com/blog/ai-sdk-6) -- AI SDK v6 release announcement

### Secondary (MEDIUM confidence)
- [github.com/WiseLibs/better-sqlite3/discussions/1245](https://github.com/WiseLibs/better-sqlite3/discussions/1245) -- better-sqlite3 vs node:sqlite discussion
- [betterstack.com/community/guides/scaling-nodejs/nodejs-sqlite/](https://betterstack.com/community/guides/scaling-nodejs/nodejs-sqlite/) -- node:sqlite still experimental, stability 1.1
- [nodejs.org/api/sqlite.html](https://nodejs.org/api/sqlite.html) -- Official Node.js SQLite docs confirming experimental status

### Tertiary (LOW confidence)
- Token counting: rough 4-char-per-token heuristic is widely cited but accuracy varies by model and language; needs validation with actual Llama 3.3 tokenizer

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries verified via official sources, versions confirmed current
- Architecture: HIGH -- patterns follow established Node.js/TypeScript conventions; aligned with user decisions
- Pitfalls: HIGH -- common issues well-documented across multiple sources
- Token budget: MEDIUM -- AI SDK reports usage post-completion; pre-flight estimation is approximate
- Ollama model naming: MEDIUM -- exact tags depend on user's Ollama setup

**Research date:** 2026-03-07
**Valid until:** 2026-04-07 (30 days -- all libraries are stable releases)
