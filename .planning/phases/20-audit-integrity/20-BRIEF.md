# Phase 20 — Audit Integrity

**Milestone:** v1.4 Pilot Readiness
**Source:** `.planning/HARDENING-DOSSIER.md` section M
**Priority:** Gate 0 of the loop-proof block. Nothing in Phase 21 may start before this is green.
**Type:** Backend / audit producer. No UI work.

---

## Why this phase exists

A failed execution step currently replays as a success.

The audit trail is the artifact InfraBrain pitches as its compliance story — the thing a pilot
MSP's engineer will inspect and an auditor will ask about. Today it misrepresents what happened.
That makes this a trust defect, not a logging defect.

**This phase must ship before the five March regression scenarios (Phase 21).** A
`verification: verified` produced against today's records would be exactly the green tick on a
rotten record that this phase exists to abolish. The sequence is not a preference.

---

## Evidence

Established 2026-07-31 by reading the source and auditing 172 session directories
(1384 events across 98 sessions with audit data).

**Declared but never emitted.** `src/audit/types.ts:13-15` declares three step-level event types:

```
| 'step_start'
| 'step_complete'
| 'step_failed'
```

`src/execution/executor.ts:341` is the **only** step-level emission anywhere in `src/`:

```typescript
// g. Success: deduct from budget and log
budget.deduct(cost);

deps.auditLogger.logExecution('step_complete', {
  stepIndex: i,
  command: commandUsed,
  exitCode: finalResult.exitCode,
});
```

Note the position: it sits after the `// g. Success:` comment, on the success path only, and
after the circuit breaker has already resolved.

**The consumers are already written and waiting.** These read `step_failed` today and will light
up the moment it is emitted — no consumer work is required by this phase:

- `src/ui/App.tsx:200` — `eventType === 'step_complete' || eventType === 'step_failed'`
- `src/ui/App.tsx:218` — `: eventType === 'step_failed' ? 'failed'`
- `src/cli/formatter.ts:302, 308, 393`

**The audit history confirms it.** Across all recorded sessions:

| Event | Count |
|---|---|
| `step_complete` | 123 |
| `self_heal_attempt` | 98 |
| `self_heal_exhausted` | 30 |
| `circuit_breaker_triggered` | 26 |
| **`step_failed`** | **0** |

A step that self-healed after three attempts leaves exactly one clean `step_complete`. The
attempt history — the most operationally interesting part of the record — is discarded.

**Payload gaps.** `buildReplayState` (`src/ui/App.tsx:110`) already reads `risk`, `target`,
`totalSteps`, `stdout` and `stderr` when present. None are written. Replay therefore shows an
empty `[]` risk badge and a `[1/0]` step counter. Again: consumer ready, producer silent.

---

## Scope

**In scope — producer side only:**

- `src/execution/executor.ts` — emit `step_start` and `step_failed`; enrich `step_complete`.
- `src/audit/logger.ts` / `src/audit/types.ts` — payload shape, attempt numbering.
- Tests for both.

**Explicitly out of scope:**

- Any consumer change (`App.tsx`, `formatter.ts`). They are already correct.
- The five March regression scenarios — that is Phase 21, and it depends on this.
- Anything else in the hardening dossier (rollback H, structured output A, logging B, …).

---

## Design decisions — locked by the project owner 2026-07-31

### D-1. Old records are never rewritten or migrated

Historical audit records stay exactly as they are — **including the flawed ones**. They are
evidence of the past, and a past defect is part of that evidence. No backfill, no migration, no
"correcting" a 2026-03 session to look like it was recorded under the new schema.

Consequence: readers must tolerate both shapes. A record without an attempt number is a
pre-fix record, and that is a legitimate state, not a parse error.

### D-2. Append-only from the fix onward, with attempt numbers

From this phase forward the step log is append-only. Each attempt at a step appends its own
event carrying an explicit attempt number. Nothing is overwritten and nothing is collapsed into
a single summary row.

**Producer invariant — no exceptions.** Every step event written by the new producer carries
`attempt_n`, **including attempt 1**. This is not a formatting preference: D-1 keeps two schema
eras alive in the same log, and "no `attempt_n` ⇒ pre-fix record" is the only thing that tells
them apart. A single new event written without `attempt_n` collapses that discriminant and makes
every pre-fix record indistinguishable from a new bug. Assert it in a test over the emitter, not
only over sample payloads.

### D-3. Status is derived exclusively from events

A step's outcome is computed from the event sequence — never stored as a standalone field, never
inferred from the *absence* of an event. Absence of `step_failed` must not read as success. This
is the root cause of the original defect and the rule that prevents its return.

**Cardinality invariant.** Exactly **one** terminal event per `(stepIndex, attempt_n)` pair —
where terminal means `step_complete` or `step_failed`.

| Terminal events for a pair | Meaning |
|---|---|
| 1 | the only valid state |
| 0 | in-flight *if the session is still open*; **integrity violation** if the session has ended |
| 2+ | integrity violation, always |

The reader must **surface** violations — as a distinct, visible state — rather than resolving
them into whichever outcome looks plausible. Interpreting ambiguity away is precisely how a
failure came to render as a success in the first place; a rule that silently repairs its own
violations cannot be relied upon. This hardening exists so the root fix survives the next
refactor rather than depending on it.

---

## Acceptance criteria

1. **`step_start` is emitted** before each step attempt.
2. **`step_failed` is emitted** on every failing attempt, including attempts that a later retry
   or self-heal ultimately rescues.
3. **Attempt numbers are explicit on every step event without exception, attempt 1 included**
   (D-2 producer invariant). A step healed on attempt 3 leaves three discernible attempt records.
   Test the emitter itself, not just sample payloads — the schema-era discriminant depends on
   this holding universally.
4. **Payload is complete enough for replay**: `risk`, `target`, `totalSteps`, `stdout`, `stderr`
   populated so `buildReplayState` renders a real risk badge and a correct `[n/m]` counter.
5. **Status derivation is event-only** (D-3), with a test asserting that a missing `step_failed`
   is not treated as success.
6. **Terminal-event cardinality is enforced and violations are visible** (D-3 cardinality
   invariant). Tests cover all three cases: exactly one terminal event, zero with the session
   closed, and two. The zero-with-session-open case must read as in-flight, not as a violation.
   A violation must surface as its own state — never be resolved into a plausible-looking outcome.
7. **Pre-fix records still parse.** A test loads a real historical session (pre-2026-07-31) and
   asserts it renders without error and without being silently reinterpreted.
8. **No consumer file is modified.** `App.tsx` and `formatter.ts` are untouched; if either needs
   a change, that is a signal the payload shape is wrong.
9. **The regression test below passes, and its red state is an artifact.**

### The closing regression test — required

> *The bug that opened this phase must be the test that closes it.*

Drive a step to genuine failure, replay the resulting session, and assert the reconstructed
record shows **failure plus the attempt history** — not success.

**The red proof must itself be an artifact.** Either commit the failing test on its own
(RED commit) before the fix, or persist the failing run's output into this phase directory as
evidence. A regression test that passes on the broken code is testing the wrong thing — and
"it was red first" that exists only in a summary is narration, indistinguishable in two weeks
from a test that was never red at all. Same principle as section N: make the guarantee
mechanical rather than reported.

---

## Out-of-band notes for the planner

- `self_heal_attempt` (98 recorded) already exists and carries some of this information. Check
  whether it should be superseded by, folded into, or kept alongside per-attempt step events —
  duplicating attempt history across two event families would be its own trap.
- Section H (rollback redesign, Phase 22) computes its success metric from these same records.
  Whatever shape lands here determines whether that metric is meaningful, so prefer explicitness
  over compactness.
- `src/execution/executor.ts` carries 0 of the 8 known pre-existing `tsc` errors, so the
  file-scoped type check is a usable gate here. `npx tsc --noEmit` project-wide still cannot pass
  — see dossier section C.
- Test baseline at phase start: **1318 passed / 2 failed / 4 skipped**. The 2 failures
  (`poc-nginx-502`, `poc-postgres-connleak`) are environmental and expected — see dossier D2.
