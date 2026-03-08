# Phase 4: Session Management and CLI Polish - Research

**Researched:** 2026-03-08
**Domain:** CLI command design, SQLite query patterns, session resumability, JSON output mode
**Confidence:** HIGH

## Summary

Phase 4 adds operational visibility to InfraBrain: status dashboard, audit history queries, JSON output mode, and session resumability. The existing codebase provides strong foundations -- SQLite schema with indexed audit_log table, session state with fix plan tracking, Commander.js command registration, and chalk-based formatting. The work is primarily about adding query methods to the store, new API routes, new CLI commands, and a global `--json` option that suppresses chalk/spinners.

The architecture is straightforward: extend existing patterns (Commander.js commands, Express factory routes, WriteThrough store methods) rather than introduce new libraries. The most complex piece is fix plan resumability, which requires extending SessionState with resume metadata, detecting incomplete plans, and wiring a resume flow through the existing executor.

**Primary recommendation:** Build this phase in layers -- (1) JSON envelope and --json global option first (cross-cutting concern), (2) status command, (3) history with filters, (4) resume capability -- since each layer builds on the previous.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Status command: one-screen dashboard with live Ollama health check, active fix plans, last 3 completed sessions, locks only when present
- History: four filter flags (--session, --type, --risk, --since/--until), default 20 entries with --limit, compact table with --verbose expansion, AND-combinable filters
- JSON output: standard envelope `{ "ok": true/false, "command": "...", "data": {...}, "error": null }`, buffer-then-output for streaming, pure JSON only when --json (no chalk, no spinners, no prompts, approval gates auto-approve)
- Resume: auto-detect on /infra:debug AND explicit /infra:resume <session-id>, ask admin "Retry this step" or "Skip to next", 24-hour configurable window with stale warning, no state re-verification

### Claude's Discretion
- Exact table column widths and formatting for status/history display
- Time parsing strategy for --since/--until (relative like "1h ago" vs ISO timestamps)
- How auto-detect matches an incomplete plan to a new debug query (target matching, similarity)
- Health check timeout value for Ollama ping
- How to handle --json combined with --verbose for history

### Deferred Ideas (OUT OF SCOPE)
- Tab-completion for commands and dynamic suggestions for targets/session-ids from SQLite
- AI-powered natural language query parser for /infra:history
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| INTF-02 | Admin can check system and session status via CLI (`/infra:status`) | Status API route + CLI command with Ollama health check, active plans, recent sessions, active locks |
| INTF-03 | Admin can view audit history via CLI (`/infra:history`) | History query methods on WriteThrough store, filter-to-SQL translation, compact table formatter |
| INTF-04 | CLI supports machine-parseable JSON output mode for scripting | Global --json option on Commander program, JSON envelope wrapper, chalk/spinner suppression |
| INTF-07 | Admin can resume an interrupted fix plan from where it left off | SessionState extension with resume metadata, auto-detect logic, /infra:resume command, 24h window |
| SAFE-11 | Audit log is queryable via SQLite | Already has indexed audit_log table; needs query methods with parameterized WHERE clauses for filters |
</phase_requirements>

## Standard Stack

### Core (Already in Project)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| commander | ^14.0.3 | CLI command registration and option parsing | Already used for /infra:debug and /infra:health |
| better-sqlite3 | ^12.6.2 | SQLite queries for audit log and session state | Already used, synchronous API, production-proven |
| chalk | ^5.6.2 | CLI formatting (suppressed in --json mode) | Already used in formatter.ts |
| express | ^5.2.1 | API routes for status and history | Already used for /health, /debug, /execute |
| zod | ^4.3.6 | Schema validation for query params and config | Already used for config and fix plans |

### Supporting (No New Dependencies)
No new libraries needed. Everything required is already in the dependency tree.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Manual time parsing | date-fns or dayjs | Over-engineering for simple relative time like "1h ago"; a 30-line parser handles the use cases |
| Manual table formatting | cli-table3 | Would add a dependency for something chalk + padEnd can do; keep it simple |

**Installation:**
```bash
# No new dependencies needed
```

## Architecture Patterns

### Recommended Project Structure
```
src/
  cli/
    commands.ts          # Extended: add status, history, resume commands + global --json option
    formatter.ts         # Extended: add formatStatusDashboard, formatHistoryTable
    json-envelope.ts     # NEW: JSON envelope wrapper and output helper
  api/
    routes/
      status.ts          # NEW: GET /status route
      history.ts         # NEW: GET /history route with query params
      resume.ts          # NEW: POST /resume route
  state/
    store.ts             # Extended: add query methods (getActiveSessions, queryAuditLog, getIncompletePlans)
    session.ts           # Extended: add resume metadata, findIncompleteSession
    types.ts             # Extended: SessionState gains resumeMetadata, FixPlanState gains stoppedAt/error
  config/
    types.ts             # Extended: add resumability config (resumeWindowMs default 86400000)
```

### Pattern 1: JSON Envelope (Cross-Cutting)
**What:** Every CLI command wraps output in a standard envelope when --json is active
**When to use:** All command handlers
**Example:**
```typescript
// src/cli/json-envelope.ts
export interface JsonEnvelope<T = unknown> {
  ok: boolean;
  command: string;
  data: T;
  error: string | null;
}

export function envelope<T>(command: string, data: T): JsonEnvelope<T> {
  return { ok: true, command, data, error: null };
}

export function errorEnvelope(command: string, error: string): JsonEnvelope<null> {
  return { ok: false, command, data: null, error };
}

// Usage in command handler:
// if (jsonMode) { console.log(JSON.stringify(envelope('status', data))); return; }
```

### Pattern 2: Global --json Option via Commander
**What:** A global option on the Commander program that all subcommands can read
**When to use:** Applied at program level, read by each command via `this.optsWithGlobals()`
**Example:**
```typescript
// In registerCommands:
program.option('--json', 'Output in machine-parseable JSON format');

// In each command action:
.action(async function(this: Command, ...args) {
  const { json: jsonMode } = this.optsWithGlobals();
  // ... use jsonMode to toggle output
});
```
**Key detail:** Commander v14 supports `optsWithGlobals()` to access parent program options from subcommand actions. The `this` context must be the Command instance, so use a regular function (not arrow function) in `.action()`.

### Pattern 3: Parameterized SQLite Queries for History Filters
**What:** Build WHERE clauses dynamically with parameterized values to prevent SQL injection
**When to use:** History query with combinable filters
**Example:**
```typescript
// src/state/store.ts - new method
queryAuditLog(filters: AuditQueryFilters): AuditEntry[] {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.sessionId) {
    conditions.push('session_id = ?');
    params.push(filters.sessionId);
  }
  if (filters.eventType) {
    conditions.push('event_type = ?');
    params.push(filters.eventType);
  }
  if (filters.riskLevel) {
    conditions.push('risk_level = ?');
    params.push(filters.riskLevel);
  }
  if (filters.since) {
    conditions.push('timestamp >= ?');
    params.push(filters.since);
  }
  if (filters.until) {
    conditions.push('timestamp <= ?');
    params.push(filters.until);
  }

  const where = conditions.length > 0
    ? `WHERE ${conditions.join(' AND ')}`
    : '';

  const stmt = this.db.prepare(
    `SELECT * FROM audit_log ${where} ORDER BY timestamp DESC LIMIT ?`
  );
  return stmt.all(...params, filters.limit ?? 20) as AuditEntry[];
}
```
**Key detail:** better-sqlite3's `prepare().all()` uses positional `?` placeholders. The synchronous API means no async/await needed for queries.

### Pattern 4: Session Resume Detection
**What:** Check for incomplete fix plans in SQLite sessions table, match by target
**When to use:** On /infra:debug startup and /infra:resume command
**Example:**
```typescript
// src/state/store.ts - new method
getIncompleteSessions(windowMs: number = 86400000): SessionState[] {
  const cutoff = new Date(Date.now() - windowMs).toISOString();
  const stmt = this.db.prepare(
    `SELECT state FROM sessions
     WHERE json_extract(state, '$.status') = 'active'
     AND updated_at >= ?
     ORDER BY updated_at DESC`
  );
  const rows = stmt.all(cutoff) as Array<{ state: string }>;
  return rows.map(r => JSON.parse(r.state) as SessionState);
}
```
**Key detail:** SQLite's `json_extract()` works on the stored JSON state column to filter by nested fields. This is already available in better-sqlite3 since it compiles SQLite with JSON1 extension enabled by default.

### Pattern 5: Output Mode Toggle
**What:** Suppress all chalk formatting and interactive prompts when --json is active
**When to use:** Formatter functions and approval gates
**Example:**
```typescript
// Extend formatter functions with a plain mode:
export function formatDiagnosis(text: string, plain = false): string {
  return plain ? text : chalk.white(text);
}

// Or create a conditional chalk wrapper:
const c = jsonMode ? { green: (s: string) => s, red: (s: string) => s, ... } : chalk;
```

### Anti-Patterns to Avoid
- **Building SQL strings with concatenation:** Always use parameterized queries. The existing codebase uses `stmt.run()` with `?` placeholders -- continue this pattern.
- **Adding new dependencies for table formatting:** chalk + string padding is sufficient for the `docker ps` / `git log --oneline` aesthetic described in the context. cli-table3 would add a dependency for minimal benefit.
- **Streaming JSON output:** The user explicitly decided on buffer-then-output. Do NOT stream partial JSON. Collect the full response, then output one complete JSON object.
- **Re-verifying infrastructure state on resume:** User explicitly decided "warning only, no state re-verification." Fast resume over safe-but-slow re-checks.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| CLI option parsing | Custom arg parser | Commander.js `program.option('--json')` | Already in project, handles global options with `optsWithGlobals()` |
| SQL query building | String concatenation | Parameterized `?` placeholders in better-sqlite3 | SQL injection prevention, existing pattern |
| UUID generation | Custom IDs | uuid v7 (already in project) | Time-ordered, existing pattern |
| Config validation | Manual checks | Zod schema extension | Already used for InfraBrainConfigSchema |
| Relative time display | Custom formatter | Extend existing `formatRelativeTime()` in locks/manager.ts | Already exists, reuse or extract to shared util |

**Key insight:** This phase is almost entirely about wiring together existing infrastructure. The SQLite schema, session management, CLI registration, and API routing patterns are all established. The work is connecting them with new queries, routes, and commands.

## Common Pitfalls

### Pitfall 1: Commander Global Options Not Reaching Subcommands
**What goes wrong:** Using `program.opts()` inside a subcommand action returns only the subcommand's options, not the global ones.
**Why it happens:** Commander scopes options to the command they're declared on.
**How to avoid:** Use `this.optsWithGlobals()` inside the action callback. Must use a regular `function()` (not arrow function) so `this` is the Command instance.
**Warning signs:** `--json` flag silently ignored, commands still output chalk-formatted text.

### Pitfall 2: Chalk Output Leaking into JSON Mode
**What goes wrong:** ANSI escape codes end up in JSON output, breaking jq parsing.
**Why it happens:** Console.log calls in deep utility functions (executor, circuit breaker) use chalk directly.
**How to avoid:** Either (a) check json mode before any chalk output, or (b) set `chalk.level = 0` at the start of json-mode execution and reset after. Option (b) is simpler and catches all cases.
**Warning signs:** `jq` parse errors, `JSON.parse()` failures in tests.

### Pitfall 3: SQLite datetime Comparison Gotcha
**What goes wrong:** Timestamp filters return wrong results.
**Why it happens:** SQLite stores timestamps as TEXT. String comparison works for ISO 8601 format (alphabetical = chronological) but fails if timestamps use inconsistent formats.
**How to avoid:** Ensure all timestamps stored via `new Date().toISOString()` (which the project already does). Ensure query input timestamps are also ISO 8601. The `--since` relative time parser must convert to ISO before query.
**Warning signs:** History queries returning unexpected results for time ranges.

### Pitfall 4: Resume Auto-Detect False Positives
**What goes wrong:** System incorrectly matches an incomplete plan to a new unrelated debug query.
**Why it happens:** Naive matching (e.g., same target string) may match plans for different problems.
**How to avoid:** Match on target AND recency. Show the incomplete plan summary to the admin and ask "Resume from step X or start fresh?" -- let the human decide. Don't silently resume.
**Warning signs:** Admin gets resume prompt for unrelated prior fix attempts.

### Pitfall 5: Missing Approval Gate Bypass in JSON Mode
**What goes wrong:** JSON mode hangs waiting for interactive approval input.
**Why it happens:** Approval gates expect readline interaction.
**How to avoid:** When --json is set, auto-approve all commands (same behavior as one-shot CLI mode, which already skips approval when no readline is available). This is explicitly part of the user's locked decision.
**Warning signs:** CLI hangs in JSON mode, no output produced.

## Code Examples

### Extending WriteThrough with Query Methods
```typescript
// Source: existing pattern from src/state/store.ts
export interface AuditQueryFilters {
  sessionId?: string;
  eventType?: string;
  riskLevel?: string;
  since?: string;   // ISO 8601
  until?: string;   // ISO 8601
  limit?: number;
}

// Add to WriteThrough class:
queryAuditLog(filters: AuditQueryFilters): AuditEntry[] {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.sessionId) { conditions.push('session_id = ?'); params.push(filters.sessionId); }
  if (filters.eventType) { conditions.push('event_type = ?'); params.push(filters.eventType); }
  if (filters.riskLevel) { conditions.push('risk_level = ?'); params.push(filters.riskLevel); }
  if (filters.since) { conditions.push('timestamp >= ?'); params.push(filters.since); }
  if (filters.until) { conditions.push('timestamp <= ?'); params.push(filters.until); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const stmt = this.db.prepare(
    `SELECT * FROM audit_log ${where} ORDER BY timestamp DESC LIMIT ?`
  );
  return stmt.all(...params, filters.limit ?? 20) as AuditEntry[];
}

getRecentSessions(limit: number = 3): SessionState[] {
  const stmt = this.db.prepare(
    `SELECT state FROM sessions ORDER BY updated_at DESC LIMIT ?`
  );
  const rows = stmt.all(limit) as Array<{ state: string }>;
  return rows.map(r => JSON.parse(r.state) as SessionState);
}
```

### New Status API Route
```typescript
// Source: follows pattern from src/api/routes/health.ts
import { Router } from 'express';

export function createStatusRoute(deps: StatusRouteDeps): Router {
  const router = Router();

  router.get('/', async (_req, res) => {
    const ollamaHealth = await checkOllamaHealth(deps.ollamaBaseUrl);
    const activeSessions = deps.store.getIncompleteSessions();
    const recentSessions = deps.store.getRecentSessions(3);
    const activeLocks = listActiveLocks(deps.lockDir);

    res.json({
      ollama: ollamaHealth,
      activePlans: activeSessions,
      recentSessions,
      locks: activeLocks,
    });
  });

  return router;
}
```

### Relative Time Parser for --since/--until
```typescript
// Recommendation: support both relative strings and ISO timestamps
export function parseTimeInput(input: string): string {
  // Try ISO 8601 first
  const date = new Date(input);
  if (!isNaN(date.getTime())) return date.toISOString();

  // Relative time: "1h ago", "30m ago", "2d ago"
  const match = input.match(/^(\d+)\s*(s|m|h|d)\s*(?:ago)?$/i);
  if (!match) throw new Error(`Invalid time format: ${input}. Use ISO 8601 or relative (e.g., "1h ago")`);

  const amount = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  const multipliers: Record<string, number> = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
  const ms = amount * multipliers[unit];

  return new Date(Date.now() - ms).toISOString();
}
```

### List Active Locks
```typescript
// Reads lock directory for status display
import * as fs from 'node:fs';
import * as path from 'node:path';

export function listActiveLocks(lockDir: string): LockFile[] {
  try {
    const files = fs.readdirSync(lockDir).filter(f => f.endsWith('.lock'));
    return files.map(f => {
      const content = fs.readFileSync(path.join(lockDir, f), 'utf-8');
      return JSON.parse(content) as LockFile;
    });
  } catch {
    return []; // Lock directory may not exist yet
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| commander .opts() for global options | .optsWithGlobals() | Commander v9+ | Enables global --json to reach subcommands |
| Callback-based better-sqlite3 | Synchronous API (always was sync) | N/A | No async needed for queries, simplifies code |
| Express 4 error handling | Express 5 async throw catching | Express 5 (already in project) | No need for next(err) in async route handlers |

**Deprecated/outdated:**
- Nothing relevant to deprecation in the project's current stack

## Open Questions

1. **--json combined with --verbose for history**
   - What we know: --json outputs envelope format, --verbose shows expanded audit entries
   - What's unclear: Should --json --verbose include expanded data in the envelope's data field?
   - Recommendation: When both are set, include full entry details in the JSON data array instead of truncated fields. The JSON consumer can always ignore extra fields, but can't recover truncated ones.

2. **Auto-detect matching strategy for incomplete plans**
   - What we know: Must detect incomplete plan on /infra:debug and prompt to resume
   - What's unclear: How to match an incomplete plan to a new debug query
   - Recommendation: Match by target string (extracted from the debug prompt or stored in the plan). If multiple incomplete plans exist, show a list and let admin choose. If only one exists, show its summary and ask "Resume or start fresh?"

3. **Health check timeout for status command**
   - What we know: Status does a live Ollama ping
   - What's unclear: What timeout to use
   - Recommendation: 3 seconds. Fast enough for dashboard feel, long enough for slow local networks. Use AbortController with fetch.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest ^4.0.18 |
| Config file | vitest.config.ts |
| Quick run command | `npx vitest run --reporter=verbose` |
| Full suite command | `npx vitest run` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| INTF-02 | Status command returns dashboard data via API | unit + integration | `npx vitest run tests/api/status.test.ts -x` | No - Wave 0 |
| INTF-02 | Status CLI formats dashboard output | unit | `npx vitest run tests/cli/status.test.ts -x` | No - Wave 0 |
| INTF-03 | History query with filters returns correct audit entries | unit | `npx vitest run tests/state/history-query.test.ts -x` | No - Wave 0 |
| INTF-03 | History CLI formats compact table and respects --verbose | unit | `npx vitest run tests/cli/history.test.ts -x` | No - Wave 0 |
| INTF-04 | --json flag produces valid envelope across all commands | unit | `npx vitest run tests/cli/json-output.test.ts -x` | No - Wave 0 |
| INTF-04 | JSON mode suppresses chalk and approval prompts | unit | `npx vitest run tests/cli/json-output.test.ts -x` | No - Wave 0 |
| INTF-07 | Incomplete session detected and resume offered | unit | `npx vitest run tests/state/resume.test.ts -x` | No - Wave 0 |
| INTF-07 | Resume executes from correct step with retry/skip option | unit | `npx vitest run tests/execution/resume.test.ts -x` | No - Wave 0 |
| SAFE-11 | Audit log queryable with parameterized filters | unit | `npx vitest run tests/state/history-query.test.ts -x` | No - Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run --reporter=verbose`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/cli/json-output.test.ts` -- covers INTF-04 (JSON envelope, chalk suppression)
- [ ] `tests/cli/status.test.ts` -- covers INTF-02 (status dashboard formatting)
- [ ] `tests/cli/history.test.ts` -- covers INTF-03 (history table formatting, --verbose)
- [ ] `tests/state/history-query.test.ts` -- covers SAFE-11, INTF-03 (SQLite filter queries)
- [ ] `tests/state/resume.test.ts` -- covers INTF-07 (incomplete session detection)
- [ ] `tests/execution/resume.test.ts` -- covers INTF-07 (resume execution from step N)
- [ ] `tests/api/status.test.ts` -- covers INTF-02 (status API route)

## Sources

### Primary (HIGH confidence)
- Project source code: src/state/store.ts, src/state/db.ts, src/state/session.ts, src/cli/commands.ts, src/execution/executor.ts, src/api/server.ts -- direct inspection of existing patterns
- Project package.json -- confirmed all dependency versions
- SQLite schema in src/state/db.ts -- confirmed audit_log table with indexes on session_id, timestamp, event_type

### Secondary (MEDIUM confidence)
- Commander.js optsWithGlobals() -- based on Commander documentation for v9+ (project uses v14)
- better-sqlite3 prepare().all() with positional params -- standard documented API
- SQLite json_extract() -- built-in JSON1 extension, enabled by default in better-sqlite3

### Tertiary (LOW confidence)
- None -- all findings verified against project source code and library documentation

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - no new dependencies, everything verified in package.json
- Architecture: HIGH - extends established project patterns (Commander, Express routes, WriteThrough)
- Pitfalls: HIGH - derived from direct code inspection (chalk usage, Commander option scoping, SQLite text timestamps)

**Research date:** 2026-03-08
**Valid until:** 2026-04-08 (stable stack, no fast-moving dependencies)
