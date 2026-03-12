# Phase 7: Audit Metadata and Integration Polish - Research

**Researched:** 2026-03-12
**Domain:** SQLite schema migration, log-analysis runtime wiring, execution context injection
**Confidence:** HIGH

## Summary

Phase 7 closes three cross-phase integration quality gaps identified in the v1.0 re-audit (GAP-01, GAP-02, GAP-03). All three are well-scoped surgical fixes to existing code -- no new libraries, no new architectural patterns, no new modules. The codebase already has the building blocks: the `metadata` field exists on `AuditEntry`, the log-analysis parsers are fully unit-tested, and `RollingContext.getContext()` already produces the right output. The work is strictly about wiring existing pieces together.

**GAP-01 (audit metadata):** The `audit_log` SQLite table lacks a `metadata TEXT` column, so `appendAudit` silently drops the `entry.metadata` field. The fix is: add the column to the schema, add `JSON.stringify(entry.metadata)` to the INSERT, and include metadata in `queryAuditLog` results. This is the only gap with schema migration implications -- `CREATE TABLE IF NOT EXISTS` with the new column handles fresh databases, but existing databases need an `ALTER TABLE ADD COLUMN` migration path.

**GAP-02 (log pre-filter runtime):** The `src/log-analysis/` module (4 parsers, detector, filter) is fully tested but never imported in any runtime path. The debug route should detect log-heavy prompts (heuristic: prompt contains multi-line content that looks like log output) and run `parseLog` + `preFilterLogs` + `formatForLLM` before sending to the LLM, reducing token waste.

**GAP-03 (rolling context injection):** `RollingContext` is instantiated and fed step results in `executePlan`, but `getContext()` is never called. The executor needs to inject the rolling context string into each sub-agent's system prompt or user message so that later steps have awareness of earlier step outcomes.

**Primary recommendation:** Implement as three independent plans (one per gap) -- they touch different files with no cross-dependencies.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SAFE-11 | Audit log is queryable via SQLite | GAP-01: metadata column missing from audit_log table; appendAudit drops metadata field |
| INTF-03 | Admin can view audit history via CLI | GAP-01: /infra:history shows empty summaries for execution events because metadata not in SQLite |
| SKIL-03 | Log analysis skill pre-filters logs before LLM analysis | GAP-02: preFilterLogs exists but never called in debug route runtime path |
| SKIL-04 | Log analysis skill handles common formats | GAP-02: parsers exist and tested but not wired into runtime; detectLogFormat + parseLog ready |
| CORE-07 | Each sub-agent task runs with isolated context | GAP-03: RollingContext accumulates but getContext() never injected into LLM calls |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| better-sqlite3 | already installed | Synchronous SQLite for schema migration + query | Project decision (STATE.md) |
| vitest | ^4.0.18 | Test framework | Already in use across 36 test files |

### Supporting
No new libraries needed. All work uses existing modules:
- `src/log-analysis/filter.ts` -- `preFilterLogs`, `formatForLLM`
- `src/log-analysis/parsers/index.ts` -- `parseLog`
- `src/execution/context-builder.ts` -- `RollingContext.getContext()`

### Alternatives Considered
None -- this phase is pure integration wiring of existing code.

## Architecture Patterns

### Pattern 1: SQLite Schema Migration (GAP-01)
**What:** Add `metadata TEXT` column to `audit_log` table
**When to use:** When existing databases need the new column without data loss
**Approach:** Use `ALTER TABLE ... ADD COLUMN` with a try-catch since SQLite throws "duplicate column name" if it already exists. This is the simplest migration pattern for a single additive column -- no migration framework needed.

```typescript
// In initDatabase(), after CREATE TABLE IF NOT EXISTS:
try {
  db.exec('ALTER TABLE audit_log ADD COLUMN metadata TEXT');
} catch {
  // Column already exists -- idempotent
}
```

**Why not a migration framework:** Single additive column on a single table. A migration framework (knex, umzug) would be overkill. The try-catch-on-duplicate pattern is standard for SQLite single-column additions.

### Pattern 2: Log Detection Heuristic (GAP-02)
**What:** Detect when a user prompt contains log-like content and pre-filter before LLM
**When to use:** In the debug route, before sending the prompt to the LLM
**Approach:** A simple heuristic -- if the prompt contains multiple lines matching common log patterns (timestamps, log levels), extract those lines, parse them through the log-analysis pipeline, and replace the raw logs in the prompt with the filtered/formatted output.

```typescript
// Heuristic: prompt has 5+ lines AND contains common log indicators
function looksLikeLogContent(prompt: string): boolean {
  const lines = prompt.split('\n');
  if (lines.length < 5) return false;
  const logIndicators = /\b(ERROR|WARN|INFO|DEBUG|FATAL|CRITICAL)\b|\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/i;
  const matchingLines = lines.filter(l => logIndicators.test(l));
  return matchingLines.length >= 3;
}
```

### Pattern 3: Rolling Context Injection (GAP-03)
**What:** Inject accumulated step context into the executor's LLM-facing operations
**When to use:** Before each sub-agent step execution in executePlan
**Approach:** The executor currently does not make direct LLM calls -- it runs commands via `runner.run()`. The rolling context is meant to be available for sub-agent LLM calls that happen during multi-step execution. The injection point is in the `requestApproval` or a new LLM call site within the executor loop. Looking at the current code, the most natural injection is to expose the context via `ExecutionDeps` or pass it to the audit logger so downstream consumers can access it. However, the simplest approach: add the rolling context to the execution result or make it accessible on `ExecutionDeps` so the route handler can use it.

**Key insight from code analysis:** The executor does NOT make LLM calls directly. It runs shell commands. The "sub-agent LLM calls" mentioned in CORE-07 refers to the potential for the executor to call the LLM for step-level reasoning. Currently, the executor only runs commands and logs results. The rolling context should be injected into the system prompt when the executor or its caller makes LLM calls for subsequent steps. The most practical injection point is to pass `context.getContext()` into the runner or expose it for the execute route to include in any follow-up LLM calls.

**Practical approach:** Add `rollingContext` to the `ExecutionResult` so that callers (execute route, resume route) can pass accumulated context to subsequent LLM interactions. Also add the context as a metadata field in step audit events so it's recorded. Most importantly: make `getContext()` available by returning it or by injecting it into the step execution flow.

### Anti-Patterns to Avoid
- **Full table recreation for schema migration:** Never DROP and re-CREATE audit_log. Use ALTER TABLE ADD COLUMN.
- **Regex-only log detection:** Don't try to perfectly detect log content. A simple heuristic is sufficient -- false negatives just mean the LLM handles raw logs (current behavior, still functional).
- **Breaking ExecutionDeps interface:** Don't add required fields. Any new fields must be optional for backwards compatibility.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Log parsing | Custom parsers | `src/log-analysis/parsers/index.ts` `parseLog()` | Already built and tested (4 formats) |
| Log format detection | Format heuristic | `src/log-analysis/detector.ts` `detectLogFormat()` | Already handles JSON, Docker, journald, syslog |
| Log filtering | Token-aware truncation | `src/log-analysis/filter.ts` `preFilterLogs()` | Already handles level filter + maxLines truncation |
| LLM-friendly formatting | Custom formatter | `src/log-analysis/filter.ts` `formatForLLM()` | Consistent format across all log types |
| Context compression | Custom context builder | `src/execution/context-builder.ts` `RollingContext` | Already compresses at 80% token budget |
| Schema migration framework | Migration system | Try-catch ALTER TABLE | Single additive column, no framework needed |

## Common Pitfalls

### Pitfall 1: SQLite ALTER TABLE Limitations
**What goes wrong:** SQLite does not support `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` (unlike PostgreSQL).
**Why it happens:** SQLite's ALTER TABLE is minimal -- only ADD COLUMN and RENAME TABLE.
**How to avoid:** Wrap in try-catch. The error message is "duplicate column name: metadata" which is safe to ignore.
**Warning signs:** Test failure on second run of initDatabase with same DB file.

### Pitfall 2: Metadata Serialization Mismatch
**What goes wrong:** `entry.metadata` is `Record<string, unknown>` but you store it as TEXT. Reading it back requires `JSON.parse`.
**Why it happens:** SQLite has no native JSON column type (TEXT stores JSON strings).
**How to avoid:** Always `JSON.stringify` on write, `JSON.parse` on read. Handle null (metadata is optional on AuditEntry).
**Warning signs:** `queryAuditLog` returns string instead of object for metadata field.

### Pitfall 3: Log Detection False Positives
**What goes wrong:** Prompt text that isn't logs gets sent through the log parser, producing garbage.
**Why it happens:** Overly aggressive heuristic.
**How to avoid:** Require multiple indicators (line count threshold + pattern matches). If parsing produces mostly unparseable lines, fall back to raw prompt.
**Warning signs:** `ParsedLog.unparseable` array is large relative to total lines.

### Pitfall 4: Breaking Existing Tests
**What goes wrong:** Schema change breaks `db.test.ts` column count assertions or `store.test.ts` INSERT expectations.
**Why it happens:** Tests assert specific column names/counts.
**How to avoid:** Update `db.test.ts` to expect `metadata` column. Update `store.test.ts` to verify metadata round-trip.
**Warning signs:** Test failures in existing state/ test files.

### Pitfall 5: Rolling Context Size in Audit Metadata
**What goes wrong:** Storing full rolling context text in audit metadata bloats the SQLite database.
**Why it happens:** Rolling context can contain full command outputs from multiple steps.
**How to avoid:** Only store a summary or token count in metadata, not the full context string.

## Code Examples

### GAP-01: Schema Migration + appendAudit Fix

```typescript
// src/state/db.ts -- add metadata column
// After existing CREATE TABLE:
try {
  db.exec('ALTER TABLE audit_log ADD COLUMN metadata TEXT');
} catch {
  // Column already exists (idempotent for existing databases)
}
```

```typescript
// src/state/store.ts -- appendAudit update
const stmt = this.db.prepare(`
  INSERT INTO audit_log (session_id, timestamp, event_type, risk_level, command, decision, reasoning, diff_before, diff_after, metadata)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
stmt.run(
  entry.sessionId,
  entry.timestamp,
  entry.eventType,
  entry.riskLevel ?? null,
  entry.command ?? null,
  entry.decision ?? null,
  entry.reasoning ?? null,
  entry.diffBefore ?? null,
  entry.diffAfter ?? null,
  entry.metadata ? JSON.stringify(entry.metadata) : null
);
```

```typescript
// src/state/store.ts -- queryAuditLog update (add metadata to mapping)
return rows.map((row) => ({
  // ... existing fields ...
  metadata: row.metadata ? JSON.parse(row.metadata as string) : undefined,
})) as AuditEntry[];
```

### GAP-02: Log Pre-Filter Wiring in Debug Route

```typescript
// src/api/routes/debug.ts -- import and use
import { parseLog } from '../../log-analysis/parsers/index.js';
import { preFilterLogs, formatForLLM } from '../../log-analysis/filter.js';

function preFilterIfLogHeavy(prompt: string): { filtered: string; wasFiltered: boolean } {
  const lines = prompt.split('\n');
  if (lines.length < 5) return { filtered: prompt, wasFiltered: false };

  const logIndicators = /\b(ERROR|WARN|INFO|DEBUG|FATAL|CRITICAL)\b|\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/i;
  const matchCount = lines.filter(l => logIndicators.test(l)).length;
  if (matchCount < 3) return { filtered: prompt, wasFiltered: false };

  // Extract log-like lines and non-log context
  const logLines = lines.filter(l => logIndicators.test(l));
  const contextLines = lines.filter(l => !logIndicators.test(l));

  const parsed = parseLog(logLines.join('\n'));
  if (parsed.unparseable.length > parsed.entries.length) {
    // More unparseable than parsed -- heuristic failed, return raw
    return { filtered: prompt, wasFiltered: false };
  }

  const { filtered } = preFilterLogs({ entries: parsed.entries });
  const formattedLogs = formatForLLM(filtered);

  const result = [...contextLines.filter(Boolean), '', 'Pre-filtered logs:', formattedLogs].join('\n');
  return { filtered: result, wasFiltered: true };
}
```

### GAP-03: Rolling Context Injection in Executor

```typescript
// src/execution/executor.ts -- expose context for each step
// After context.addStepResult (line ~218), the context is available
// The key change: pass context.getContext() into a new optional field
// on the step execution or expose it on the result

// Option A: Add to step audit log
deps.auditLogger.logExecution('step_complete', {
  stepIndex: i,
  command: step.command,
  exitCode: cbResult.result!.exitCode,
  rollingContextTokens: estimateTokens(context.getContext()),
});

// Option B: Make context accessible to caller via result
return {
  status: 'completed',
  stepResults,
  rollingContext: context.getContext(),  // new optional field
};
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Metadata in JSONL only | Metadata in JSONL + SQLite | Phase 7 (GAP-01) | /infra:history shows full execution summaries |
| LLM handles raw logs | Pre-filter logs before LLM | Phase 7 (GAP-02) | Reduced token usage on log-heavy prompts |
| Steps execute independently | Steps share rolling context | Phase 7 (GAP-03) | Multi-step plans have awareness of prior results |

## Open Questions

1. **Rolling context injection point**
   - What we know: `RollingContext.getContext()` produces a formatted string. The executor runs shell commands, not LLM calls directly.
   - What's unclear: Where exactly should the context be consumed? The executor itself doesn't call the LLM -- it runs commands via `runner.run()`.
   - Recommendation: Expose `rollingContext` on `ExecutionResult` so the execute/resume routes can use it in follow-up LLM calls. Also consider injecting context into the system prompt if the executor ever gains LLM-per-step capability. For now, the minimal viable fix is to log that the context is accumulated and return it, satisfying the requirement that "sub-agent tasks have awareness of prior step results" -- the context IS accumulated and CAN be consumed.

2. **Existing database migration**
   - What we know: `ALTER TABLE ADD COLUMN` with try-catch handles both new and existing databases.
   - What's unclear: Whether any production databases exist that would be affected.
   - Recommendation: The try-catch pattern is sufficient. No data loss risk since it's a nullable column addition.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.0.18 |
| Config file | package.json (scripts.test) |
| Quick run command | `npx vitest run --reporter=verbose` |
| Full suite command | `npx vitest run` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SAFE-11 | metadata column in audit_log + appendAudit persists metadata | unit | `npx vitest run tests/state/db.test.ts tests/state/store.test.ts -x` | Yes (needs update) |
| INTF-03 | queryAuditLog returns metadata, history shows summaries | unit | `npx vitest run tests/state/history-query.test.ts -x` | Yes (needs update) |
| SKIL-03 | preFilterLogs called in debug route for log-heavy prompts | unit | `npx vitest run tests/api/routes.test.ts -x` | Yes (needs update) |
| SKIL-04 | log format detection + parsing activated at runtime | unit | `npx vitest run tests/log-analysis/parsers.test.ts tests/log-analysis/filter.test.ts -x` | Yes (existing, verify) |
| CORE-07 | rollingContext.getContext() exposed/injected in executor | unit | `npx vitest run tests/execution/executor.test.ts -x` | Yes (needs update) |

### Sampling Rate
- **Per task commit:** `npx vitest run --reporter=verbose`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/state/db.test.ts` -- add assertion for `metadata` column existence
- [ ] `tests/state/store.test.ts` -- add metadata round-trip test in appendAudit/queryAuditLog
- [ ] `tests/api/routes.test.ts` -- add test for log-heavy prompt pre-filtering in debug route
- [ ] `tests/execution/executor.test.ts` -- add test that rolling context is populated and accessible

## Sources

### Primary (HIGH confidence)
- Direct source code analysis of all affected files (db.ts, store.ts, executor.ts, debug.ts, filter.ts, logger.ts, types.ts)
- v1.0-MILESTONE-AUDIT.md -- gap definitions GAP-01, GAP-02, GAP-03
- Existing test files for all affected modules

### Secondary (MEDIUM confidence)
- SQLite ALTER TABLE documentation (well-known behavior, no API lookup needed)
- better-sqlite3 synchronous API patterns (already validated in project)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new libraries, all existing code
- Architecture: HIGH -- surgical fixes to existing patterns, no new architectural decisions
- Pitfalls: HIGH -- all pitfalls derived from direct code analysis of current implementation

**Research date:** 2026-03-12
**Valid until:** 2026-04-12 (stable -- internal integration wiring, no external dependency changes)
