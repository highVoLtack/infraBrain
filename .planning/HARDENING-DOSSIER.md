# Hardening Dossier — candidate scope for a dedicated hardening phase

**Created:** 2026-07-31, during Phase 19.3 execution
**Status:** Not yet a phase. Input for `/gsd-phase` + `/gsd-plan-phase`.
**Why this exists:** findings accumulated across 19.3 execution and the 19.3-04 live
checkpoint run that are each out of scope for the plan that found them. Collected here so
nothing is lost between phases.

After Phase 19.3 closes, the only remaining planned work in v1.3 is **Phase 17.1** (Memory
Schema Prep for Caveman — backend only). That makes this a natural point to stop feature work
and harden.

Each item below records: evidence (file:line), what is actually known vs. assumed, and the
open decision. Items marked **INVESTIGATE FIRST** must not be "fixed" before the diagnostic
step, because more than one root cause produces the same symptom.

---

## A. Structured-output failure and diagnosis latency

**Impact: highest.** This is the live-demo killer. Observed 2026-07-31: `DIAGNOSIS` took 38s,
of which **24.3s was a structured-output call that failed and was thrown away**, followed by a
free-text retry. In front of an audience, 24s of silence reads as a hang.

### A0. INVESTIGATE FIRST — the failure reason is discarded

`src/orchestrator/diagnosis.ts:337` logs only the elapsed time to the console.
`diagnosis.ts:338` passes only `(structuredErr as Error).message` to the audit logger.

Audit-log evidence across all recorded history (`.infrabrain/sessions/*/audit.jsonl`):

```
5×  No object generated: response did not match schema.
3×  model requires more system memory (51.5 GiB) than is available (9.4 GiB)   [March, local model]
3×  Failed after 3 attempts. Last error: Service Unavailable
```

`No object generated: response did not match schema` is `NoObjectGeneratedError` — a **Zod
validation failure, not a transport error**. The AI SDK does not retry it. So the 24.3s was
**one single generation**, not a retry cascade.

The SDK error object carries `.cause` (the exact Zod issue path), `.text` (the raw model
response), `.finishReason` and `.usage`. All four are discarded; only the generic `.message`
survives. **Capture them before changing anything else** — one instrumented run identifies the
offending field, and the remaining fixes below diverge depending on the answer.

Critically: `finishReason: 'length'` (output truncated mid-JSON) surfaces with the *same*
generic message. If that is the real cause, a shorter timeout is the **wrong** fix — the call
needs a larger output-token ceiling, not an earlier abort.

### A1. Schema is stricter than the provider can honour

`src/orchestrator/types.ts:38-47`:

```ts
steps:   z.array(DiagnosticStepSchema).min(1).max(5)
fixPlan: z.array(z.object({ … })).min(1).max(5)
expected: z.string().max(80)
```

Gemini treats `maxItems` / `maxLength` as hints and does not enforce them. Zod enforces them
absolutely. A 95-character `expected` string, or a sixth fix step, rejects the entire object.

Supporting evidence: for this exact incident the free-text planning path produced
**6 steps** (`[PLANNING] Complete in 14.0s — 6 steps`) while the schema caps at 5. The model
demonstrably wants 6 here.

**Proposed shape:** move `.max()` constraints out of the *validation* schema and into the
prompt, then clamp in code after parsing (`.slice(0, 5)`). Validation should accept what the
model plausibly emits; business rules trim afterwards. Do not simply delete the limits.

Secondary latency driver in the same schema: `DiagnosticStepSchema.output` (`types.ts:30`)
demands verbatim command output for up to 5 steps. That is a large output-token count on a
thinking model, and a plausible truncation source — see A0.

### A2. Retry budget is global and tuned for the wrong failure mode

`src/llm/retry.ts:15` — `DEFAULT_MAX_RETRIES = 5` (≈6 attempts with exponential backoff).
Raised from the SDK default of 2 to smooth over Gemini 503s.

It does nothing for the schema-validation path (not retryable), and it makes the 503 path far
worse: the three historical `Failed after 3 attempts` entries date from `maxRetries: 2`. At 5,
that same outage becomes ~6 attempts of backoff stacked on a call that already runs 24s.

The constant is shared by every call site: `src/llm/provider.ts:57`, `:92`,
`src/context/noise-filter.ts:85`, `src/context/compactor.ts:93`,
`src/memory/intent-classifier.ts`, `src/orchestrator/diagnosis.ts:323`. A cheap classifier call
and the main diagnosis call should not share one budget.

**Proposed:** per-call-site retry and timeout budgets. `generateObject` has no timeout option —
use `abortSignal: AbortSignal.timeout(ms)`. Make the budget configurable so demo runs can be
aggressive and production runs generous.

### A3. Silence is the real UX defect, not duration

`generateObject` produces nothing until it completes. `streamObject` emits partial objects
during generation, which — wired into the substatus line built in 19.3 — turns 24s of black
screen into 24s of visible assembly. It also changes the failure mode: partial output stays
displayable even when final validation fails.

### A4. Local path — grammar-constrained decoding

Ollama's `format: <json-schema>` uses GBNF grammar constraints, making malformed output
structurally impossible; genuinely stronger than Gemini's best-effort. Caveats: slower per
token, and it ignores `maxLength`/`maxItems` too — so A1 must be fixed regardless.

Note the demo ran against `generativelanguage.googleapis.com` / `models/gemini-2.5-flash`, so
this applies only to the local backend path.

---

## B. Pipeline logging corrupts the Ink render region

Bare `console.log` writes to stdout while Ink owns the screen, so `[TRIAGE]` / `[ROUTING]` /
`[DISCOVERY]` / `[NOISE]` / `[CONTEXT]` / `[DIAGNOSIS]` / `[PLANNING]` lines appear above the
panel box during live sessions.

Sources: `src/orchestrator/pipeline.ts:174, 190, 212, 214, 220, 234, 571, 572, 579, 584, 840,
901, 903` and `src/orchestrator/diagnosis.ts:316, 334, 337`.

`DEV_MODE = process.env.NODE_ENV !== 'production'` is **on by default**, and seven call sites
(`pipeline.ts:212, 214, 234, 571, 572, 579, 584`) are not even `DEV_MODE`-gated.

This is `19.3-RESEARCH.md` Pitfall 2. `src/index.ts:131` already works around it — but only for
startup messages, never for the session.

Distinct from the in-panel flicker check, which **passed**: the DPEVPanel render region itself
had no ghost or duplicated lines.

**Decision needed:** route diagnostics to a log file, or to an Ink-aware sink that renders them
inside the layout. Then gate every call site consistently. This is an architecture choice, not
a line edit — which is why it was not folded into 19.3.

---

## C. Type-level dependency drift — 8 pre-existing `tsc` errors

`npx tsc --noEmit` exits 2 with 8 errors in four files, none of them touched by Phase 19.3.
Runtime is unaffected (the vitest suite passes), but it means **`tsc --noEmit` cannot be used
as a CI gate today**, which is itself the problem.

| File | Error | Root cause |
|------|-------|------------|
| `src/config/types.ts` (3, ~lines 62, 90, 91) | TS2769 `.default({})` no overload matches | zod v4 tightened `.default()`; `{}` no longer satisfies the resolved output type of a nested `ZodObject` whose fields all have defaults |
| `src/execution/self-healer.ts` (2, lines 252, 369) | TS2353 `maxTokens` unknown | AI SDK v6 renamed `maxTokens` → `maxOutputTokens` |
| `src/memory/incident-store.ts` (1, line 119) | TS2339 `distanceType` not on `Query` | LanceDB v0.27 narrowed the query-builder union; `distanceType` lives on `VectorQuery` |
| `src/cache/lance-store.ts` | same family | zod v4 / LanceDB type drift |

Small and mechanical: rename `maxTokens`, supply explicit `.default()` literals, narrow to
`VectorQuery` before `.distanceType()`. **Then wire `tsc --noEmit` into CI** so the drift cannot
silently return.

---

## D. Test-suite hygiene

### D1. Flaky unhandled rejection

`tests/api/stream-debug.test.ts:391` (double-approve idempotency) fires
`AssertionError: expected 404 to be 200` from a `Timeout._onTimeout` **after the test has
already completed**. The file itself passes. The assertion should be awaited, not fired from a
timer.

### D2. Two environmental E2E failures are the permanent baseline

`tests/e2e/poc-nginx-502.test.ts` needs a live LLM backend; `tests/e2e/poc-postgres-connleak.test.ts`
needs Docker plus the untracked `demo/postgres` stack and dies in `beforeAll`.

Every plan in 19.3 had to carry "1259 passed / 2 failed / 4 skipped is green" as tribal
knowledge. That is a latent trap: a real regression in those files is now invisible.

**Decision needed:** provision the infrastructure, or gate the files behind an explicit env
flag so they skip loudly rather than fail silently-by-convention.

---

## E. `StreamingText` keys windowed lines by array index

`src/ui/components/StreamingText.tsx:28` renders `visibleLines.map((line, i) => <Text key={i}>)`
while windowing to the last `maxLines` entries (`lines.slice(-maxLines)`). Every new token
shifts each line's content to a different index under an unchanged key, so React patches text
into reused nodes instead of remounting.

This is the remaining half of **TERM-UX07** (the other half shipped in 19.3-04) and the D-22
"secondary suspect" for residual artefact lines.

**Proposed fix:** key on the window offset —
`key={`${lines.length - visibleLines.length + i}`}` — stable for a given line across advances.

Related but separate: the live run showed the **streaming** diagnosis body rendering raw
Markdown (literal `**` and ``` fences). `MarkdownView` (built in 19.3-01) is applied only to
expanded *completed* phase bodies, not to the live stream.

---

## F. Two-mode entrypoint is an ergonomics trap

`src/index.ts:114-118` — **any** CLI argument takes the one-shot Commander path and `return`s
before `render(App)`. So `node --import tsx src/index.ts debug "nginx 502"` can never show the
Ink UI. Only `npm run dev` with **no arguments**, then typing `debug nginx 502` into the prompt,
reaches the panel.

This cost a full checkpoint cycle on 19.3-04: the plan's own `how-to-verify` block suggested the
CLI form, the panel never appeared, and it read as a code defect.

The two-mode design is intentional and worth keeping. **Proposed:** an explicit `--tui` flag, or
a startup notice when args are present, so the mode is legible. Also: every future Ink
verification checkpoint must specify the argument-free invocation.

---

## G. Gemini is a development stand-in, not the target backend — RESOLVED

`.planning/STATE.md` records as a v1.3 decision: *"100% air-gapped, zero external API calls."*
The 2026-07-31 demo ran against `generativelanguage.googleapis.com`.

**This is not drift.** Per the project owner (2026-07-31): Gemini is the cheap, always-available
development backend. The alternative is renting RunPod capacity, which costs real money and adds
spin-up latency to every iteration. The working rule is *"build against Gemini, behave as if it
were local"*; once the feature set is proven, the stack moves to the local backend.

The air-gap decision therefore stands as the **target-state** constraint, not a description of
the current dev loop. Worth rewording in STATE.md so a future reader does not mistake it for a
violated invariant.

### Consequence for this hardening phase — read before planning

Several items above have a numeric and a structural half. **The structural halves transfer to
the local backend; the numeric ones do not.** Do not over-tune constants against a backend you
intend to leave.

| Item | Transfers to local? | Note |
|------|--------------------|------|
| A0 instrumentation | ✅ fully | Backend-agnostic. Even more valuable locally, where failures are harder to attribute. |
| A1 schema tolerance | ✅ fully | Both Gemini and Ollama treat `maxItems`/`maxLength` as hints. The fix is portable. |
| A2 retry budget | ⚠️ partly | `maxRetries: 5` exists to absorb **Gemini 503s** — a cloud failure mode that largely disappears locally. Keep the per-call-site *structure*, make the *numbers* backend-scoped config rather than a shared constant. |
| A2 timeout budget | ❌ numbers only | Latency profiles differ completely between Gemini 2.5 Pro and a local 122B on rented hardware. An 8s budget tuned today is meaningless after the move. Must be configurable per backend. |
| A3 `streamObject` | ✅ fully | Arguably matters *more* locally, where generation is slower. |
| A4 Ollama grammar | ⬆️ **promote** | Filed above as a side path. Given the local target, this is the **destination** path for structured output and deserves higher priority than its position suggests. |
| B logging | ✅ fully | Backend-independent. |

**Known blocker on the local path, already in the audit history:** three recorded failures read
`model requires more system memory (51.5 GiB) than is available (9.4 GiB)` (March, local model).
That gap is the actual reason RunPod is required, and it is a capacity/deployment question rather
than a code defect. Worth confirming which model tier the local target assumes before A4 is
planned — grammar-constrained decoding is moot if the model cannot be loaded.

---

## H. Rollback fails 80% of the time — DECIDED, priority 2

> **Status: design decided 2026-07-31 by the project owner. Not an open question.**
> Priority **2**, immediately after the loop proof (section I) — not a hardening detail.
> Rationale: the product's core promise is *reversible + auditable*. 33 failed against 8 complete
> contradicts the promise itself, so this ranks above latency, types, and logging.
>
> **Agreed design — four parts:**
> 1. **Reversibility is declared at plan time**, not generated after execution. Every planned step
>    carries either a rollback command or an explicit `irreversible` flag.
> 2. **Irreversible steps auto-escalate to the destructive tier** — typed confirmation, not a
>    silent Y/N.
> 3. **Rollback commands run through the same safety pipeline** as forward commands (skill
>    allowlist → global validator → dynamic rewriter). `DROP USER` as a rollback must become
>    structurally impossible, not merely unlikely.
> 4. Consequence: *"no rollback possible"* becomes an **honest property** of a step rather than a
>    recorded failure — and the rollback success metric becomes meaningful for the first time.
>
> **Target:** >90% rollback success on the demo stack, remainder cleanly declared irreversible.
> **Timing:** weeks 2–3, bundled with the placeholder gate (see H2 below).

### H2. Placeholder gate (same work package)

Fix plans containing `<PID>`, `<container_user>`, `<user>`, `<IP_ADDRESS_FROM_STEP_2>`,
`<python-app-service-name>` and similar must **not reach the approval gate at all**. Today
`checkForHallucinations` catches most at diagnosis time, but at least one survived the grounding
retry and reached a fix plan (`Fix plan contains placeholders: Step "docker stop app-core-01 &&
docker run -d --name app-…"`). Move the check to a hard gate in front of approval.

### Original evidence

Evidence from the project's own audit trail
(`.infrabrain/sessions/*/audit.jsonl`, 98 sessions with events):

```
rollback_failed    33
rollback_complete   8
```

The failures are not random. Rollback commands are LLM-generated *after* the fact, and fall into
two classes — neither of which a retry can fix:

**Class 1 — the operation is irreversible and the model says so honestly:**
```
"command": "N/A - Once terminated, the connection cannot be restored."
"command": "No rollback possible for terminated connections, but ensure no new connections are leaked"
"command": "No rollback needed for this step as the connection is terminated."
```
The model is right. The system records its honesty as a CRITICAL failure.

**Class 2 — the "rollback" is itself destructive:**
```
"command": "docker exec pg-store-01 psql -U admin -d appdb -c \"DROP USER svcuser;\""
"command": "docker exec permission-app chown -R root:root /app/data"
"command": "docker exec -it leaky-app sudo chown -R root:root /path/to/target/directory"
```
A `DROP USER` as a rollback step is a second incident, not a recovery.

**The design gap:** reversibility is treated as something to *generate after* execution rather
than a property to *establish before* it. README claims "Automatic rollback on safety limit
breach" as a shipped feature; the audit trail does not support that claim.

**Proposed direction (needs a decision, not just a fix):** classify each planned step's
reversibility *before* the approval gate — reversible / irreversible / compensating-action-only —
and surface that in the approval prompt. An irreversible step should be approved as irreversible,
not silently accepted and then fail rollback. Note the pre-execution snapshots (28 `step-N.json`
files on disk) already exist and are a stronger recovery primitive than a generated command;
consider whether snapshot restore should be the primary path.

---

## I. The DPEV loop has not run end-to-end since March 2026

**This is the finding that should gate the others.** Derived from audit events across all
sessions:

| Month | Sessions | reached `execution_complete` | reached `verification` |
|-------|----------|------------------------------|------------------------|
| 2026-03 | 86 | 50 | **13** |
| 2026-04 |  9 |  1 | **0** |
| 2026-07 |  3 |  0 | **0** |

All 13 verified end-to-end runs date from the v1.2 era (the 12.6 multi-fault validation). The
entire v1.3 Intelligence Layer — phases 14, 15, 16, 17, 18, 19, 19.1, 19.2, 19.3, spanning four
months — was built on top of a loop that has not been proven closed since.

This is not an accusation of breakage; the pieces may well work. It is an absence of evidence,
and it is the thing an outside reviewer will find first.

Real infrastructure *was* exercised in March (`ddev-schlafgut-db` 12 events,
`ddev-schlafgut-web` 5, `ddev-router` 5) alongside the demo stack (`pg-store-01` 68,
`vault-processor-99` 60, `kv-cache-01` 22, `permission-app` 20). The 2026-07-31 run produced a
correct diagnosis and fix plan against the real ddev stack but was declined at the approval gate,
so it never reached execute or verify.

**Proposed: open the hardening phase with a regression run** — the five multi-fault scenarios
from March, against the current v1.3 build, until `verification: verified`. That measures what
four months of Intelligence Layer actually cost, and makes every other item in this dossier
prioritisable against evidence instead of guesswork.

**Secondary observation from the same run:** Enriched Discovery returned
`Service Config (env vars): (empty)`, `Container Error Logs: (empty)`,
`Config File Locations: (empty)`. README lists these as shipped. Worth confirming whether that
is correct-for-this-incident or a silently degraded code path.

---

## K. Two vector databases is one too many — DECIDED: consolidate on LanceDB

> **Status: decided 2026-07-31 by the project owner.**

Qdrant (Phase 16, fix-caching) and LanceDB (Phase 17 MemPalace, plus `src/cache/lance-store.ts`)
both live in the stack. LanceDB is the standing project-wide standard. Maintaining both is
duplicated operational surface, duplicated failure modes, and duplicated embedding plumbing — on a
product whose whole pitch is that it runs self-contained on a customer's box.

**Decision: freeze or migrate the Qdrant fix-cache. Do not maintain both.**

Freeze (leave in place, stop investing) is acceptable short-term; migrate is the end state. This
needs a plan of its own — the fix-cache's similarity semantics must survive the move, and Phase 16
is a shipped feature with real behaviour to preserve.

Interaction with section A: the embedding-prefilter idea for skill triage (see the semantic-router
appendix) should target **LanceDB**, not Qdrant, so it does not deepen the split.

Interaction with section C: `src/memory/incident-store.ts` and `src/cache/lance-store.ts` both
carry pre-existing `tsc` errors from the LanceDB v0.27 upgrade. Consolidation work will touch these
files anyway — worth sequencing C and K together.

---

## M. A failed execution step replays as a success — audit producer gap

Found closing 19.3-06. **This is an audit-integrity issue, not a UI issue**, which is why it is
here rather than in a UI phase.

`src/execution/executor.ts:341` is the **only** step-level audit emission in `src/`, and it writes
`{stepIndex, command, exitCode}`. `step_start` and `step_failed` are declared in `AuditEventType`
but **emitted nowhere**. Consequences:

- A step that failed replays as `success`. The audit trail — the artifact pitched as the
  compliance story — misrepresents what happened.
- `risk`, `target`, `totalSteps`, `stdout`, `stderr` never reach the record, so session replay
  shows an empty `[]` risk badge and a `[1/0]` step counter.

`buildReplayState` already reads all of those fields when present, so **the entire fix is on the
producer side, one file**. The test to flip is `tests/ui/app.test.tsx` →
`reconstructs what the executor actually writes today`.

This blocks TERM-UX08 and is a prerequisite for section I: a regression suite that asserts
`verification: verified` is only as trustworthy as the step records underneath it. **Sequence this
inside the week 1–2 loop-proof work**, not after.

Related trust gap in the same area: section H's rollback metric is computed from these same
records.

---

## N. Requirements checkbox drift — recurring, needs a mechanical guard

Three separate waves in phase 19.3 independently found `REQUIREMENTS.md` entries whose checkbox
said `[x]` while the traceability row said `Planned`:

- 19.3-04 un-checked **TERM-UX04**.
- 19.3-06 un-checked **TERM-UX02** and **TERM-UX05** (no exit code in `StepCard`; `/status` never
  emits `latestCall`).

Each was caught only because an executor was explicitly instructed to distrust prior reports and
verify reachable behaviour. That is a process safeguard depending on prompt wording — it will not
survive the next phase without help.

**Proposed:** a `gsd-tools`-side or CI check asserting checkbox state and traceability row agree,
so drift fails loudly instead of relying on an executor's diligence.

Worth noting the honest outcome this discipline produced: at phase close TERM-UX04 is genuinely
*reachable* but stays `Planned`, because no test in the repo can drive a live SSE session — only
that `j` no longer leaks into the prompt is asserted, not that `j` moves the cursor. That gap
(no automated coverage of live keyboard interaction) is itself worth a line in the week 1–2 E2E
suite work.

---

## L. `.env` is not covered by `.gitignore` — act before any visibility change

**Checked 2026-07-31.** Good news first: `.env` has **never been tracked**, and a scan of the last
80 commits found no secret-shaped strings (`AIza…`, `sk-…`, `ghp_…`). Git history is clean, so a
public→private visibility change needs no history rewrite.

**The gap:** `git check-ignore -v .env` returns nothing — the file is untracked but *not ignored*.
A single `git add -A` or `git add .` would stage live Gemini credentials. Every GSD executor prompt
in phase 19.3 carried an explicit "never use `git add -A`" instruction precisely because the
working tree is littered with untracked files; that instruction is a convention, not a guarantee.

**Fix:** add `.env` to `.gitignore`. One line, do it before anything else.

If a credential is ever committed while the repo is public, treat the key as burned and rotate it —
removing the commit afterwards does not un-publish it (forks, clones, and platform caches retain it).

---

## J. README no longer matches the codebase

Low effort, but it is the first artifact any reviewer reads.

| README claim | Actual |
|---|---|
| "Vitest (579+ tests, 52 test files)" | 1318 passing tests |
| "LLM: AI SDK v6 + Ollama (multi-model registry: qwen3.5…)" | development runs against Gemini; see section G |
| "Automatic rollback on safety limit breach" | 33 failed / 8 complete; see section H |
| "TOON encoding (32k context = ~50k+ effective tokens)" | observed savings on real payloads: **0.4%** and **1.8%**. Plausible for small payloads, but the headline ratio is unsubstantiated at the sizes actually in use — measure before repeating the claim |

---

## Suggested sequencing

**Locked 2026-07-31 by the project owner.** Assumptions in force: ~10h/week, framework not yet
ordered, Linux/Docker only for pilot 1 (the four domain skills are Docker-centric anyway; Windows
becomes a roadmap slide, not a promise).

**Ordered by dependency, not by calendar.** No week numbers — each block starts when the previous
one is genuinely done. The governing chain is what matters:
**loop proof gates the demo, demo gates the funnel.**

### Block 0 — done 2026-07-31 ✅

- **`.env` → `.gitignore`** (**section L**). Verified first that `.env` was never committed and
  that no secret-shaped string exists anywhere in history — confirmed independently by gitleaks
  across 581 commits. **No key rotation needed, no history rewrite needed.** Commit `26e5d3b`.
- **gitleaks pre-commit hook** (**section N** principle, applied). Installed, enabled via
  `git config core.hooksPath .githooks`, and verified by planting a fake Gemini key and confirming
  the commit was refused. Commit `0161425`. This error class is now mechanically dead rather than
  discipline-dependent.

Still open in this block, non-engineering:
- Repo public → private. Now purely a business decision; the security work above was the part that
  mattered. History is clean either way.
- CyberForum mail to the two founders.
- Fix the README lies (**section J**). Test count is **1318**, not 1259 — plan 19.3-06 added 59.

### Block 1 — loop proof (**section I**, priority 1)

- **Task 1 / Gate 0: section M**, the audit producer gap. Moved to the front by owner decision:
  a regression suite asserting `verification: verified` is only as trustworthy as the step records
  underneath it, and today a failed step replays as a success. Fix the producer before measuring
  anything with it.
- Five March multi-fault scenarios against v1.3 until `verification: verified`.
- Check them in as an **automated E2E suite**, so this can never silently rot for four months again.
- Fix the v1.3 regressions surfaced along the way — Enriched Discovery returning `(empty)` smells
  like exactly one of these.
- Structured-output fix (**A0 → A1**): instrument first, then schema tolerance + ~8s timeout.
  Halves demo time as a side effect.
- **Read-only mode as a config flag** — small, because the risk classifier already exists, but
  mandatory for pilot phase 1.
- Worth folding in here: no automated coverage exists for live keyboard interaction (see section N,
  final paragraph). The E2E work is the natural place to close it.

### Block 2 — rollback redesign (**section H**, priority 2)

Four-part design as decided, plus the **H2 placeholder gate**. Target: >90% rollback success on the
demo stack, remainder cleanly declared irreversible.

### Block 3 — Ollama path (**section A4**, **section G**)

- Stage 1: Mac with mini models — provider code, costs nothing. The 51.5 GiB errors show the
  earlier attempt used models that were far too large.
- Stage 2: RunPod, real trio. **Golden set = the same five regression scenarios** — double duty.
- Stage 3: green → order the framework.
- In parallel: **embedding triage** (bge-m3 via LanceDB) replacing the LLM triage call. Per
  **section K**, this targets LanceDB, not Qdrant. Structural bonus: the 6× HTML / 4× 404 /
  2× fetch-failed triage failures disappear entirely once triage is no longer an HTTP call — a
  failure mode removed rather than handled.

### Block 4 — demo hardening + GTM start

Framework arrives; full offline demo with the pull-the-cable moment. Script covers the full loop:
three scenarios, one destructive with typed confirmation, audit log, one live rollback. One-pager
plus priced pilot offer (6 weeks, €7,500, phase 1 read-only) — every claim in it is covered by
blocks 1–3. MSP list: 20 Linux/hosting-heavy systems houses around Stuttgart/Karlsruhe.

### Block 5 — funnel

Conversations → demos → pilot → angel track, as previously planned. Before pilot start, clear the
four open D-questions as a checklist (alert→API actually wired, secrets/sudo story, per-customer
instance, update path) — pilot-prep blockers, not demo blockers.

### Running outside the blocks

**Section N tooling** — a mechanical guard that `REQUIREMENTS.md` checkbox state and traceability
rows agree. Runs as tooling work whenever there is a gap, not inside a phase.

### Feature freeze — with names

No eighth skill (unless the target MSP stack forces exactly one), no parallel-inference expansion,
no MemPalace/TOON tuning, no web UI. **Phase 17.1 stays closed** — the freeze admits no exceptions
except demonstrated demo blockers. If executive-grade optics become necessary, an HTML export of
the audit trail is one evening's work and suffices.

### Deferred past this sequence

**C** (type drift), **B** (logging architecture), **A3** (`streamObject`), **A2** (per-call-site
budgets), **E**, **F**, **D**, **K** (Qdrant consolidation). None are demo-blocking. Sequence C and
K together when they come up — they touch the same LanceDB files.

Explicitly **not** in scope at any point: tuning latency or retry constants against Gemini's
behaviour. Those numbers expire when the backend moves (see the transfer table in section G).

### The honest sentence

Until block 1 is done, every conversation gets this verbatim:

> *"Diagnosis runs correctly against real systems today — I'm currently re-verifying the
> execute-verify half."*

After that, delete it.

---

## How to use this document

This started as an answer to a maturity questionnaire. It is now the **due-diligence appendix** for
the moment an angel, or a pilot MSP's engineer, asks how mature this really is.

Keep it current. Evidence-based honesty about one's own state is rarer in a pitch than any feature,
and more convincing. Every claim here carries a file:line or an audit-log count precisely so it can
be handed over without rework — and so that a reader who checks finds it accurate.

---

## Appendix — maturity snapshot (2026-07-31)

Derived from 172 session directories, 98 with audit events, 1384 events total. Recorded here
because the same questions will be asked again and the answers should not have to be re-derived.

**Skills: 7 files, 4 domain + 3 infrastructure.**

| Skill | Lines | Domain | Maturity by audit frequency |
|---|---|---|---|
| `postgres-expert` | 75 | connection saturation, deadlocks, slow queries, replication | battle-tested (~100 events) |
| `linux-expert` | 99 | permission denied, disk full, OOM, container exits | battle-tested (~80 events) |
| `log-analysis` | 80 | syslog / JSON / Docker / journald | moderate (14 events) |
| `network-expert` | 120 | HTTP errors, reverse proxy, DNS, Docker networking | light (~12 events) despite being the largest file |
| `planning` | 137 | fix-plan decomposition | infrastructure skill |
| `verification` | 49 | health-check generation | infrastructure skill |
| `memory` | 49 | semantic incident retrieval | infrastructure skill |

**Not covered by any skill:** systemd, Proxmox, Kubernetes, storage/RAID, certificates, DNS as a
system. Three of the four domain skills are Docker-centric.

**Feature status against README claims:**

| Feature | Status | Evidence |
|---|---|---|
| Structured JSON audit trail | ✅ | 1384 events; this entire analysis is the proof |
| Three-tier HITL approval | ✅ | 232 `command_validation`; Y/N gate confirmed live 2026-07-31 |
| Circuit breaker + damage budget | ✅ | 26 triggers, fires reliably |
| Multi-model registry | ✅ | role routing confirmed live |
| Pre-execution snapshots | ✅ | 28 `step-N.json` files on disk |
| Command allowlist/blocklist | ✅ | present in every validation |
| Ink terminal UI | ✅ | phases 19–19.3 |
| DPEV closed loop | 🟡 | implemented; unverified since March — see section I |
| Self-healing executor | 🟡 | 98 attempts, **30 exhausted (31%)**, 13 with progress |
| Session resume | 🟡 | **2 `execution_resume` events total** — effectively untested |
| Log analysis | 🟡 | skill exists, 14 events, one scenario |
| Enriched discovery | 🟡 | env vars / error logs / config paths all returned `(empty)` on 2026-07-31 |
| Automatic rollback | ❌ | 33 failed vs 8 complete — see section H |
| TOON "32k = ~50k effective" | ❓ | observed 0.4% and 1.8% — see section J |

**Reproducible failure modes**, by frequency in the audit trail:

1. Rollback (section H) — 33 failures, structural.
2. Placeholder hallucinations — `<container_user>`, `<PID>`, `<user>`,
   `<IP_ADDRESS_FROM_STEP_2>`, `<python-app-service-name>`; 6 sanity-check catches plus one that
   survived the grounding retry and reached a fix plan.
3. Structured output (section A) — 5 schema-validation failures.
4. Skill-selection transport fragility — 6× received `<!DOCTYPE html>` instead of JSON (wrong
   endpoint), 4× `Error 404`, 2× `fetch failed`, 1× `model 'infrabrain-tech' not found`. These
   are configuration/transport faults, not classification faults — a better classifier fixes none
   of them.
5. Local backend blocked — 3× `model requires more system memory (51.5 GiB) than is available
   (9.4 GiB)`. Same constraint noted in section G.

**Already resolved, do not chase:** `Skill selection failed … diagStart is not defined` appears
6× in historical sessions. Fixed — `src/orchestrator/diagnosis.ts:312` now declares `let diagStart`
before the `try` block.

---

## Appendix — evaluated and rejected: vllm-project/semantic-router

Asked 2026-07-31 whether https://github.com/vllm-project/semantic-router should replace
InfraBrain's own routing. **Conclusion: no — it solves a different problem. Borrow two ideas.**

semantic-router is a Rust request gateway (v0.3, June 2026; ~5.1k stars, 1762 commits, 197 open
issues), Kubernetes-oriented, with ONNX / Candle / OpenVINO classifiers. It sits in front of
OpenAI-compatible backends and decides, per request, **which model** serves it.

InfraBrain's routing is two-stage and does something else: `[TRIAGE]` selects a **skill** (a
Markdown file carrying discovery commands, an allowlist, risk levels, privilege escalation), and
only then does skill frontmatter map a **role** (`default`/`strategic`/`forensic`) to a model.

**Against adopting it:**
- *Wrong granularity.* A skill is not a model. semantic-router has no concept of discovery
  commands, risk classes, or `user: "0"` escalation. It could replace the role→model mapping —
  the smaller half of the problem — not skill selection.
- *Deployment weight.* A Rust gateway plus Kubernetes in front of a Node CLI that runs on a
  laptop or a single rented box.
- *Wrong position in the loop.* InfraBrain's routing decision determines which discovery commands
  execute and which safety policy applies, not merely which model answers. A gateway upstream of
  inference cannot see that.
- *The observed triage failures are not classification failures.* See failure mode 4 above — HTML
  responses, 404s, wrong model names. A better classifier fixes none of them.

**Worth borrowing:**
- *Embedding prefilter ahead of the LLM triage call.* Skill selection currently costs a full
  round trip. With 7 skills, a local embedding comparison is milliseconds, deterministic, and
  offline — and LanceDB is already in the stack. Keep the LLM call as a tiebreaker.
- *Token-level hallucination detection (their "HaluGate").* InfraBrain's `checkForHallucinations`
  is regex-based: it catches the patterns it already knows, which is how one placeholder reached
  a fix plan despite the grounding retry (failure mode 2).

Their category-aware semantic caching overlaps with the Qdrant fix-cache from Phase 16 — worth
comparing implementations, not replacing.
