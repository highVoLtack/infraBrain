# Phase 11: Cross-Scenario Validation and UX Polish - Research

**Researched:** 2026-03-13
**Domain:** E2E test refactoring, audit trail DPEV sequence validation, CLI history UX
**Confidence:** HIGH

## Summary

Phase 11 closes v1.1 by (1) standardizing the audit trail into a compliance-grade DPEV sequence with shared validation, (2) refactoring all three E2E tests to a common archetype with shared helpers, and (3) adding usability improvements to `/infra:history` (default-to-latest, session aliases, compact DPEV summary, session list).

The codebase is well-positioned for this work. All three E2E tests already assert DPEV event presence but use independent, slightly varying mock provider patterns and lack sequence ordering checks. The history route and CLI command have full filter support but no default-to-latest behavior, no session aliases, and no list mode. The `WriteThrough` store already has `getRecentSessions()` which can serve as foundation for session listing and latest-session resolution.

**Primary recommendation:** Build shared test helpers first (`assertDPEVSequence`, `createMockLLMProvider`), then refactor all three E2E tests to use them, then add the `verification` event type, and finally implement the history UX improvements. This order ensures the test archetype is proven before adding new functionality.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **Audit Trail Depth -- Sequence-Based Validation (E2E-03):** Logical Phase Gating enforcing DPEV phase order (S->D->E->V) with multiple sub-events per phase. New `verification` event type. `assertDPEVSequence(entries)` shared helper in `tests/e2e/helpers/`. No payload content assertions -- verify event types and phase ordering only.
- **History Default Behavior (UX-01/UX-02):** No-args defaults to most recent session ("Contextual Continuity"). Compact DPEV Summary as default output. Footer hint. `--session last` and `--session previous` aliases resolved server-side via SQLite. `--list` flag for session overview. Session alias resolution in API route, not CLI client.
- **E2E Test Archetype -- Scenario Factory Blueprint:** Rigid archetype (Setup -> Trigger DPEV -> Assert Result -> Validate Audit Sequence). Zero Legacy policy -- refactor all 3 existing E2E tests. Shared `createMockLLMProvider(responses)` factory. Helpers in `tests/e2e/helpers/`.

### Claude's Discretion
- Exact compact DPEV summary format and chalk coloring
- Session list table columns and formatting
- How to extract DPEV summary from raw audit entries (grouping/aggregation logic)
- `verification` event emission point in the existing DPEV loop code
- Test archetype file structure details (e.g., whether helpers are separate files or one barrel export)

### Deferred Ideas (OUT OF SCOPE)
- Tab-completion for `--session` flag
- `--session last~N` git-style offset aliases
- Automated scenario generation from archetype template
- Cross-scenario correlation in audit trail
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| E2E-03 | Both E2E tests verify audit trail completeness (skill_selection, decision, execution events) | `assertDPEVSequence` helper validates DPEV phase ordering; `verification` event type added to AuditEventType union; all 3 tests refactored to archetype |
| UX-01 | `/infra:history` defaults to the most recent session when no `--session` flag provided | `getLatestSessionId()` on WriteThrough; history route resolves default; CLI sends no session param when absent |
| UX-02 | `/infra:history --session last` resolves to the latest session_id from SQLite | Server-side alias resolution in history route; `getSessionIdByAlias(alias)` on WriteThrough using `ORDER BY updated_at DESC LIMIT N` |
</phase_requirements>

## Standard Stack

### Core (already in project)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| vitest | ^4.0.18 | Test framework | Already used across 36 test files |
| supertest | ^7.2.2 | HTTP assertions for E2E | Already used in all 3 E2E tests |
| chalk | ^5.6.2 | CLI output coloring | Already used throughout formatter.ts |
| commander | ^14.0.3 | CLI command framework | Already used in commands.ts |
| better-sqlite3 | (project dep) | SQLite state store | Already used in WriteThrough |

### Supporting (no new dependencies)
No new libraries needed. All functionality builds on existing stack.

## Architecture Patterns

### Recommended Project Structure
```
tests/e2e/
  helpers/
    assert-dpev-sequence.ts    # DPEV phase ordering validator
    create-mock-provider.ts    # Shared LLMProvider factory
    index.ts                   # Barrel export
  poc-nginx-502.test.ts        # Refactored to archetype
  poc-postgres-connleak.test.ts # Refactored to archetype
  poc-docker-storage.test.ts   # Refactored to archetype
src/
  audit/types.ts               # + 'verification' event type
  api/routes/history.ts        # + default-to-latest, alias resolution, list endpoint
  state/store.ts               # + getLatestSessionId(), getSessionList(), getSessionIdByAlias()
  cli/commands.ts              # + --list flag, default behavior
  cli/formatter.ts             # + formatDPEVSummary(), formatSessionList()
```

### Pattern 1: assertDPEVSequence Validator
**What:** A shared function that validates audit entries follow the DPEV phase ordering: S (skill_selection) -> D (decision) -> E (execution_start, step_complete*, execution_complete) -> V (verification). Multiple sub-events within each phase are allowed.
**When to use:** Final assertion in every E2E test.
**Example:**
```typescript
// tests/e2e/helpers/assert-dpev-sequence.ts
type DPEVPhase = 'S' | 'D' | 'E' | 'V';

const PHASE_MAP: Record<string, DPEVPhase> = {
  skill_selection: 'S',
  decision: 'D',
  execution_start: 'E',
  step_complete: 'E',
  execution_complete: 'E',
  verification: 'V',
};

const PHASE_ORDER: DPEVPhase[] = ['S', 'D', 'E', 'V'];

export function assertDPEVSequence(entries: AuditEntry[]): void {
  // 1. Filter to DPEV-relevant events only
  const dpevEntries = entries.filter(e => PHASE_MAP[e.eventType]);

  // 2. Map to phases
  const phases = dpevEntries.map(e => PHASE_MAP[e.eventType]!);

  // 3. Verify monotonic phase ordering (can repeat, never go backward)
  let maxPhaseIdx = -1;
  for (const phase of phases) {
    const idx = PHASE_ORDER.indexOf(phase);
    expect(idx).toBeGreaterThanOrEqual(maxPhaseIdx);
    maxPhaseIdx = Math.max(maxPhaseIdx, idx);
  }

  // 4. Verify all phases present
  const uniquePhases = new Set(phases);
  for (const required of PHASE_ORDER) {
    expect(uniquePhases.has(required)).toBe(true);
  }
}
```

### Pattern 2: createMockLLMProvider Factory
**What:** A shared factory that creates a mock LLMProvider from scenario-specific response arrays, centralizing the registry/generateCommand/streamDiagnosis boilerplate.
**When to use:** In beforeAll of every E2E test.
**Current state:** All 3 tests create nearly identical mock providers with minor variations:
- nginx-502: No `registry` property (legacy from before multi-model)
- postgres-connleak: Has `registry` with stub
- docker-storage: Has `registry` with stub

**Standardization needed:** The factory must include the `registry` property (required by `LLMProvider` interface) and accept a `generateCommand` response string or function.

```typescript
// tests/e2e/helpers/create-mock-provider.ts
export function createMockLLMProvider(diagnosisResponse: string): LLMProvider {
  return {
    model: {} as any,
    registry: { get: () => ({} as any), entries: () => [] } as any,
    async *streamDiagnosis() { yield 'test'; },
    async generateCommand(): Promise<string> { return diagnosisResponse; },
  };
}
```

### Pattern 3: Server-Side Session Alias Resolution
**What:** The history API route resolves `last` and `previous` aliases to real session IDs before querying.
**When to use:** When `session` query param is `last` or `previous`.
**Integration point:** `src/api/routes/history.ts` router handler.

```typescript
// In history route, before building filters:
if (session === 'last' || session === 'previous') {
  const resolved = deps.store.getSessionIdByAlias(session);
  if (!resolved) { res.status(404).json({ error: `No session found for alias '${session}'` }); return; }
  filters.sessionId = resolved;
} else if (session) {
  filters.sessionId = session;
}
```

### Pattern 4: Default-to-Latest Behavior
**What:** When no `--session` flag is provided, the history route auto-resolves to the most recent session.
**Important consideration:** The current behavior returns ALL audit entries when no session is specified. Changing this is a breaking change for anyone relying on unfiltered history. The route should detect "no session + no other filters" and default to latest session, OR use a query param like `?default=latest` that the CLI always sends.

**Recommended approach:** CLI-side: when no `--session` is provided and no other filters are set, the CLI sends `?session=last`. This keeps the API backward-compatible (no session param = all entries) while the CLI provides the UX improvement.

### Anti-Patterns to Avoid
- **Duplicate mock boilerplate:** Never copy-paste mock provider setup between tests; always import from helpers.
- **Content-based audit assertions:** Never assert on payload strings (diagnosis text, command output) in DPEV sequence validation. Only assert event types and ordering.
- **Client-side alias resolution:** Session alias resolution (`last`, `previous`) must happen in the API route, not the CLI. The CLI just passes the string.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Session ID from alias | Manual SQL in route handler | `WriteThrough.getSessionIdByAlias()` | Centralizes session queries in store layer |
| Audit sequence validation | Per-test manual assertions | Shared `assertDPEVSequence()` | Single source of truth, consistent across all tests |
| Mock LLM provider | Copy-paste between tests | Shared `createMockLLMProvider()` | One place to update when LLMProvider interface changes |

## Common Pitfalls

### Pitfall 1: Audit Entry Ordering -- DESC vs ASC
**What goes wrong:** The `queryAuditLog` returns entries ordered by `timestamp DESC`. The DPEV sequence validator needs chronological (ASC) order.
**Why it happens:** The query is designed for "most recent first" display, not sequence validation.
**How to avoid:** In `assertDPEVSequence`, always reverse the entries (or sort by timestamp ASC) before validating phase ordering.
**Warning signs:** Tests pass when few entries but fail with many, or sequence appears backwards.

### Pitfall 2: Missing `verification` Event in Existing DPEV Loop
**What goes wrong:** The `verification` event type does not exist yet. All 3 E2E tests will fail `assertDPEVSequence` if it requires `V` phase but no code emits the event.
**Why it happens:** The current DPEV loop emits `execution_complete` as its final event. The new `verification` event must be added.
**How to avoid:** Add the `verification` event emission in the execute route AFTER execution completes successfully, and add `'verification'` to the `AuditEventType` union in `src/audit/types.ts`.
**Emission point:** In `src/api/routes/execute.ts`, after `executePlan` returns with `status === 'completed'`, before `res.json(result)`:
```typescript
if (result.status === 'completed') {
  deps.auditLogger.logExecution('verification', {
    sessionId,
    target,
    status: 'verified',
    stepsCompleted: result.stepResults.length,
  });
}
```

### Pitfall 3: Breaking Existing History Behavior
**What goes wrong:** Changing the default history behavior to filter by latest session breaks any script or test that expects unfiltered results.
**Why it happens:** Changing API default behavior without versioning.
**How to avoid:** Keep the API backward-compatible. The CLI sends `?session=last` when no session flag is provided. The API treats absent `session` param as "all entries" (unchanged).

### Pitfall 4: Nginx E2E Test Missing `registry` Property
**What goes wrong:** The nginx-502 test's mock provider lacks the `registry` property (added in multi-model Phase 8+). Refactoring to `createMockLLMProvider` fixes this, but if done partially, TypeScript will catch it.
**How to avoid:** The shared factory always includes `registry`.

### Pitfall 5: Session List vs Session History Confusion
**What goes wrong:** `--list` shows sessions, `--session <id>` shows audit entries for a session. These are two different data shapes from different tables.
**Why it happens:** Both live under the `history` command.
**How to avoid:** `--list` calls a separate store method (`getSessionList()`) and uses a different formatter (`formatSessionList`). The route should have a separate code path for `?list=true`.

## Code Examples

### WriteThrough Store Extensions

```typescript
// src/state/store.ts -- new methods

/**
 * Get the latest session ID from the sessions table.
 */
getLatestSessionId(): string | null {
  const row = this.db
    .prepare('SELECT id FROM sessions ORDER BY updated_at DESC LIMIT 1')
    .get() as { id: string } | undefined;
  return row?.id ?? null;
}

/**
 * Resolve session alias ('last' | 'previous') to a real session ID.
 */
getSessionIdByAlias(alias: 'last' | 'previous'): string | null {
  const offset = alias === 'last' ? 0 : 1;
  const row = this.db
    .prepare('SELECT id FROM sessions ORDER BY updated_at DESC LIMIT 1 OFFSET ?')
    .get(offset) as { id: string } | undefined;
  return row?.id ?? null;
}

/**
 * Get session list for --list display.
 */
getSessionList(limit: number = 20): Array<{
  id: string;
  status: string;
  target: string | null;
  updatedAt: string;
  eventCount: number;
}> {
  const rows = this.db.prepare(`
    SELECT
      s.id,
      json_extract(s.state, '$.status') as status,
      json_extract(s.state, '$.target') as target,
      s.updated_at,
      (SELECT COUNT(*) FROM audit_log WHERE session_id = s.id) as event_count
    FROM sessions s
    ORDER BY s.updated_at DESC
    LIMIT ?
  `).all(limit) as Array<Record<string, unknown>>;

  return rows.map(r => ({
    id: r.id as string,
    status: (r.status as string) ?? 'unknown',
    target: (r.target as string) ?? null,
    updatedAt: r.updated_at as string,
    eventCount: (r.event_count as number) ?? 0,
  }));
}
```

### Compact DPEV Summary Format (Claude's Discretion)

```typescript
// src/cli/formatter.ts -- new function
// Recommended format: S: skill-name -> D: root-cause -> E: N steps (M approved) -> V: outcome

export function formatDPEVSummary(entries: AuditEntry[]): string {
  // Sort chronologically
  const sorted = [...entries].sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  const skill = sorted.find(e => e.eventType === 'skill_selection');
  const decision = sorted.find(e => e.eventType === 'decision');
  const steps = sorted.filter(e => e.eventType === 'step_complete');
  const verification = sorted.find(e => e.eventType === 'verification');
  const execComplete = sorted.find(e => e.eventType === 'execution_complete');

  const sStr = chalk.cyan(`S: ${(skill?.metadata as any)?.skillName ?? 'unknown'}`);
  const dStr = chalk.yellow(`D: ${decision?.decision?.substring(0, 40) ?? 'unknown'}`);
  const eStr = chalk.green(`E: ${steps.length} steps`);
  const vStr = verification
    ? chalk.green(`V: ${(verification.metadata as any)?.status ?? 'done'}`)
    : (execComplete ? chalk.gray('V: (no verification)') : chalk.red('V: incomplete'));

  return `${sStr} -> ${dStr} -> ${eStr} -> ${vStr}`;
}
```

### History Route List Endpoint

```typescript
// In history route, add list handling at the top:
if (req.query.list === 'true') {
  const sessions = deps.store.getSessionList(
    limit ? parseInt(limit, 10) : 20
  );
  res.json({ sessions, count: sessions.length });
  return;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Per-test audit assertions | Shared `assertDPEVSequence` | Phase 11 | Single source of truth for DPEV compliance |
| Per-test mock provider setup | Shared `createMockLLMProvider` factory | Phase 11 | Adding scenarios = defining responses only |
| Unfiltered history default | Default-to-latest-session | Phase 11 | Admins see relevant session immediately |
| No `verification` event | Explicit verification audit event | Phase 11 | Completes the DPEV acronym in audit trail |

## Open Questions

1. **Where exactly should `verification` event be emitted?**
   - What we know: Execute route emits `execution_complete` after plan finishes. The `verification` event should come after this.
   - What's unclear: Should it be emitted only on success, or also on failure (with different status)?
   - Recommendation: Emit on success only (`status === 'completed'`). Failed executions don't reach verification phase. This matches DPEV semantics -- you only Verify after successful Execution.

2. **Should `--list` be a sub-route or query param?**
   - What we know: CONTEXT.md says `--list` flag under history, not a separate command.
   - Recommendation: Use `?list=true` query param on the same `/history` route. The CLI maps `--list` to this param. Keeps the command simple.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest ^4.0.18 |
| Config file | vitest.config.ts |
| Quick run command | `npx vitest run tests/e2e/ --reporter=verbose` |
| Full suite command | `npx vitest run` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| E2E-03 | Audit trail completeness with DPEV sequence ordering | E2E | `npx vitest run tests/e2e/poc-postgres-connleak.test.ts -t "DPEV" -x` | Partial (assertions exist, need refactor to use assertDPEVSequence) |
| E2E-03 | Audit trail completeness with DPEV sequence ordering | E2E | `npx vitest run tests/e2e/poc-docker-storage.test.ts -t "DPEV" -x` | Partial (assertions exist, need refactor to use assertDPEVSequence) |
| UX-01 | History defaults to most recent session | unit | `npx vitest run tests/api/history.test.ts -t "default" -x` | No -- Wave 0 |
| UX-02 | `--session last` resolves to latest session_id | unit | `npx vitest run tests/api/history.test.ts -t "alias" -x` | No -- Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run tests/e2e/ --reporter=verbose`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/e2e/helpers/assert-dpev-sequence.ts` -- shared DPEV validator (E2E-03)
- [ ] `tests/e2e/helpers/create-mock-provider.ts` -- shared mock LLM factory
- [ ] `tests/e2e/helpers/index.ts` -- barrel export
- [ ] `tests/api/history.test.ts` -- unit tests for default-to-latest and alias resolution (UX-01, UX-02)

## Sources

### Primary (HIGH confidence)
- Project source code: `src/state/store.ts`, `src/api/routes/history.ts`, `src/api/routes/execute.ts`, `src/cli/commands.ts`, `src/cli/formatter.ts`, `src/audit/types.ts`, `src/audit/logger.ts`, `src/llm/types.ts`
- Existing E2E tests: `tests/e2e/poc-nginx-502.test.ts`, `tests/e2e/poc-postgres-connleak.test.ts`, `tests/e2e/poc-docker-storage.test.ts`
- CONTEXT.md decisions from user discussion session

### Secondary (MEDIUM confidence)
- vitest documentation for test helper patterns and shared setup
- SQLite `ORDER BY ... LIMIT ... OFFSET` for alias resolution

### Tertiary (LOW confidence)
- None -- all findings based on direct codebase inspection

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies, all existing project libraries
- Architecture: HIGH -- patterns derived directly from existing codebase patterns and CONTEXT.md decisions
- Pitfalls: HIGH -- identified from actual code inspection (DESC ordering, missing registry property, missing verification event)

**Research date:** 2026-03-13
**Valid until:** 2026-04-13 (stable -- internal codebase patterns)
