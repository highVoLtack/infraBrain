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

## RESOLVED in 19.3-06 (kept for provenance)

- **App.tsx keyboard precedence** (section below) — fixed by the `resolveKeyboardOwner` /
  `resolveEscapeAction` arbitration in `src/ui/App.tsx`. `CommandInput` now only holds the keyboard
  when nothing else claims it, and Esc yields to a visible phase collapse before exiting a session.
- **Finding 1 — approval keystrokes leak into CommandInput** (section below) — same fix; regression
  test `does not leak an approval keystroke into the command box during a live session`.
- **Finding 2 — session footer cost contradicts the per-phase lines** (section below) — fixed by
  `formatSessionCost` in `src/ui/panels/DPEVPanel.tsx`.

Still open below: the tsc errors, the E2E POCs, the flaky api rejection, the `StreamingText` index
keys, and pipeline `console.log` (Finding 3).

## Audit producer does not emit the step fields replay reads (discovered during 19.3-06, Task 1)

`buildReplayState` now reconstructs `command`, `risk`, `target`, `total`, `stdout` and `stderr` for
every execution step, merging by `stepIndex` exactly as the runtime `STEP_UPDATE` reducer does. The
consumer is complete. **The producer is not.**

`src/execution/executor.ts:341` is the *only* step-level audit emission in `src/`:

```typescript
deps.auditLogger.logExecution('step_complete', {
  stepIndex: i,
  command: commandUsed,
  exitCode: finalResult.exitCode,
});
```

| Field replay reads | Emitted today? | Consequence in replay |
|--------------------|----------------|-----------------------|
| `command` | yes | renders correctly |
| `risk` | **no** | `StepCard` renders an empty `[]` badge |
| `totalSteps` | **no** | step counter renders `[1/0]` |
| `target` | **no** | the `on <target>` suffix never appears |
| `stdout` / `stderr` | **no** | **TERM-UX08's "every step's output" clause is unmet** |

Two further gaps in the same family: `step_start` and `step_failed` are declared in
`src/audit/types.ts` (`AuditEventType`) but **never emitted anywhere in `src/`** — so a failed step
replays as `success`, and `execution_start` (`executor.ts:86`) is a plan-level envelope
(`{ planSummary, target, stepCount }`) with no `stepIndex`, which `buildReplayState` deliberately
skips so it cannot materialise as a phantom step with an empty command.

**Why deferred:** `src/execution/executor.ts` and `src/audit/` are outside 19.3-06's declared
`files_modified`, and widening an audit payload is a change to the persisted audit contract — it
touches the executor's tests and the `tests/e2e` DPEV-sequence assertions. That is a Rule 4
architectural change in another subsystem, not an in-task fix.

**Recommended action:** one small plan against `src/execution/executor.ts` — add
`risk`, `target`, `totalSteps`, `stdout`, `stderr` to the `step_complete` payload and emit a real
`step_failed` on the failure branch. No UI change is then required: the consumer and its tests
already exist. `tests/ui/app.test.tsx` → `reconstructs what the executor actually writes today —
command and status only` is the test to flip when it lands.

**Consequence for traceability:** TERM-UX08 stays `Planned`. Phase headers, timings and step
*commands* replay correctly; step *output* does not, and the requirement names it explicitly.

## App.tsx keyboard precedence blocks two D-03 gestures (discovered during 19.3-04, Task 1) — RESOLVED in 19.3-06

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

---

## Findings from the 19.3-04 live checkpoint run (2026-07-31)

The Task 2 human-verify run for 19.3-04 exercised the panel against a live Gemini backend and
surfaced four items. The checkpoint was **approved with documented partial coverage**; none of
these were fixed in 19.3-04.

### 0. The plan's own verify instruction cannot reach the Ink UI (documentation defect)

`19.3-04-PLAN.md` Task 2 step 2 suggests `node --import tsx src/index.ts debug "nginx 502"` (and
`node dist/cli.js debug "nginx 502"`). **Neither renders DPEVPanel.** `src/index.ts:114-118`:

```typescript
const args = process.argv.slice(2);
const isJsonMode = args.includes('--json');
const hasArgs = args.filter(a => a !== '--json').length > 0;

if (hasArgs || isJsonMode) {
  // One-shot / --json mode: bypass Ink, use Commander directly
```

Any CLI argument takes the one-shot Commander path and returns before `render(App)` at
`src/index.ts:129+`. The first checkpoint attempt showed no panel at all for this reason.

**Correct procedure — use for every future Ink verification checkpoint:** run `npm run dev` with
**no arguments**, then type `debug nginx 502` into the Ink prompt.

Not a code defect; the two-mode entrypoint is intentional. Recorded so no future phase's
`how-to-verify` block repeats the instruction.

### 1. Approval keystrokes leak into CommandInput (safety-relevant) — RESOLVED in 19.3-06

Pressing `n` at the `WRITE Execute "Execute this plan"? [Y/n]` prompt **both** answered the
approval **and** typed `n` into the command box — `❯ n_` was still visible after the session ended.
A following Enter would have submitted `n` as a command.

Evidence:
- `src/ui/App.tsx:404` mounts `<CommandInput isActive={!showStatusOverlay} />`, so `CommandInput`
  stays active straight through live sessions and approval gates.
- `src/ui/App.tsx:204` — `else if (input && !key.ctrl && !key.meta && !key.tab && !key.escape)
  setText(t => t + input)` swallows every printable character.

Same root cause as the `j`/`k` leak logged above, but it lands on the approval path, which makes it
safety-relevant rather than cosmetic. Note that `App.tsx` **already threads an `activeFocus` prop to
three panels** (`App.tsx:376`, `:382`, `:390`) — `CommandInput` is the only input consumer that does
not receive one, which confirms the fix shape recommended above.

**Owner:** Plan 06, bundled with the keyboard-arbitration work.

### 2. Session footer cost formatting contradicts the per-phase lines — RESOLVED in 19.3-06

`src/ui/panels/DPEVPanel.tsx:288` renders
`` `Session: ${totalTokens} tokens · $${totalCostUsd.toFixed(2)}` ``, producing a hard `$0.00` even
when every contributing phase correctly rendered `$–` because the provider omitted output tokens.
Observed live: phase lines read `in:554 · out:– · total:– · $–` while the footer claimed
`Session: 1044 tokens · $0.00`.

The footer asserts a real zero where the phase rows honestly admit the value is unknown — the exact
"empty zeros break trust" failure mode this phase exists to remove. The token total is genuine; only
the cost is misrepresented.

**Likely fix:** apply the same en-dash treatment as `formatUsageLine` — render `$–` when the summed
cost has no contributing non-null component. Needs a decision on how `session-usage.ts` distinguishes
"summed to zero" from "nothing to sum".

**Owner:** Plan 06 (inside `DPEVPanel.tsx`, but routed there by the coordinator so it ships in one
commit with its test).

### 3. Pipeline `console.log` corrupts the Ink render region

`[TRIAGE]` / `[ROUTING]` / `[DISCOVERY]` / `[NOISE]` / `[CONTEXT]` / `[DIAGNOSIS]` / `[PLANNING]`
lines are written with bare `console.log` to stdout while Ink owns the screen, appearing above the
panel box during a live session.

Sources: `src/orchestrator/pipeline.ts:174, 190, 212, 214, 220, 234, 571, 572, 579, 584, 840, 901,
903` and `src/orchestrator/diagnosis.ts:316, 334, 337`.

`DEV_MODE = process.env.NODE_ENV !== 'production'` is **on by default**, and several call sites
(`pipeline.ts:212, 214, 234, 571, 572, 579, 584`) are not even `DEV_MODE`-gated. This is
`19.3-RESEARCH.md` Pitfall 2; `src/index.ts:131` already works around it, but only for startup
messages.

Note this is distinct from the in-panel flicker check (checkpoint point 7), which **passed** — the
DPEVPanel render region itself had no ghost or duplicated lines.

**Owner:** out of scope for phase 19.3 entirely. Flagged as a **follow-up phase candidate** — route
pipeline diagnostics to a log file or an Ink-aware sink, and gate every call site consistently.

### Non-finding: the `⟁` glyph

`src/ui/components/DPEVPhaseHeader.tsx:85` emits `⟁` exactly as specified. The user's terminal
renders a font fallback. No action.
