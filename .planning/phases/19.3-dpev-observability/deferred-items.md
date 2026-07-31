# Deferred Items — Phase 19.3

Out-of-scope discoveries logged during execution. NOT fixed (scope boundary rule).

## Pre-existing `npx tsc --noEmit` errors (discovered during 19.3-01, Task 2)

`npx tsc --noEmit` exits 2 with **8 errors across 4 files that Phase 19.3 Plan 01 never touched**.
Verified pre-existing: `git diff HEAD` on all four files is empty.

| File | Error | Root cause |
|------|-------|------------|
| `src/config/types.ts` (3 errors, lines ~62, 90, 91) | TS2769 — `.default({})` no overload matches | zod v4 tightened `.default()` typing: `{}` no longer satisfies the fully-resolved output type of a nested `ZodObject` whose fields all have their own `.default()`. Pre-v4 zod inferred the input type here. |
| `src/execution/self-healer.ts` (2 errors, lines 252, 369) | TS2353 — `maxTokens` not a known property | AI SDK v6 renamed `maxTokens` → `maxOutputTokens` in `CallSettings`. |
| `src/memory/incident-store.ts` (1 error, line 119) | TS2339 — `distanceType` does not exist on `Query` | `@lancedb/lancedb` v0.27 narrowed the query builder union; `distanceType` only exists on `VectorQuery`. |
| `src/cache/lance-store.ts` (errors) | same family as above | LanceDB / zod v4 type drift. |

**Impact:** None at runtime — the full vitest suite passes. This is a type-level dependency-upgrade
drift (zod v4, ai v6, lancedb v0.27) that predates Phase 19.3.

**Why deferred:** Fixing these touches four files outside `19.3-01-PLAN.md`'s declared
`files_modified` scope and would mix an unrelated dependency-migration change into an
observability phase. Per the executor scope boundary, only issues *directly caused by*
the current task's changes are auto-fixed.

**Recommended action:** Dedicated cleanup plan — "zod v4 / ai v6 / lancedb v0.27 type migration".
Small and mechanical (rename `maxTokens`, supply explicit `.default()` literals, narrow the
LanceDB query to `VectorQuery` before `.distanceType()`).

**Scope note for the rest of Phase 19.3:** `npx tsc --noEmit` cannot be used as a pass/fail gate
for later plans in this phase. Use the file-scoped check instead:
`npx tsc --noEmit 2>&1 | grep -E '^(src/config/pricing|src/ui/components/MarkdownView|src/state/session-usage)\.tsx?'`
— must return nothing.

## Pre-existing E2E POC test failures (discovered during 19.3-01 full-suite run)

`npx vitest run` reports **2 failed test files / 2 failed tests out of 1131**. Both are
environment-dependent E2E POC tests, not regressions.

| Test file | Failure | Environmental cause |
|-----------|---------|---------------------|
| `tests/e2e/poc-nginx-502.test.ts` — "executes fix plan and verifies health" | `expected 'halted' to be 'completed'` | No live LLM backend. Log shows `Selecting skill via unknown...`, `strategic model: unknown`, `[DIAGNOSIS] Structured failed after 0.0s, falling back to free-text`, then `CIRCUIT BREAKER: Step 0 failed after 3 retries`. Without a real model the generated fix commands are invalid, so the plan legitimately halts. |
| `tests/e2e/poc-nginx-502.test.ts` — "audit trail contains full DPEV evidence with correct ordering" | `assertDPEVSequence` missing required phases | Cascades from the halted run above — the E and V phases never emit. |
| `tests/e2e/poc-postgres-connleak.test.ts` (whole file) | `Error: Command failed: bash demo/postgres/reset-postgres.sh` (beforeAll hook; all 4 tests skipped) | Requires a running Docker daemon plus the `demo/postgres` stack. `demo/` is untracked in this working tree. |

**Proof these are NOT caused by Plan 01** (three independent checks):
1. `git diff HEAD~5 HEAD -- package-lock.json` → **569 insertions, 0 deletions**. The
   `npm install` added 34 new packages and did not alter the resolved version of any
   pre-existing dependency, so it cannot have changed pipeline behavior.
2. `git diff HEAD~5 HEAD -- package.json` → purely additive (2 dependency lines).
3. `grep -rn "config/pricing\|MarkdownView" src/` (excluding the two new files themselves)
   → **no matches**. Both new modules have zero call sites in `src/`; nothing in the
   runtime path imports them yet. Wiring happens in Plans 02/04.

**Why deferred:** Requires a live LLM backend and a running Docker demo stack — infrastructure
setup, not a code defect, and entirely outside Plan 01's declared `files_modified` scope.

**Scope note for the rest of Phase 19.3:** treat `1125 passed / 2 failed (E2E POC only)` as the
green baseline. Later plans should gate on the targeted suites
(`tests/ui/`, `tests/api/`, `tests/config/`, `tests/state/`) rather than a bare `npx vitest run`.

## Flaky unhandled rejection in `tests/api/stream-debug.test.ts`

The full-suite run surfaced one `Unhandled Rejection` — `AssertionError: expected 404 to be 200`
at `tests/api/stream-debug.test.ts:391` (double-approve idempotency test), thrown from a
`Timeout._onTimeout` after the test had already completed. **The file itself passes.** This is an
assertion inside a `setTimeout` callback that escapes the test's lifetime — a pre-existing test
hygiene issue (the assertion should be awaited rather than fired from a timer). Not caused by
Plan 01; no file in `tests/api/` was touched. Worth fixing when Plan 02 extends this test file.

## App.tsx keyboard precedence blocks two D-03 gestures (discovered during 19.3-04, Task 1)

Wiring the phase-accordion `useInput` into `DPEVPanel` surfaced two collisions with handlers
that already live in `src/ui/App.tsx`. Ink fires **every** registered `useInput` handler for each
keystroke — they are not exclusive — so the DPEVPanel handler cannot suppress them from its own file.

| Gesture | What happens today | Owner |
|---------|--------------------|-------|
| `Esc` | `App.tsx:337-340` tears the live session down (`setActivePrompt(undefined)`) or exits replay. DPEVPanel's `PHASE_EXPAND … expanded:false` also fires, but the panel unmounts, so the collapse is never observable. | `src/ui/App.tsx` |
| `j` / `k` | `CommandInput` is rendered with `isActive={!showStatusOverlay}` (`App.tsx:404`) — always on during a live session. With an empty prompt box, `handleShortcut` declines `j`/`k`, so they fall through to `setText(t => t + input)` and are typed into the command field while also moving phase focus. | `src/ui/App.tsx` |

`↑` / `↓` and `Enter` are **clean** — Ink normalizes non-alphanumeric keys to `input = ''`
(`node_modules/ink/build/hooks/use-input.js:91-93`), so `CommandInput` ignores them, and `App`'s
global handler does not read arrows. `Enter` with an empty prompt box is a no-op there too.

**Why deferred:** the fix is an arbitration change in `src/ui/App.tsx` — gate `CommandInput`'s
`isActive` on center-panel focus, and give the focused phase's collapse precedence over
session-exit for `Esc`. `App.tsx` is Plan 06's declared scope and 19.3-04's scope fence forbids
crossing into it.

**Recommended action (Plan 06):** thread an `activeFocus`-style prop into `DPEVPanel` the way
`SessionPanel` already receives one, so exactly one consumer owns the keystroke.

**Consequence for the 19.3-04 checkpoint:** verification steps 4 (`Esc` collapses the body) and the
`j`/`k` half of phase navigation cannot pass until Plan 06 lands. `↑`/`↓` + `Enter` expand are
verifiable today.

## `StreamingText` keys its windowed lines by array index (discovered during 19.3-04, Task 1)

`src/ui/components/StreamingText.tsx:28` renders `visibleLines.map((line, i) => <Text key={i}>)`.
Because the component windows to the **last** `maxLines` entries (`lines.slice(-maxLines)`), every
new token that pushes the window forward shifts each line's content to a different index while the
key stays the same — React then patches text into reused nodes instead of remounting. This is the
"secondary suspect" D-22 names, and a plausible source of the residual/artefact lines TERM-UX07
targets.

**Why deferred:** `src/ui/components/StreamingText.tsx` is not in 19.3-04's declared
`files_modified`, and the defect is pre-existing (unchanged since Phase 19). 19.3-04 fixed the
key instability it *does* own — the `DPEVPanel` phase list, which moved from `key={`phase-${i}`}`
to `key={`phase-${phase.name}-${phase.startedAt}`}`.

**Recommended action:** key on line content plus the window offset
(`key={`${lines.length - visibleLines.length + i}`}`), which is stable for a given line across
window advances. Small and local; needs a plan that declares `StreamingText.tsx` in scope.
