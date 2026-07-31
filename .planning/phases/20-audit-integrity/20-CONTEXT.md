# Phase 20: Audit Integrity - Context

**Gathered:** 2026-07-31
**Status:** Ready for planning
**Source:** Direct owner decisions during the phase-20 setup conversation, plus an audit of 172 session directories. Full evidence in `.planning/phases/20-audit-integrity/20-BRIEF.md` and `.planning/HARDENING-DOSSIER.md` section M.

<domain>
## Phase Boundary

A failed execution step currently replays as a **success**. The audit trail — the artifact InfraBrain
pitches as its compliance story, and the thing a pilot MSP's engineer will inspect — misrepresents
what happened. This is a trust defect, not a logging defect.

**In scope — producer side only:**
- `src/execution/executor.ts` — emit `step_start` and `step_failed`; enrich `step_complete`
- `src/audit/logger.ts` / `src/audit/types.ts` — payload shape, attempt numbering
- Tests for both

**Out of scope — hard fences:**
- Any consumer change. `src/ui/App.tsx` and `src/cli/formatter.ts` already handle `step_failed`
  correctly and are waiting for an event that never arrives. If either needs modification, that is
  a signal the payload shape is wrong.
- The five March regression scenarios — Phase 21, and it depends on this one.
- Everything else in the hardening dossier (rollback H, structured output A, logging B, types C, …).

**Gate role:** Phase 20 blocks Phase 21 (Loop Proof) and Phase 22 (Rollback Redesign). Both compute
their headline metrics from these records. A `verification: verified` produced against today's
records would be exactly the green tick on a rotten record that this phase exists to abolish.
</domain>

<decisions>
## Implementation Decisions

### D-1. Old records are never rewritten or migrated — LOCKED

Historical audit records stay exactly as they are, **including the flawed ones**. They are evidence
of the past, and a past defect is part of that evidence. No backfill, no migration, no "correcting"
a 2026-03 session to look like it was recorded under the new schema.

Consequence: readers must tolerate both shapes. A record without an attempt number is a pre-fix
record — a legitimate state, not a parse error.

### D-2. Append-only from the fix onward, with attempt numbers — LOCKED

From this phase forward the step log is append-only. Each attempt at a step appends its own event
carrying an explicit attempt number. Nothing is overwritten, nothing is collapsed into a summary row.

**Producer invariant, no exceptions:** every step event written by the new producer carries
`attempt_n`, **including attempt 1**. This is not a formatting preference. D-1 keeps two schema eras
alive in the same log, and "no `attempt_n` ⇒ pre-fix record" is the only thing distinguishing them.
A single new event without `attempt_n` collapses the discriminant and makes every pre-fix record
indistinguishable from a new bug.

Test the **emitter**, not only sample payloads — a sample-based test cannot establish an
exceptionless property.

### D-3. Status is derived exclusively from events — LOCKED

A step's outcome is computed from the event sequence. Never stored as a standalone field, never
inferred from the *absence* of an event. Absence of `step_failed` must not read as success. This is
the root cause of the original defect and the rule preventing its return.

**Cardinality invariant:** exactly one terminal event per `(stepIndex, attempt_n)` pair, where
terminal means `step_complete` or `step_failed`.

| Terminal events for a pair | Meaning |
|---|---|
| 1 | the only valid state |
| 0 | in-flight *if the session is still open*; **integrity violation** if the session has ended |
| 2+ | integrity violation, always |

The reader must **surface** violations as a distinct visible state, never resolve them into whichever
outcome looks plausible. Interpreting ambiguity away is precisely how a failure came to render as a
success; a rule that silently repairs its own violations cannot be relied upon.

### D-4. The red proof is an artifact — LOCKED

The closing regression test must fail against the current producer, and **that failure must be
recorded**: either a RED commit carrying the failing test before the fix, or the failing run's output
persisted into the phase directory.

A regression test that passes on the broken code is testing the wrong thing. And "it was red first"
that exists only in a summary is narration — in two weeks it is indistinguishable from a test that
was never red.

### D-5. `history.ts` is in scope; `App.tsx` and `formatter.ts` stay frozen — LOCKED 2026-07-31

Research established that replay defaults to **20 events**, newest-first
(`src/state/store.ts:165` — `const limit = filters.limit ?? 20`, `ORDER BY timestamp DESC`), and
that `src/ui/App.tsx:393` fetches `/history?session=X&verbose=true` without a `limit`, so the
default applies. This phase roughly triples step-event volume — left alone, the fix would make
replay *worse* by pushing the oldest events out of the window.

Three places could fix it. Two are frozen:

| Site | Decision |
|---|---|
| `App.tsx:393` — send a limit | frozen (criterion 8) |
| `src/api/routes/history.ts:45` — default session-scoped queries higher | **in scope** |
| `store.ts:165` — change the global default | avoid; affects every consumer, not just replay |

**Resolution:** `history.ts` is a route handler, not a renderer. The freeze exists so the payload
contract must be right without touching the *rendering* consumers — that purpose is untouched by a
limit default. `App.tsx` and `formatter.ts` remain hard-frozen; if either needs a change, the
payload contract was misread.

### Claude's Discretion

- Exact payload field names and event schema shape.
- How the reader represents an integrity violation internally, so long as it is visible and distinct.
- Test file organisation.

**No longer discretionary — resolved by research:** `attempt_n` placement. `appendAudit`
(`src/state/store.ts:185-209`) writes the whole entry to JSONL via `JSON.stringify(entry)` but
INSERTs a **fixed column list** (`session_id, timestamp, event_type, risk_level, command, decision,
reasoning, diff_before, diff_after, metadata`). A top-level `attempt_n` would survive in the file and
be **silently dropped on the exact path replay reads** (SQLite via `/history`). It must live inside
`metadata`. Verified 2026-07-31.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope and evidence
- `.planning/phases/20-audit-integrity/20-BRIEF.md` — full evidence, nine acceptance criteria, planner notes
- `.planning/HARDENING-DOSSIER.md` — section M (this phase), section I (Phase 21 dependency), section H (Phase 22 dependency)

### Producer — the files this phase changes
- `src/execution/executor.ts:341` — the only step-level emission in `src/`, on the success path only
- `src/audit/types.ts:13-15` — `step_start` / `step_complete` / `step_failed` declared
- `src/audit/logger.ts:64` — `logError` signature, for reference on logger shape

### Consumers — read to derive the payload contract, but DO NOT MODIFY
- `src/ui/App.tsx:110` — `buildReplayState`, already reads `risk`/`target`/`totalSteps`/`stdout`/`stderr`
- `src/ui/App.tsx:200,218` — already branches on `step_failed`
- `src/cli/formatter.ts:302,308,393` — already handles `step_complete` / `step_failed`

### Test anchor
- `tests/ui/app.test.tsx` → `reconstructs what the executor actually writes today` — the test to flip
</canonical_refs>

<specifics>
## Specific Ideas

**Audit evidence, all sessions (172 directories, 1384 events, 98 with audit data):**

| Event | Count |
|---|---|
| `step_complete` | 123 |
| `self_heal_attempt` | 98 |
| `self_heal_exhausted` | 30 |
| `circuit_breaker_triggered` | 26 |
| **`step_failed`** | **0** |

A step that self-healed after three attempts leaves exactly one clean `step_complete`. The attempt
history — the most operationally interesting part of the record — is discarded.

**The emission site, `src/execution/executor.ts:341`:**

```typescript
// g. Success: deduct from budget and log
budget.deduct(cost);

deps.auditLogger.logExecution('step_complete', {
  stepIndex: i,
  command: commandUsed,
  exitCode: finalResult.exitCode,
});
```

Note the position: after the `// g. Success:` comment, on the success path only, and after the
circuit breaker has already resolved.

**Replay symptom:** empty `[]` risk badge and a `[1/0]` step counter, because `buildReplayState`
reads fields the producer never writes.

**Planner trap to resolve explicitly:** `self_heal_attempt` already exists (98 recorded) and carries
part of this information. Decide whether it is superseded by, folded into, or kept alongside
per-attempt step events. Duplicating attempt history across two event families would be its own trap.
</specifics>

<deferred>
## Deferred Ideas

- Migrating or backfilling historical records — explicitly rejected, see D-1.
- The five March multi-fault regression scenarios — Phase 21.
- Rollback reversibility redesign — Phase 22, consumes these records.
- Everything else in the hardening dossier: structured output (A), pipeline logging (B), type drift
  (C), test hygiene (D), StreamingText keys (E), two-mode entrypoint (F), vector-DB consolidation (K).
</deferred>

---

## Working constraints for this phase

- **Test baseline:** 1318 passed / 2 failed / 4 skipped. The 2 failures (`poc-nginx-502`,
  `poc-postgres-connleak`) are environmental — they need a live LLM backend and Docker plus the
  untracked `demo/` stack. NOT regressions. Gate: no NEW failures.
- **`npx tsc --noEmit` project-wide cannot pass** — 8 pre-existing errors (zod v4 / AI SDK v6 /
  LanceDB v0.27 drift; dossier section C). Measured distribution, verified 2026-07-31:

  | File | Errors |
  |---|---|
  | `src/config/types.ts` | 4 |
  | `src/execution/self-healer.ts` | **2** |
  | `src/cache/lance-store.ts` | 1 |
  | `src/memory/incident-store.ts` | 1 |

  `src/execution/executor.ts` carries **none**, so a file-scoped zero-error gate works there. But
  research showed the change set necessarily includes `self-healer.ts` (criterion 2 is unreachable from
  `executor.ts` alone — `CircuitBreaker.execute` returns only the final `RunResult`, and
  `selfHealStep` returns `attempts[]` only after the fact). **For `self-healer.ts` the gate must be
  a baseline diff against 2, not zero.** The brief's blanket "executor.ts is clean" guidance was
  correct but incomplete about scope.
- A gitleaks pre-commit hook is active (`core.hooksPath=.githooks`). Commits are scanned; this is
  expected, not an error.

---

*Phase: 20-audit-integrity*
*Context gathered: 2026-07-31*
