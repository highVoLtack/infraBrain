# Phase 20: Audit Integrity — Research

**Researched:** 2026-07-31
**Domain:** Audit event producer semantics (internal codebase; no external technology)
**Confidence:** HIGH — every claim below is `[VERIFIED: codebase]` at file:line, or derived from the 319 real `audit.jsonl` files under `.infrabrain/`. No external documentation lookup was required: this phase installs no packages and introduces no unfamiliar technology.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**D-1. Old records are never rewritten or migrated — LOCKED**
Historical audit records stay exactly as they are, **including the flawed ones**. They are evidence of the past, and a past defect is part of that evidence. No backfill, no migration, no "correcting" a 2026-03 session to look like it was recorded under the new schema.
Consequence: readers must tolerate both shapes. A record without an attempt number is a pre-fix record — a legitimate state, not a parse error.

**D-2. Append-only from the fix onward, with attempt numbers — LOCKED**
From this phase forward the step log is append-only. Each attempt at a step appends its own event carrying an explicit attempt number. Nothing is overwritten, nothing is collapsed into a summary row.
**Producer invariant, no exceptions:** every step event written by the new producer carries `attempt_n`, **including attempt 1**. This is not a formatting preference. D-1 keeps two schema eras alive in the same log, and "no `attempt_n` ⇒ pre-fix record" is the only thing distinguishing them. A single new event without `attempt_n` collapses the discriminant and makes every pre-fix record indistinguishable from a new bug.
Test the **emitter**, not only sample payloads — a sample-based test cannot establish an exceptionless property.

**D-3. Status is derived exclusively from events — LOCKED**
A step's outcome is computed from the event sequence. Never stored as a standalone field, never inferred from the *absence* of an event. Absence of `step_failed` must not read as success. This is the root cause of the original defect and the rule preventing its return.
**Cardinality invariant:** exactly one terminal event per `(stepIndex, attempt_n)` pair, where terminal means `step_complete` or `step_failed`.

| Terminal events for a pair | Meaning |
|---|---|
| 1 | the only valid state |
| 0 | in-flight *if the session is still open*; **integrity violation** if the session has ended |
| 2+ | integrity violation, always |

The reader must **surface** violations as a distinct visible state, never resolve them into whichever outcome looks plausible. Interpreting ambiguity away is precisely how a failure came to render as a success; a rule that silently repairs its own violations cannot be relied upon.

**D-4. The red proof is an artifact — LOCKED**
The closing regression test must fail against the current producer, and **that failure must be recorded**: either a RED commit carrying the failing test before the fix, or the failing run's output persisted into the phase directory.
A regression test that passes on the broken code is testing the wrong thing. And "it was red first" that exists only in a summary is narration — in two weeks it is indistinguishable from a test that was never red.

### Claude's Discretion

- Exact payload field names and event schema shape.
- Whether `attempt_n` lives at the top level or inside a metadata object.
- How the reader represents an integrity violation internally, so long as it is visible and distinct.
- Test file organisation.

### Deferred Ideas (OUT OF SCOPE)

- Migrating or backfilling historical records — explicitly rejected, see D-1.
- The five March multi-fault regression scenarios — Phase 21.
- Rollback reversibility redesign — Phase 22, consumes these records.
- Everything else in the hardening dossier: structured output (A), pipeline logging (B), type drift (C), test hygiene (D), StreamingText keys (E), two-mode entrypoint (F), vector-DB consolidation (K).
</user_constraints>

---

## Summary

The defect is exactly as briefed and the fix is entirely producer-side, but the change set is **wider than the three files named in the brief**. `src/execution/executor.ts` cannot satisfy acceptance criterion 2 ("`step_failed` on *every* failing attempt") alone, because the two retry loops that generate attempts 2..N both swallow their per-attempt results: `CircuitBreaker.execute` (`src/execution/circuit-breaker.ts:24-58`) returns only the final `RunResult`, and `selfHealStep` (`src/execution/self-healer.ts:325-528`) returns only an `attempts[]` array after the fact. Per-attempt emission at the true moment of the attempt requires a callback into the circuit breaker and emission from inside the self-healer.

Three findings materially change the shape of the fix and were not visible from the brief:

1. **`attempt_n` must live inside `metadata`, not at the top level.** `WriteThrough.appendAudit` (`src/state/store.ts:185-209`) writes the whole entry to `audit.jsonl` but then inserts into SQLite with an explicit column list. `queryAuditLog` (`src/state/store.ts:171-182`) reconstructs entries from those columns only. Replay reads SQLite via `GET /history` (`src/api/routes/history.ts:47` → `src/ui/App.tsx:393`). A new top-level `AuditEntry` field would therefore survive in the JSONL and be **silently dropped on the exact path replay uses**. `metadata` is round-tripped whole (`store.ts:207` / `store.ts:181`).

2. **`self_heal_attempt` carries no `stepIndex`** (`src/execution/self-healer.ts:382,422,445,464`; confirmed across all 98 historical records — its metadata keys are `attempt, originalCommand, correctedCommand, outcome, stderr, exitCode, errorTypeChanged, reason` and nothing else). It cannot be attributed to a step today. It is therefore not a competing outcome record at all, which settles the Q1 trap cleanly.

3. **Replay truncates at 20 events.** `queryAuditLog` defaults `limit = 20` (`src/state/store.ts:165`) and `App.tsx:393` sends no `limit` param. Adding `step_start` + per-attempt `step_failed` roughly triples per-session event volume, so replay will start losing the *oldest* events (the early steps) on sessions that render correctly today. This is the highest-severity side effect of the fix and it must be addressed in this phase.

**Primary recommendation:** introduce a dedicated, *required-field* typed emitter `AuditLogger.logStepEvent(type, payload)` and narrow `logExecution` to `Exclude<AuditEventType, StepEventType>` so the compiler makes `attempt_n` unforgettable; emit `step_start`/`step_failed` per attempt from the executor, the circuit breaker (via a new `onAttempt` callback), and the self-healer (at its four existing `self_heal_attempt` sites); keep `self_heal_attempt` as a non-authoritative *rationale* record and give it a `stepIndex`/`attempt_n` join key; and derive status in a new pure module `src/audit/step-status.ts` that never reads `self_heal_attempt`.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Step attempt lifecycle events | Execution engine (`src/execution/executor.ts`) | — | Owns the step loop; only it knows `stepIndex`, `target`, `totalSteps` |
| Per-retry attempt events (CB path) | `src/execution/circuit-breaker.ts` | executor (supplies callback) | Retries happen inside the breaker; executor cannot observe them |
| Per-retry attempt events (self-heal path) | `src/execution/self-healer.ts` | executor (supplies context) | Retries happen inside the heal loop; already the `self_heal_attempt` emission site |
| Event schema + required-field enforcement | `src/audit/types.ts` + `src/audit/logger.ts` | TypeScript compiler | Type-level invariant beats a runtime test |
| Durable append | `src/state/store.ts:185` (`appendAudit`) | SQLite `audit_log` | Already append-only; no change needed to write mechanics |
| Status derivation (D-3) | **New** `src/audit/step-status.ts` (pure) | — | Must be a new module: the existing consumers are frozen by criterion 8 |
| Replay rendering | `src/ui/App.tsx` — **FROZEN** | — | Criterion 8: not modified |
| CLI history rendering | `src/cli/formatter.ts` — **FROZEN** | — | Criterion 8: not modified |

---

## Q1 — The `self_heal_attempt` overlap (THE PRIMARY QUESTION)

### What `self_heal_attempt` actually is

`[VERIFIED: codebase]` Four emission sites, all inside `selfHealStep`:

| Site | Trigger | `outcome` value |
|---|---|---|
| `src/execution/self-healer.ts:382` | corrected command rejected by the safety pipeline | `blocked_by_safety` |
| `src/execution/self-healer.ts:422` | command exited 0 but the read-only effect check failed | `effect_unverified` |
| `src/execution/self-healer.ts:445` | corrected command succeeded | `success` |
| `src/execution/self-healer.ts:464` | corrected command failed | `failed` |

Payload: `{ attempt, originalCommand, correctedCommand, outcome, stderr?, exitCode?, errorTypeChanged?, reason? }`.

`[VERIFIED: real audit data — 98 records across .infrabrain/sessions]` metadata key frequencies:
`attempt` 98, `originalCommand` 98, `correctedCommand` 98, `outcome` 98, `stderr` 43, `exitCode` 43, `errorTypeChanged` 34, `reason` 40. **`stepIndex` appears 0 times.**

Two consequences follow immediately:

- **`self_heal_attempt` cannot be attributed to a step.** It has no `stepIndex` and no consumer joins it to one. A multi-step plan that self-heals on steps 0 and 2 leaves an undifferentiated stream of `self_heal_attempt` events. It is therefore *not* a per-step attempt record and never has been.
- **Its `attempt` field is loop-local, not global.** `attempts.length + 1` (`self-healer.ts:383,423,446,465`) counts iterations of the heal loop only. The executor's own first execution (`executor.ts:172-185`) is not in that count. So `self_heal_attempt.attempt === 1` denotes the *second* attempt at the step. Reusing this number as `attempt_n` would silently off-by-one the entire new schema.

### Recommendation: **(c) both coexist, with a declared and mechanically-enforced division of responsibility**

| Family | Owns | Never used for |
|---|---|---|
| `step_start` / `step_complete` / `step_failed` | **The canonical outcome record.** One `step_start` per attempt; exactly one terminal event per `(stepIndex, attempt_n)`. This is the *sole* input to status derivation. | — |
| `self_heal_attempt` | **The LLM-correction rationale record.** What the model was given, what it produced, whether safety blocked it, whether the error type shifted (`errorTypeChanged`). | Status. Ever. |

**Required change to `self_heal_attempt`:** add `stepIndex` and `attempt_n` to its payload so it can be joined to the step event it explains. This is purely additive, touches no consumer (`self_heal_attempt` has no `case` in `src/cli/formatter.ts` — it falls through to `default` at line 364 — and is ignored by `buildReplayState`), and is the single highest-value change to that family.

**Do not remove `outcome`/`stderr`/`exitCode` from `self_heal_attempt`.** Removing them is a behaviour change with no consumer benefit and unknown blast radius, and it would not eliminate the trap anyway.

**The anti-duplication guarantee is a precedence rule made mechanical, not a field-level deletion.** The trap named in the brief is *two sources of truth for status*, not two records that mention the same command. Enforce the rule with a test: construct a synthetic trail in which `self_heal_attempt` says `outcome: 'success'` while the step family says the attempt failed, and assert the deriver reports **failed**. That test is what makes the division real.

### Why not the alternatives

**(a) Supersede — delete/stop emitting `self_heal_attempt`.** Rejected on three grounds:
- It carries `blocked_by_safety` and `effect_unverified` outcomes plus `errorTypeChanged`, none of which have a home in a step-outcome vocabulary without bloating it back into the ambiguous fat event this phase exists to abolish.
- 98 historical records exist under D-1 and must keep parsing; removing the type from `AuditEventType` would break the historical reader that criterion 7 requires.
- `self_heal_progress` (13 records) references the same loop and would be orphaned.
- **Migration/compatibility consequence:** breaks criterion 7 outright. Non-viable.

**(b) Fold `self_heal_attempt` into the step-event family.** Rejected: it changes the *meaning* of a type that already has 98 records recorded under a different meaning, which is the D-1 violation D-1 was written to prevent — old records would become indistinguishable from a new bug in exactly the way D-2 warns about. **Migration/compatibility consequence:** every existing `self_heal_attempt` record would need reinterpretation under a schema it was never written to, i.e. a de-facto backfill by the reader. Directly contradicts D-1.

**(c) Coexist — RECOMMENDED. Migration/compatibility consequence:** none. Pre-fix records keep both families with their original semantics and no `attempt_n`; post-fix records gain the discriminant. The two eras are separable by exactly the rule D-2 specifies. Additive only.

---

## Q2 — Where exactly the emissions go

All line numbers refer to `src/execution/executor.ts` as it stands at the start of this phase.

### Attempt-number scheme (global, 1-based, per step)

`attempt_n = 1` is the executor's own first execution at lines 172-185. Retry loops continue the same counter. Every step event in the step therefore uses one shared, monotonically increasing numbering.

### Executor sites

| # | Insert at | Event | `attempt_n` | Notes |
|---|---|---|---|---|
| 1 | immediately before line 173 (`// e. Execute command (first attempt)`), i.e. after the shell-mode warning at 168-170 | `step_start` | `1` | **After** the approval gate (156-165) and the budget gate (123-147) — a rejected or unaffordable step made no attempt and must produce no `step_start`. |
| 2 | first statement inside the block opened at line 192 (`if (firstResult.exitCode !== 0 && hasSelfHealingDeps)`), before line 195 | `step_failed` | `1` | Records attempt 1's failure **before** the self-healer runs. |
| 3 | first statement inside the block opened at line 290 (`else if (firstResult.exitCode !== 0)`), before line 292 | `step_failed` | `1` | Same, for the circuit-breaker path. |
| 4 | line 341 (existing `step_complete`) | `step_complete` | see below | Enrich payload; compute `attempt_n`. |

`attempt_n` for the terminal `step_complete` at line 341:
- no failure occurred → `1`
- self-heal rescued the step → `1 + healResult.attempts.length` — the successful iteration is itself pushed onto `attempts` at `self-healer.ts:451`, so this is exact.
- circuit breaker rescued the step → the executor must track it. Recommend a per-step mutable counter (`let attemptN = 1`) incremented by the `onAttempt` callback in site 6 below; no change to `CircuitBreakerResult`'s shape is needed.

### Circuit-breaker site

| # | File | Change |
|---|---|---|
| 5 | `src/execution/circuit-breaker.ts:19-24` | Add an **optional** parameter `onAttempt?: (attemptNumber: number, result: RunResult) => void` to `CircuitBreaker.execute`. Optional keeps `tests/execution/circuit-breaker.test.ts` compiling untouched. |
| 6 | `src/execution/circuit-breaker.ts:27-30` | Inside the `while` loop: invoke `onAttempt` for the *start* of each attempt (before `await fn()`) and again after a non-zero exit. The executor's callback emits `step_start` / `step_failed` with the running `attempt_n`. |

Rationale: the breaker's attempts (up to `maxRetries`, `executor.ts:94`) are invisible to the executor — `execute` returns only `{ status, result }`. Without this callback, criterion 2 cannot be met on the fallback path.

### Self-healer sites

The four existing `self_heal_attempt` emissions are exactly the right places, because they already fire at the true moment of each attempt.

| # | File:line | Emit |
|---|---|---|
| 7 | `src/execution/self-healer.ts` — after the budget guard at 342-344, before the LLM call at 366 | `step_start`, `attempt_n = base + attempts.length + 1` |
| 8 | `src/execution/self-healer.ts:382` (safety-blocked) | `step_failed`, `failure_kind: 'safety_blocked'` |
| 9 | `src/execution/self-healer.ts:422` (effect unverified) | `step_failed`, `failure_kind: 'effect_unverified'` |
| 10 | `src/execution/self-healer.ts:464` (command failed) | `step_failed`, `failure_kind: 'command_failed'` |
| 11 | `src/execution/self-healer.ts:445` (success) | **nothing.** The executor emits the terminal `step_complete` at line 341. Emitting here too would create two terminal events for the same pair — a self-inflicted D-3 violation. |

To do this, `SelfHealContext` (`src/execution/types.ts:88-105`) must gain `stepIndex`, `totalSteps`, `target`, and an `attemptBase` (always `1`). `stepRisk` and `stepDescription` are already present (`types.ts:101`, `types.ts:98`). The executor already constructs `healContext` twice — `executor.ts:211-229` and `executor.ts:374-392` — **both must be updated**; the second (the persistence-verification re-execution path) is easy to miss.

### Do NOT emit a step-level terminal `step_failed` at the halt sites

`executor.ts:252` (`self_heal_exhausted`) and `executor.ts:310` (`circuit_breaker_triggered`) are step-level halt markers, not attempt terminals. The last failing attempt has already emitted its own `step_failed`. Adding another would produce two terminal events for that `(stepIndex, attempt_n)` pair. Leave both events as they are — they already carry `stepIndex` and are ignored by `buildReplayState` (`App.tsx:200` matches only `execution_start`/`step_complete`/`step_failed`), so replay is unaffected.

### Ordering relative to rollback

`rollbackStep` is called at `executor.ts:242` and `executor.ts:304` and emits `rollback_start`/`rollback_complete`/`rollback_failed` through the same logger (`src/execution/rollback.ts`). The failing attempt's `step_failed` is emitted at sites 8-10 / 6, i.e. *inside* the retry loops and therefore strictly before the rollback. Verify this ordering explicitly — a trail reading "rollback started, then the step failed" is causally inverted and worthless as evidence.

### Interaction with `budget.deduct`

`[VERIFIED: codebase]` Budget accounting today:

| Path | Deduction | Site |
|---|---|---|
| step success | `budget.deduct(cost)` | `executor.ts:339`, immediately before the `step_complete` emission |
| CB retry failure | `budget.deductFailedRetry(risk)` — double cost (`damage-budget.ts:25-28`) | `circuit-breaker.ts`, per failed attempt |
| self-heal attempt | `budget.deduct(cost)` | `self-healer.ts:381` (safety-blocked) and `self-healer.ts:414` (executed) |
| **attempt 1's failure** | **none** | not charged on either path |

**Audit emission must be side-effect free.** Do not "fix" the uncharged attempt-1 failure while adding events — that is a damage-budget behaviour change outside this phase's scope and would alter halt timing in existing tests. Note it for the dossier and move on.

The one ordering constraint that matters: `budget.deduct(cost)` at line 339 must stay *before* the `step_complete` emission so that a future payload extension can report post-deduction budget state consistently. Keep the current order.

---

## Q3 — Payload contract (derived from the frozen consumers)

Derived by reading `buildReplayState` (`src/ui/App.tsx:200-247`) and `summarizeAuditEntry` (`src/cli/formatter.ts:298-367`). **No consumer change is required.**

### The contract

| Field | Type | Read by | Required? | Value at emission site |
|---|---|---|---|---|
| `stepIndex` | `number` | `App.tsx:204` (**guard — entry is dropped without it**), `App.tsx:206` | **mandatory** | loop variable `i`, `executor.ts:102` |
| `attempt_n` | `number` | no consumer (D-2 schema discriminant) | **mandatory** | computed, see Q2 |
| `totalSteps` | `number` | `App.tsx:212` → `StepState.total` | mandatory for criterion 4 | `plan.steps.length`, in scope at `executor.ts:102` |
| `command` | `string` | `App.tsx:209`; `formatter.ts:303,309` | mandatory | `commandUsed` (`executor.ts:189`), or `step.command`, or the corrected command in the heal loop |
| `risk` | `string` | `App.tsx:210` → the risk badge | mandatory for criterion 4 | `step.risk` — `'read' \| 'write' \| 'destructive'`, `executor.ts:112`; `context.stepRisk` in the self-healer (`types.ts:101`) |
| `target` | `string` | `App.tsx:211` | mandatory for criterion 4 | `target`, the second parameter of `executePlan` (`executor.ts:31`); must be threaded into `SelfHealContext` |
| `stdout` | `string` | `App.tsx:213` | on terminal events | `finalResult.stdout` / `runResult.stdout` |
| `stderr` | `string` | `App.tsx:214` | on `step_failed` | `firstResult.stderr` / `runResult.stderr` |
| `exitCode` | `number` | `formatter.ts:304-305` | on `step_complete` | `finalResult.exitCode` — already emitted today (`executor.ts:344`) |
| `error` | `string` | `formatter.ts:310` — falls back to the literal `'unknown error'` if absent | **on `step_failed`** | first line of `stderr`, or `validation.reason` for safety-blocked, or `verification.reason` for effect-unverified |
| `failure_kind` | enum | no consumer (forward-looking; Phase 22 §H reads these records) | on `step_failed` | see Q2 |

### Verified consumer behaviours that constrain the contract

- **`stepIndex` is a hard gate.** `App.tsx:204`: `if (!meta || typeof meta.stepIndex !== 'number') continue;` — an event without a numeric `stepIndex` is silently discarded from replay. Every step event must carry it.
- **`step_start` is NOT read by `buildReplayState`.** Line 200 matches `execution_start`, `step_complete`, `step_failed` only. `step_start` is written for the record (D-2/D-3 in-flight detection) and correctly ignored by replay. **This is why `risk`/`target`/`totalSteps` must also appear on `step_complete`/`step_failed`, not only on `step_start`.** Putting them only on `step_start` would satisfy the letter of criterion 4 and fail it in practice.
- **Merge is last-event-wins per `stepIndex`, non-erasing per field** (`App.tsx:221-234`). A rescued step emitting `step_failed(1) → step_complete(2)` therefore renders as `success` with the attempt history living in the event stream. Correct — and the reason ordering matters (see Pitfall 1).
- **`formatter.ts:393` counts `step_complete` occurrences** for the DPEV summary. Exactly one `step_complete` per step is emitted (the loop advances after success), so the count stays accurate. Emitting `step_complete` per attempt would inflate it — a second reason site 11 above must emit nothing.
- **`formatter.ts:310`** reads `meta?.error`, not `stderr`. `step_failed` must carry **both** `error` (for the CLI) and `stderr` (for replay).
- **`tests/e2e/helpers/assert-dpev-sequence.ts:12-19`** maps only `skill_selection`/`decision`/`execution_start`/`step_complete`/`execution_complete`/`verification`. `step_start` and `step_failed` are filtered out at line 40, so the new events do not disturb DPEV phase-ordering assertions.

**Consumer-change verdict:** none required. The contract above is fully satisfiable from values already in scope at every emission site. `[VERIFIED: codebase]`

---

## Q4 — `attempt_n` placement and the type-level guarantee

### Placement: **inside `metadata`. Not negotiable.**

`[VERIFIED: codebase]` `appendAudit` (`src/state/store.ts:185-209`) does two writes:

```
appendFileSync(join(sessionDir,'audit.jsonl'), JSON.stringify(entry) + '\n')   // whole entry
INSERT INTO audit_log (session_id, timestamp, event_type, risk_level, command,
                       decision, reasoning, diff_before, diff_after, metadata)  // fixed columns
```

`queryAuditLog` (`store.ts:171-182`) rebuilds entries from those columns and `JSON.parse`s `metadata`. Replay fetches `GET /history` (`src/ui/App.tsx:393`) → `store.queryAuditLog` (`src/api/routes/history.ts:47`) → SQLite.

A new **top-level** `AuditEntry.attempt_n` would be written to `audit.jsonl` and then **silently dropped by the SQLite round-trip that replay actually uses** — present in the file, absent in the UI, with no error anywhere. That is a worse failure mode than the one this phase is fixing. `metadata` is serialized whole (`store.ts:207`) and parsed whole (`store.ts:181`), so it survives both paths.

Discretion granted by CONTEXT.md is therefore resolved by a hard constraint: **`metadata.attempt_n`**.

### Type-level guarantee: **yes, fully achievable**

Today `logExecution` is `(eventType: AuditEventType, details: Record<string, unknown>) => void` (`src/audit/logger.ts:72`) — it accepts any event with any payload. Nothing prevents a future contributor from emitting a step event without `attempt_n`.

Recommended shape:

```ts
// src/audit/types.ts
export type StepEventType = 'step_start' | 'step_complete' | 'step_failed';

export interface StepEventPayload {
  stepIndex: number;
  attempt_n: number;      // required — no `?`
  totalSteps: number;
  command: string;
  risk: string;
  target: string;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  error?: string;
  failure_kind?: 'command_failed' | 'safety_blocked' | 'effect_unverified';
}
```

```ts
// src/audit/logger.ts
logStepEvent(eventType: StepEventType, payload: StepEventPayload): void {
  this.log({ eventType, metadata: { ...payload } });
}

// narrowed — step events can no longer be emitted through the untyped door
logExecution(eventType: Exclude<AuditEventType, StepEventType>,
             details: Record<string, unknown>): void { … }
```

**The `Exclude` narrowing is what makes the invariant unforgettable.** Without it, `logStepEvent` is a nudge; with it there is no compiling path to a step event that lacks `attempt_n`. `[VERIFIED: codebase]` the narrowing is safe today — `executor.ts:341` is the only call site in `src/` passing a step event to `logExecution` (grep across `src/`: 9 files call `logExecution`; none of the other 25 call sites passes a step type).

**Blast radius the planner must budget for:** `logExecution` is declared *structurally* in two dependency shapes, not imported from the class:
- `ExecutionDeps.auditLogger` — `src/execution/types.ts:42-44`
- `SelfHealContext.auditLogger` — `src/execution/types.ts:95-97`

Both must gain `logStepEvent`. Consequently **18 mock construction sites across 13 test files** (`grep -c "logExecution: vi.fn()"`) must add `logStepEvent: vi.fn()`. Several cast with `as unknown as ExecutionDeps['auditLogger']` (e.g. `tests/execution/executor.test.ts:69-72`), so they will **compile fine and throw at runtime** — the compiler will not find these for you. Enumerate them mechanically:

```
tests/execution/{executor,self-healer,self-healer-integration,rollback,resume,rolling-context-injection}.test.ts
tests/api/{routes,resume,stream-debug,stream-execute,rolling-context-routes}.test.ts
tests/e2e/postgres-loop-guard.test.ts
tests/orchestrator/pipeline.test.ts
```

**Belt and braces.** Add a runtime guard in `logStepEvent` that throws if `attempt_n` is not a finite number ≥ 1. It costs one line and catches the `as unknown as` escape hatches and any JS-side caller. D-2 says "test the emitter, not only sample payloads" — the type + the guard + the property test in the Validation Architecture section together constitute that.

---

## Q5 — Terminal-event cardinality and knowing whether a session is open

### Recommended reader

A **new** pure module — `src/audit/step-status.ts` — so criterion 8 is untouched. It consumes `AuditEntry[]` for one session and returns per-`(stepIndex, attempt_n)` state.

```ts
export type AttemptState =
  | 'succeeded'             // exactly one step_complete
  | 'failed'                // exactly one step_failed
  | 'in_flight'             // zero terminals, session demonstrably open
  | 'indeterminate'         // zero terminals, session state unknowable
  | 'integrity_violation';  // zero terminals with session closed, or 2+ terminals

export type StepSchemaEra = 'pre_fix' | 'post_fix';
```

Rules, in order:
1. **Era first.** A step event whose `metadata.attempt_n` is not a number is a **pre-fix** record (D-1). Bucket it under `era: 'pre_fix'` and **do not apply the cardinality invariant** — pre-fix records have no attempt key and `step_failed` was never emitted, so the invariant is meaningless there and applying it would flag all 123 historical `step_complete` records as violations. Return their status as recorded, marked `pre_fix`, and never reinterpret.
2. Group post-fix events by `${stepIndex}:${attempt_n}`.
3. Count terminals (`step_complete` + `step_failed`) per key.
   - `1` → `succeeded` / `failed`.
   - `2+` → `integrity_violation`, **always**, regardless of what the events say. Carry the conflicting events in the result so the violation is inspectable rather than merely flagged.
   - `0` → session-open test below.
4. **Never** infer status from absence. There is no code path in which "no `step_failed` was seen" yields `succeeded`. Assert this directly (criterion 5).
5. **Never** read `self_heal_attempt` for status (the Q1 precedence rule, made mechanical).

The step-level roll-up is the state of the **highest** `attempt_n` for that `stepIndex`, with the lower attempts retained as the attempt history. If any attempt for a step is `integrity_violation`, the step is `integrity_violation` — a violation must never be absorbed by a later plausible-looking outcome (D-3).

### Is "the session is still open" knowable from the log?

**Partially — and the residual gap must be surfaced, not guessed.** `[VERIFIED: codebase + 319 real audit.jsonl files]`

| Marker | Emitted where | Reliability |
|---|---|---|
| `execution_complete` | `src/api/routes/execute.ts:171` — **unconditional**, after `executePlan` returns, on every outcome including `halted`; carries `metadata.status` | strongest signal |
| `execution_complete` | `src/execution/executor.ts:452` — **success path only**; not reached on the four early `return` statements at lines 54/67/140/281/326 | supplementary |
| `lock_released` | `src/execution/executor.ts:463` — inside the `finally` block, so it fires on halts and throws | strong, but only if the lock was acquired (`lockAcquired`, line 461) |
| `session_end` | **nowhere** — declared at `src/audit/types.ts:8` and never emitted. `session_start` likewise (`types.ts:7`). | unusable |

Measured across the 55 real sessions containing `execution_start`:

| Marker set | Sessions covered |
|---|---|
| `execution_complete` | 51 / 55 |
| `lock_released` | 50 / 55 |
| **union of `execution_complete` ∨ `lock_released` ∨ `session_end`** | **54 / 55 (98.2%)** |
| no marker at all | 1 (`019cf190-e3e9-70f8-b2da-05466e91944f`) |

**Recommendation:** treat a session as **closed** if any of `execution_complete`, `session_end`, or `lock_released` is present. If none is present, the session is **neither** open nor closed — return `indeterminate`, a fourth visible state. Do **not** default to `in_flight` (that silently forgives a crashed run) and do **not** default to `integrity_violation` (that would slander the one legitimately-unknowable session). Guessing either way is the exact failure mode D-3 forbids.

`[ASSUMED]` Optional, not required by any criterion: emitting `session_end` would close this 1.8% gap permanently and cost one line. It is arguably outside "producer side, step events" scope — flag it to the owner rather than doing it silently.

---

## Q6 — Driving a genuine step failure in a test

`[VERIFIED: codebase]` The executor's tests already simulate failure cleanly, with no live infrastructure. `tests/execution/executor.test.ts:1-53` mocks the lock manager, snapshot, rollback, self-healer, persistence-verification, and chalk; `makeDeps()` (lines 63-89) supplies an injectable `runner` and an `auditLogger` spy.

### Pattern A — circuit-breaker failure (no LLM, fully deterministic) — **use this for the criterion-9 regression test**

`tests/execution/executor.test.ts:164-186` and `405-426` show the exact recipe: build deps **without** `correctionModel`/`skill`, mock the runner to always fail.

```ts
const deps = makeDeps({
  runner: { run: vi.fn<() => Promise<RunResult>>()
    .mockResolvedValue({ stdout: '', stderr: 'fail', exitCode: 1 }) },
});
const result = await executePlan(plan, 'nginx', deps);
expect(result.status).toBe('halted');
expect(result.reason).toBe('circuit_breaker');
```

`config.circuitBreaker = { maxRetries: 3, retryDelayMs: 0 }` (`executor.test.ts:80`) — zero delay, so the test is fast. This drives four genuine failing attempts (1 executor + 3 breaker retries) with no LLM and no Docker.

### Pattern B — self-heal exhausted

`tests/execution/executor.test.ts:428-464`: `makeSelfHealDeps()` adds a mock `correctionModel` + `skill`, and `vi.mocked(selfHealStep).mockResolvedValue({ status: 'exhausted', attempts: [...] })`. Note that `selfHealStep` is module-mocked (`executor.test.ts:27-31`), so it emits nothing — **a test of criterion 2 on the self-heal path must use the real `selfHealStep`** (see `tests/execution/self-healer.test.ts`, which mocks only `generateText` from the `ai` package) or assert on a self-healer-level spy instead.

### Recommended shape for the criterion-9 regression test

The strongest form is a **producer → consumer round trip in a single test**, which is exactly what makes it red today:

1. Run `executePlan` with Pattern A and a capturing `auditLogger` (collect `{eventType, metadata}` from both `logExecution` and `logStepEvent`).
2. Shape those calls into `AuditEntry`-like records.
3. Feed them to `buildReplayState(sessionId, entries)` — imported from `src/ui/App.tsx`, already done at `tests/ui/app.test.tsx:14`, no consumer modification.
4. Assert `executionSteps[0].status === 'failed'`, `stderr` present, `risk` non-empty, `total === plan.steps.length`.
5. Assert the emitted trail contains a `step_failed` for **each** of `attempt_n` 1..4.

**Why it is red today:** the current producer emits no step event at all on the circuit-breaker path (`executor.ts:303-333` returns before reaching line 341), so `buildReplayState` yields `executionSteps.length === 0` and step 4 fails on `undefined`. That is a clean, unambiguous RED — capture it for D-4.

The test to flip is `tests/ui/app.test.tsx:281` (`reconstructs what the executor actually writes today`), whose own comment at lines 282-288 instructs exactly this.

### Criterion 7 fixture — historical session

`[VERIFIED: real data]` Good candidates already on disk:

| Path | Events | Contains |
|---|---|---|
| `.infrabrain/sessions/019ced00-7fb2-77c2-b876-1c1752feb0dc/audit.jsonl` | 15 | `step_complete` + `circuit_breaker_triggered` + `execution_complete` — a pre-fix session where a step genuinely failed |
| `.infrabrain/sessions/019cee43-e7b3-7095-9a76-a6972cf208a9/audit.jsonl` | 29 | `step_complete` + `self_heal_attempt` + `self_heal_exhausted` + `self_heal_progress` |

**`.infrabrain/` is gitignored** (`.gitignore:3`) and no file under it is tracked. The chosen fixture must be **copied into `tests/fixtures/audit/` and committed**, or the test is unreproducible on any other machine and will silently pass-by-absence in CI. `tests/fixtures/` already exists (`logs/`, `skills/`). Review the copied JSONL for hostnames/paths before committing — the gitleaks pre-commit hook will scan it.

---

## Q7 — Append-only mechanics

`[VERIFIED: codebase]` **Appends are already the mechanism, and nothing overwrites or rewrites an audit record.**

- `WriteThrough.appendAudit` (`src/state/store.ts:185-209`) is the single write path. It uses `appendFileSync(join(sessionDir,'audit.jsonl'), JSON.stringify(entry) + '\n')` followed by an `INSERT INTO audit_log`.
- `AuditLogger.log` (`src/audit/logger.ts:79-86`) is `private` and is the only caller. Every public method funnels through it. There is no update, delete, truncate, or rewrite anywhere in `src/audit/` or against `audit_log`.
- `logExecution` (`logger.ts:72-77`) always creates a fresh entry with a fresh `new Date().toISOString()` timestamp (`logger.ts:82`).

**Nothing to change for D-2's append-only requirement.** The current step-level defect is one of *omission* — events that were never written — not of overwriting. D-2's real work is the per-attempt granularity and `attempt_n`, not the write mechanics.

**Two write-path caveats the planner should know:**

1. `appendFileSync` has no `mkdir` guard — the session dir must already exist. It does in every current path; do not introduce an emission before session-dir creation.
2. Timestamp resolution is milliseconds and is **not monotonic**. Two synchronous emissions in the same tick receive identical timestamps. See Pitfall 1 — this becomes load-bearing once two step events for the same `stepIndex` can be adjacent.

---

## Pitfalls

Ordered by severity for an implementer.

### 1. HIGH — `step_failed` and `step_complete` in the same millisecond invert the replay status

`buildReplayState` sorts entries by timestamp ASC (`App.tsx:115-119`) using `Array.prototype.sort`, which is **stable**. `queryAuditLog` returns rows `ORDER BY timestamp DESC` (`src/state/store.ts:168`). For two events with identical ISO-ms timestamps, the stable sort leaves them in their arrival order — which is **DESC**. A step rescued on attempt 2 emits `step_failed(1)` then `step_complete(2)`; if both land in the same millisecond, replay iterates `step_complete` → `step_failed`, last-wins (`App.tsx:225`), and renders a **successful step as failed**. The mirror image of the bug this phase fixes.

Reachable in tests today: `retryDelayMs: 0` (`executor.test.ts:80`) plus a mocked runner that resolves instantly.

Mitigation is producer-side only (criterion 8 freezes the consumer): make the timestamp in `AuditLogger.log` (`src/audit/logger.ts:82`) monotonic per logger instance — if the new value is `<=` the previous, use `previous + 1ms`. `src/audit/logger.ts` is explicitly in scope. A `seq` field would be cleaner but is useless here: no consumer sorts by it, and adding one is a consumer change.

### 2. HIGH — replay silently truncates at 20 events, and this fix triples event volume

`queryAuditLog` defaults `limit = 20` (`src/state/store.ts:165`); `App.tsx:393` sends no `limit`; `src/api/routes/history.ts:44` only forwards a limit if the query param is present. Because the query is `ORDER BY timestamp DESC LIMIT 20`, the **oldest** events are dropped — i.e. the early steps.

Today a typical session writes ~15-30 events. Adding `step_start` per attempt and `step_failed` per failing attempt roughly triples that. Sessions that replay correctly today will start losing step 0. **The fix would visibly degrade replay while claiming to repair it.**

`App.tsx` and `formatter.ts` are frozen, but `src/state/store.ts` and `src/api/routes/history.ts` are not named in criterion 8. Recommended: in `src/api/routes/history.ts`, when a `session` filter is present and no explicit `limit` was supplied, pass a session-scoped default (e.g. 1000) — a single-session query is bounded by definition. Add a test with >20 events asserting step 0 still reaches `buildReplayState`.

### 3. HIGH — reusing `self_heal_attempt.attempt` as `attempt_n` off-by-ones the whole schema

`self-healer.ts:383,423,446,465` compute `attempts.length + 1`, counting only heal-loop iterations. The executor's own first execution (`executor.ts:172-185`) is not counted. `self_heal_attempt.attempt === 1` is globally attempt **2**. Keep the two numbers separate; add `attempt_n` alongside the existing `attempt` rather than renaming it.

### 4. MEDIUM — emitting a step-level `step_failed` at the halt sites creates a self-inflicted D-3 violation

The last failing attempt already emitted its terminal `step_failed`. Adding another at `executor.ts:252`/`executor.ts:310` yields two terminal events for one `(stepIndex, attempt_n)` — the reader will correctly flag the producer as violating its own invariant. See Q2.

### 5. MEDIUM — the second `healContext` construction is easy to miss

`executor.ts:211-229` and `executor.ts:374-392` build near-identical `SelfHealContext` objects. The second feeds the post-restart persistence-verification re-execution (`executor.ts:394-433`). If only the first gains `stepIndex`/`totalSteps`/`target`, persistence-fix attempts emit step events with `stepIndex: undefined` — and `App.tsx:204` **silently discards** them. Symptom: nothing. Silent loss.

### 6. MEDIUM — 18 test mocks will throw at runtime while type-checking clean

`grep -c "logExecution: vi.fn()" tests` → 18 across 13 files. Several cast via `as unknown as ExecutionDeps['auditLogger']` (e.g. `executor.test.ts:69-72`), defeating the compiler. Adding `logStepEvent` to the structural types will not surface these; only running the suite will. Update all 18 in the same commit as the type change.

### 7. MEDIUM — `src/execution/self-healer.ts` is NOT tsc-clean

The phase constraints state `src/execution/executor.ts` carries none of the 8 pre-existing errors. Verified true. But the recommended change set includes `self-healer.ts`, which carries **2 of the 8** (`self-healer.ts:252` and `self-healer.ts:369`, both `TS2353: 'maxTokens' does not exist` — AI SDK v6 drift, dossier §C). Its file-scoped gate must be a **baseline diff (exactly these 2 errors, unchanged)**, not zero. Full breakdown from `npx tsc --noEmit`:

| File | Pre-existing errors | In recommended change set? |
|---|---|---|
| `src/config/types.ts` | 4 | no |
| `src/execution/self-healer.ts` | **2** | **yes** |
| `src/cache/lance-store.ts` | 1 | no |
| `src/memory/incident-store.ts` | 1 | no |
| `src/execution/executor.ts` | 0 | yes — clean gate |
| `src/audit/types.ts` | 0 | yes — clean gate |
| `src/audit/logger.ts` | 0 | yes — clean gate |
| `src/execution/circuit-breaker.ts` | 0 | yes — clean gate |
| `src/execution/types.ts` | 0 | yes — clean gate |
| `src/state/store.ts` | 0 | yes — clean gate |
| `src/api/routes/history.ts` | 0 | yes — clean gate |

### 8. MEDIUM — the criterion-7 fixture lives in a gitignored directory

`.gitignore:3` ignores `.infrabrain/`; `git ls-files .infrabrain` is empty. A test that reads `.infrabrain/sessions/…` passes on this machine and vacuously passes or errors everywhere else. Copy the fixture into `tests/fixtures/audit/` and commit it.

### 9. LOW — `step_start` is invisible to replay by design; don't "fix" it

`App.tsx:200` does not match `step_start`. That is correct and must stay: adding it would require a consumer change (criterion 8). The consequence is that `risk`/`target`/`totalSteps` must be duplicated onto `step_complete`/`step_failed`. Putting them only on `step_start` is the most likely way to fail criterion 4 while believing it is met.

### 10. LOW — emission must not perturb the damage budget

Attempt 1's failure is currently uncharged on both retry paths (see Q2). Correcting that would change halt timing and break existing budget tests. Out of scope; note it for the dossier.

---

## Validation Architecture

`[VERIFIED: codebase]` `.planning/config.json` sets `workflow.nyquist_validation: true`.

### Test Framework

| Property | Value |
|---|---|
| Framework | Vitest 4.0.18 |
| Config file | `vitest.config.ts` — `globals: false`, `include: ['tests/**/*.test.ts','tests/**/*.test.tsx']` |
| Quick run command | `npx vitest run tests/execution/executor.test.ts tests/audit tests/ui/app.test.tsx` |
| Full suite command | `npm test` (`vitest run`) |
| Type gate (clean files) | `npx tsc --noEmit` filtered to the change set; expect 0 for all files except `self-healer.ts` |
| Type gate (self-healer) | baseline diff — exactly 2 pre-existing `maxTokens` errors, unchanged |
| Baseline | 1318 passed / 2 failed / 4 skipped. The 2 (`poc-nginx-502`, `poc-postgres-connleak`) are environmental. Gate: **no new failures.** |

### Acceptance criteria → validation map

| # | Criterion | Test-verifiable? | Automated command / method |
|---|---|---|---|
| 1 | `step_start` emitted before each attempt | **yes** | Spy `logStepEvent`; run `executePlan` on a 2-step plan with one CB-failing step; assert a `step_start` precedes every terminal event for each `(stepIndex, attempt_n)`. `npx vitest run tests/execution/executor.test.ts` |
| 2 | `step_failed` on every failing attempt, incl. rescued ones | **yes** | (a) CB path — Pattern A, assert 4 `step_failed` with `attempt_n` 1..4. (b) Self-heal path — real `selfHealStep` with mocked `generateText`, first correction fails then succeeds; assert `step_failed(1)`, `step_failed(2)`, `step_complete(3)` |
| 3 | `attempt_n` on **every** step event, no exceptions | **yes — two layers** | (i) *compile-time*: `logExecution` narrowed to `Exclude<AuditEventType, StepEventType>` — a step event without `attempt_n` cannot compile. Validated by a `// @ts-expect-error` fixture asserting the bad call is rejected. (ii) *emitter property test*: run `executePlan` across all four outcome paths (success, CB-halt, self-heal-rescue, self-heal-exhausted) with one spy; assert `spy.mock.calls.every(c => Number.isInteger(c[1].attempt_n) && c[1].attempt_n >= 1)`. This is an emitter property, not a sample assertion — satisfies D-2 |
| 4 | Payload complete for replay | **yes — round trip** | Producer → `buildReplayState` in one test; assert `risk !== ''`, `total === plan.steps.length`, `target` defined, `stdout`/`stderr` present. Do **not** hand-write the entries — that is the sample-based test D-2 warns about |
| 5 | Status derivation is event-only | **yes** | Against `src/audit/step-status.ts`: (a) a trail with `step_start` and no terminal never yields `succeeded`; (b) a trail where `self_heal_attempt.outcome === 'success'` contradicts `step_failed` yields **failed** — the Q1 precedence rule made mechanical |
| 6 | Cardinality enforced, violations visible | **yes — 4 cases** | (i) 1 terminal → `succeeded`/`failed`; (ii) 0 terminals + `execution_complete` present → `integrity_violation`; (iii) 0 terminals + no session-closed marker → `in_flight` (open) / `indeterminate` (unknowable); (iv) 2 terminals → `integrity_violation` **regardless of their content**. Assert the violation is a distinct returned state, never coerced |
| 7 | Pre-fix records still parse | **yes** | Load `tests/fixtures/audit/<copied-session>.jsonl`; assert `buildReplayState` throws nothing, and `step-status.ts` marks every record `era: 'pre_fix'` and applies no cardinality verdict |
| 8 | No consumer file modified | **partly automatable** | `git diff --name-only <base>..HEAD -- src/ui/App.tsx src/cli/formatter.ts` must be **empty**. Add this as an explicit verification step; it is the cheapest possible guard on the highest-signal criterion |
| 9 | Regression test passes, red state is an artifact | **inspection-gated** | The test itself is automated (Q6 Pattern A round trip). The *red proof* is not machine-checkable after the fact — it requires either a RED commit whose SHA is recorded, or the failing run's stdout persisted to `.planning/phases/20-audit-integrity/`. **This is the one criterion requiring human/inspection verification.** |

### Sampling rate

- **Per task commit:** `npx vitest run tests/execution/executor.test.ts tests/execution/self-healer.test.ts tests/execution/circuit-breaker.test.ts tests/audit tests/ui/app.test.tsx`
- **Per wave merge:** `npm test` — assert 1318+ passed, ≤2 failed, and that the 2 are the known environmental POCs
- **Phase gate:** full suite green (modulo the 2 known) + `git diff` on the two frozen consumers empty + the D-4 red artifact present in the phase directory

### Wave 0 gaps

- [ ] `tests/audit/step-status.test.ts` — new file; covers criteria 5, 6, 7
- [ ] `tests/audit/logger.test.ts` — new file; covers criterion 3 layer (i), including the `@ts-expect-error` fixture
- [ ] `tests/fixtures/audit/<session>.jsonl` — copied from `.infrabrain/sessions/019ced00-7fb2-77c2-b876-1c1752feb0dc/`, reviewed, committed (criterion 7)
- [ ] `tests/execution/audit-step-events.test.ts` — new file; the emitter property test and the producer→`buildReplayState` round trip (criteria 1, 2, 3-ii, 4, 9)
- [ ] Update 18 `auditLogger` mocks across 13 test files to add `logStepEvent`
- [ ] Flip `tests/ui/app.test.tsx:281` (`reconstructs what the executor actually writes today`)

No framework install needed — Vitest is present and configured.

---

## Runtime State Inventory

Not a rename/refactor/migration phase, but D-1's "two schema eras in one log" makes the equivalent question worth answering explicitly.

| Category | Items found | Action required |
|---|---|---|
| Stored data | 319 `audit.jsonl` files under `.infrabrain/sessions/` (98 with audit content, 1384 events) + the mirrored SQLite `audit_log` table | **None — D-1 forbids migration.** The reader must tolerate the pre-fix era |
| Live service config | None — no external service stores step-event schema | None |
| OS-registered state | None | None — verified: no scheduler/daemon references step events |
| Secrets / env vars | None — no env var gates audit behaviour | None |
| Build artifacts | None — `dist/` is gitignored and rebuilt by `npm run build` | None |

**The one live-state consequence:** the SQLite `audit_log` table already stores `metadata` as an opaque JSON blob (`src/state/store.ts:207`), so no schema migration is needed to carry `attempt_n`. This is a direct consequence of the Q4 placement decision — a top-level field *would* have required an `ALTER TABLE`.

---

## Environment Availability

| Dependency | Required by | Available | Version | Fallback |
|---|---|---|---|---|
| Node.js + npm | build/test | ✓ | project baseline | — |
| Vitest | all validation | ✓ | 4.0.18 (`vitest.config.ts`) | — |
| TypeScript / `tsc` | file-scoped type gate | ✓ | ran successfully; 8 pre-existing errors in 4 files | — |
| Live LLM backend | **not required** | ✗ | — | `generateText` is mocked in `tests/execution/self-healer.test.ts`; `selfHealStep` is module-mocked in `executor.test.ts` |
| Docker + `demo/` stack | **not required** | ✗ | — | Only the 2 known-failing environmental POCs need it; excluded from this phase's gate |

**No blocking dependencies.** Every acceptance criterion is reachable with mocks alone — a deliberate strength of the existing executor test harness.

---

## Package Legitimacy Audit

**Not applicable.** This phase installs no packages in any ecosystem. The change set is confined to existing first-party source files plus new test and pure-module files. No `npm install` step should appear in any plan; if one does, the payload contract was misread.

---

## Recommended change set

| File | Change | tsc baseline |
|---|---|---|
| `src/audit/types.ts` | add `StepEventType`, `StepEventPayload` | 0 errors — clean gate |
| `src/audit/logger.ts` | add `logStepEvent`; narrow `logExecution`; monotonic timestamp (Pitfall 1) | 0 errors — clean gate |
| `src/audit/step-status.ts` | **new** — pure D-3 deriver | new file — clean gate |
| `src/execution/executor.ts` | 4 emission sites; enrich `step_complete`; thread `stepIndex`/`totalSteps`/`target` into **both** `healContext` builds | 0 errors — clean gate |
| `src/execution/circuit-breaker.ts` | optional `onAttempt` callback | 0 errors — clean gate |
| `src/execution/self-healer.ts` | `step_start`/`step_failed` at the 4 existing sites; add `stepIndex`/`attempt_n` to `self_heal_attempt` | **2 pre-existing errors** — baseline diff, not zero |
| `src/execution/types.ts` | `logStepEvent` on both structural `auditLogger` shapes; extend `SelfHealContext` | 0 errors — clean gate |
| `src/api/routes/history.ts` | session-scoped default limit (Pitfall 2) | 0 errors — clean gate |
| **`src/ui/App.tsx`** | **FROZEN — must not appear in `git diff`** | — |
| **`src/cli/formatter.ts`** | **FROZEN — must not appear in `git diff`** | — |

---

## Assumptions Log

| # | Claim | Section | Risk if wrong |
|---|---|---|---|
| A1 | Emitting `session_end` would be a worthwhile 1-line addition to close the 1.8% indeterminate gap | Q5 | Low. Flagged for owner decision, not recommended unilaterally — arguably outside "step events" scope |
| A2 | Raising the `/history` limit for session-scoped queries is acceptable under criterion 8 | Pitfall 2 | Medium. `src/api/routes/history.ts` is not among the two frozen consumer files, but if the owner reads criterion 8 more broadly this needs sign-off. **The underlying truncation is a fact, not an assumption** — only the chosen remedy is a judgement |
| A3 | A `blocked_by_safety` self-heal iteration counts as a step *attempt* and warrants a `step_failed` | Q1 / Q2 site 8 | Medium. It consumed budget (`self-healer.ts:381`) and an attempt slot but ran no command against the target. Omitting it from the record would be the same class of omission this phase abolishes — but it is a semantic call the owner may want to make |

Everything else in this document is `[VERIFIED: codebase]` at the cited file:line, or measured from the 319 real `audit.jsonl` files.

---

## Open Questions

1. **Should `self_heal_attempt` keep its duplicated `outcome`/`stderr`/`exitCode` fields?**
   - Known: they overlap with the new `step_failed` payload; the brief warns against duplicating attempt history.
   - Unclear: whether the owner reads "duplication" as *two records mentioning the same command* or *two sources of truth for status*.
   - Recommendation: keep the fields, declare the step family authoritative, and enforce the precedence with the contradiction test in criterion 5. Field deletion is a behaviour change with no consumer benefit.

2. **Does criterion 8's freeze extend beyond `App.tsx` and `formatter.ts`?**
   - Known: the brief names exactly those two files.
   - Unclear: whether `src/api/routes/history.ts` and `src/state/store.ts` count as "consumers".
   - Recommendation: treat only the two named files as frozen, and call out the `history.ts` limit change explicitly in the plan so the owner can veto it. It is the only way to prevent the fix from degrading replay (Pitfall 2).

3. **How is the D-4 red artifact to be recorded?**
   - Known: the criterion accepts either a RED commit or persisted failing output.
   - Recommendation: do both — commit the failing test alone first (record the SHA in the plan), and `npx vitest run <file> 2>&1 | tee .planning/phases/20-audit-integrity/20-RED-PROOF.txt`. Cost is negligible; the guarantee becomes mechanical rather than narrated, which is the stated point of D-4.

---

## Sources

### Primary (HIGH confidence) — first-party source, read directly
- `src/audit/types.ts`, `src/audit/logger.ts`, `src/state/store.ts`
- `src/execution/executor.ts`, `src/execution/self-healer.ts`, `src/execution/circuit-breaker.ts`, `src/execution/damage-budget.ts`, `src/execution/types.ts`
- `src/ui/App.tsx`, `src/ui/types.ts`, `src/ui/hooks/useDPEV.ts` (read-only — frozen consumers)
- `src/cli/formatter.ts` (read-only — frozen consumer)
- `src/api/routes/history.ts`, `src/api/routes/execute.ts`
- `tests/execution/executor.test.ts`, `tests/ui/app.test.tsx`, `tests/execution/types.test.ts`, `tests/e2e/helpers/assert-dpev-sequence.ts`, `vitest.config.ts`

### Primary (HIGH confidence) — measured from live data
- 319 `audit.jsonl` files under `.infrabrain/sessions/`; 98 sessions with audit content; 1384 events. Event tallies reproduce the brief exactly (`step_complete` 123, `self_heal_attempt` 98, `self_heal_exhausted` 30, `circuit_breaker_triggered` 26, `step_failed` **0**).
- Metadata key-frequency analysis per event type (the `stepIndex`-absent finding for `self_heal_attempt`).
- Session-closed marker coverage: 54/55 by union.
- `npx tsc --noEmit` — 8 errors across 4 files, grouped.

### Secondary / Tertiary
- None. No external documentation lookup was performed or needed: this phase adds no dependency and touches no unfamiliar technology. `[VERIFIED: codebase]` is the only provenance class present.

---

## Metadata

**Confidence breakdown:**
- Defect localisation & emission sites: **HIGH** — every site read at file:line
- Payload contract: **HIGH** — derived field-by-field from the frozen consumers; no consumer change needed
- `attempt_n` placement: **HIGH** — forced by the SQLite column list at `store.ts:193-208`, not a preference
- Q1 recommendation: **HIGH** — the absence of `stepIndex` on all 98 historical `self_heal_attempt` records settles it empirically
- Session-open determination: **HIGH** — measured at 54/55, with the residual gap given its own visible state
- Pitfalls 1 & 2: **HIGH** — both mechanically derived from the sort/limit code paths; both are latent today and worsened by this fix
- Blast radius (18 mocks, 13 files): **HIGH** — counted

**Research date:** 2026-07-31
**Valid until:** stable — this is internal-codebase research with no external dependency. It expires when `src/execution/executor.ts`, `src/audit/`, or the two frozen consumers change.
