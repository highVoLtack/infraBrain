# Phase 6: Resume Wiring and Audit Completeness - Research

**Researched:** 2026-03-12
**Domain:** Integration gap closure (executor wiring, audit events, dead code cleanup)
**Confidence:** HIGH

## Summary

Phase 6 closes three specific gaps identified by the v1.0 milestone audit. All code structures already exist -- types are defined, functions are exported, display logic is implemented -- but the wiring between components is missing. This is purely a wiring and integration phase, not a feature-building phase.

The three gaps are: (1) executor never calls `updateSessionForResume` on halt, so resume cannot find real interrupted sessions, (2) lock acquire/release operations are silent in the audit trail despite event types and display formatters already existing, and (3) the resume route uses a stub runner `{ run: async () => ({ stdout: '', stderr: '', exitCode: 0 }) }` instead of the real `runCommand`, plus `formatResumeSummary` is imported but never called in the CLI resume command.

**Primary recommendation:** Wire existing functions into existing call sites -- no new modules, no new types, no architectural changes. Each fix is 5-20 lines of code in an existing file.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| INTF-07 | Admin can resume an interrupted fix plan from where it left off | Gap 1 (executor halt persistence) + Gap 3 (stub runner replacement) wire the end-to-end resume flow |
| SAFE-09 | System logs every decision as structured JSON | Gap 2 (lock audit events) ensures lock operations appear in audit trail |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| vitest | 4.0.18 | Test framework | Already used project-wide, 322 tests passing |
| better-sqlite3 | (existing) | SQLite persistence | Project decision, WriteThrough dual-write pattern |
| express | (existing) | API routes | All routes follow factory pattern with injectable deps |

### Supporting
No new libraries needed. All required functionality exists in the codebase.

## Architecture Patterns

### Existing Patterns to Follow

**Pattern 1: Executor audit logging**
The executor already calls `deps.auditLogger.logExecution(eventType, details)` for events like `execution_start`, `circuit_breaker_triggered`, `damage_budget_exceeded`. Lock events follow the exact same pattern.

```typescript
// Existing pattern in executor.ts:
deps.auditLogger.logExecution('circuit_breaker_triggered', {
  stepIndex: i,
  command: step.command,
  maxRetries: deps.config.circuitBreaker.maxRetries,
});

// Lock events follow identically:
deps.auditLogger.logExecution('lock_acquired', { target });
deps.auditLogger.logExecution('lock_released', { target });
```

**Pattern 2: Session state persistence (dual-write)**
`updateSessionForResume` in `src/state/session.ts` already writes to disk. The executor also needs to update SQLite via the WriteThrough store. Currently ExecutionDeps does not include `store` -- this needs adding OR the executor can call `updateSessionForResume` directly (which only writes the file) and let the caller persist to SQLite.

**Pattern 3: Resume route runner injection**
The execute route (`src/api/routes/execute.ts`) already shows the correct pattern for wiring `runCommand`:
```typescript
const runner = {
  run: (executable: string, args: string[], options: { timeout: number; maxBuffer?: number }): Promise<RunResult> => {
    return runCommand(executable, args, options);
  },
};
```
The resume route at line 81 uses a stub instead. Direct replacement.

**Pattern 4: CLI formatter usage**
The debug command calls formatters to display results. The resume command should call `formatResumeSummary(session)` before prompting for action, to show the user what they are resuming.

### Recommended Change Map

```
src/
├── execution/
│   └── executor.ts          # Add: lock audit events + halt persistence call
├── api/routes/
│   └── resume.ts            # Fix: replace stub runner with real runCommand
├── cli/
│   └── commands.ts           # Fix: call formatResumeSummary before resume prompt
└── (no new files needed)
```

### Anti-Patterns to Avoid
- **Don't add new ExecutionDeps fields if avoidable:** The executor already has `sessionDir` -- use `updateSessionForResume(sessionDir, ...)` directly rather than adding a `store` dependency. Keep the dep surface minimal.
- **Don't refactor lock manager:** The audit events should be emitted by the executor (the orchestration layer), not by the lock manager itself. The manager is a low-level utility; audit is a cross-cutting concern handled at the executor level.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Session state file writing | Custom file writer | `updateSessionForResume()` from `src/state/session.ts` | Already handles state.json writing with correct structure |
| Audit event emission | Direct SQLite inserts | `auditLogger.logExecution()` | Handles dual-write (JSONL + SQLite) automatically |
| Command execution | New runner | `runCommand()` from `src/execution/runner.ts` | Already handles execFile, timeout, error extraction |

## Common Pitfalls

### Pitfall 1: Executor does not have access to WriteThrough store
**What goes wrong:** `updateSessionForResume` writes state.json to disk but does NOT update SQLite. The resume route queries SQLite via `store.getSessionById()`. If only the file is updated, SQLite still has stale data without `resumeMetadata`.
**Why it happens:** The executor's `ExecutionDeps` interface does not include the `store`.
**How to avoid:** Either (a) add an optional `store` to ExecutionDeps and call `store.persistState()` after `updateSessionForResume`, or (b) handle the SQLite update at the route level (execute route) after `executePlan` returns a halted result. Option (b) is cleaner -- the execute route already has access to the store.
**Warning signs:** Resume tests pass with mocked data but fail when querying real SQLite.

### Pitfall 2: Lock event timing -- emit AFTER successful acquire/release
**What goes wrong:** Emitting `lock_acquired` before the actual acquire means you log events that didn't happen (if acquire fails).
**How to avoid:** Emit `lock_acquired` after `lockAcquired = true` (line 61). Emit `lock_released` inside the finally block after `releaseLock()` succeeds.

### Pitfall 3: Resume needs SessionState with currentPlan populated
**What goes wrong:** `updateSessionForResume` sets `resumeMetadata` but does NOT populate `currentPlan`. The resume route checks `session.resumeMetadata && session.currentPlan` (line 45). If `currentPlan` is never set, resume still fails.
**Why it happens:** The execute route never persists the plan to session state.
**How to avoid:** When the executor returns `halted`, the execute route must also persist `currentPlan` on the SessionState before writing to SQLite. This is the key integration step.

### Pitfall 4: formatResumeSummary needs session data from API
**What goes wrong:** The CLI resume command sends a POST to `/resume` but never fetches session data first. `formatResumeSummary` needs a `SessionState` object.
**How to avoid:** Either (a) add a GET endpoint to fetch session info before resuming, or (b) fetch via the status API, or (c) include session summary data in the resume POST response so the CLI can display it after.

## Code Examples

### Change 1: Executor -- emit lock audit events

```typescript
// In executor.ts, after lockAcquired = true (line 61):
deps.auditLogger.logExecution('lock_acquired', { target });

// In the finally block, after releaseLock (line 229):
if (lockAcquired) {
  releaseLock(target, lockDir);
  deps.auditLogger.logExecution('lock_released', { target });
}
```

### Change 2: Executor -- call updateSessionForResume on halt

```typescript
// Import at top of executor.ts:
import { updateSessionForResume } from '../state/session.js';

// Before each halted return (damage_budget_exceeded and circuit_breaker):
updateSessionForResume(deps.sessionDir, /* need SessionState */, i, 'damage_budget_exceeded', target);
```

Note: The executor does not currently have access to the full SessionState object. The cleanest approach is to handle halt persistence in the execute route (caller), which already has access to the store and can build the SessionState.

### Change 3: Resume route -- replace stub runner

```typescript
// In resume.ts, replace line 81:
// FROM:
runner: { run: async () => ({ stdout: '', stderr: '', exitCode: 0 }) },
// TO:
import { runCommand } from '../../execution/runner.js';
// ...
runner: { run: runCommand },
```

### Change 4: CLI -- call formatResumeSummary

```typescript
// In commands.ts resume action, after getting session data but before prompting:
// Need to fetch session info first to display summary
// formatResumeSummary(sessionData) -- needs SessionState from API
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Stub runner in resume route | Real runCommand | Phase 6 | Resume actually executes commands |
| Silent lock operations | Audited lock operations | Phase 6 | Full audit trail for SAFE-09 |
| Disconnected halt flow | Halt persists resume metadata | Phase 6 | Resume finds real interrupted sessions |

## Open Questions

1. **How to get SessionState into executor for updateSessionForResume?**
   - What we know: ExecutionDeps has `sessionDir` and `sessionId` but not `store` or `SessionState`
   - What's unclear: Should we extend ExecutionDeps or handle at caller level?
   - Recommendation: Handle at caller level (execute route). The route already has `store` access. When `executePlan` returns `halted`, the route builds SessionState with `resumeMetadata` and `currentPlan`, then calls `store.persistState()`. This avoids changing the ExecutionDeps interface.

2. **How to get session info for formatResumeSummary in CLI?**
   - What we know: CLI resume command only calls POST /resume. formatResumeSummary needs SessionState.
   - What's unclear: Add a GET route? Use status API?
   - Recommendation: Add session info to the resume POST response (return session summary alongside execution result). Minimal API surface change.

3. **Should lock_conflict and lock_override also be audited?**
   - What we know: These event types exist in AuditEventType and have display logic in formatter.ts
   - Recommendation: Yes, add them in the same change. Emit `lock_conflict` when returning rejected due to lock, `lock_override` when force-override succeeds. Completeness at no extra cost.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.0.18 |
| Config file | vitest.config.ts |
| Quick run command | `npx vitest run --reporter=verbose` |
| Full suite command | `npx vitest run` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| INTF-07a | Executor halt persists resumeMetadata to disk and SQLite | integration | `npx vitest run tests/execution/executor.test.ts -x` | Needs new tests |
| INTF-07b | Resume route uses real runCommand (not stub) | unit | `npx vitest run tests/api/resume.test.ts -x` | Exists, needs update |
| INTF-07c | formatResumeSummary called in CLI resume | unit | `npx vitest run tests/cli/commands.test.ts -x` | May need new test |
| SAFE-09 | Lock acquire/release emit audit events | unit | `npx vitest run tests/execution/executor.test.ts -x` | Needs new tests |
| SC-5 | formatResumeSummary not dead code | unit | `npx vitest run tests/cli/commands.test.ts -x` | May need new test |

### Sampling Rate
- **Per task commit:** `npx vitest run --reporter=verbose`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] New test cases in `tests/execution/executor.test.ts` -- lock audit events emitted on acquire/release
- [ ] New test cases in `tests/execution/executor.test.ts` or execute route tests -- halt persists resumeMetadata
- [ ] Update `tests/api/resume.test.ts` -- verify real runner wired (not stub)
- [ ] Test for formatResumeSummary integration in CLI resume flow

## Sources

### Primary (HIGH confidence)
- Source code inspection: `src/execution/executor.ts` -- confirmed no `updateSessionForResume` import or call
- Source code inspection: `src/api/routes/resume.ts:81` -- confirmed stub runner `{ run: async () => ({ stdout: '', stderr: '', exitCode: 0 }) }`
- Source code inspection: `src/cli/commands.ts:4` -- confirmed `formatResumeSummary` imported but never called in resume action
- Source code inspection: `src/audit/types.ts:23-26` -- confirmed lock event types defined
- Source code inspection: `src/cli/formatter.ts:333-337` -- confirmed display logic exists for lock events
- `.planning/v1.0-MILESTONE-AUDIT.md` -- authoritative gap definitions

### Secondary (MEDIUM confidence)
- None needed -- this is purely internal wiring, no external dependencies

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - no new libraries, all existing code inspected
- Architecture: HIGH - patterns copied from adjacent code in same files
- Pitfalls: HIGH - identified through direct source code analysis of data flow

**Research date:** 2026-03-12
**Valid until:** No expiry -- internal codebase analysis, not dependent on external APIs
