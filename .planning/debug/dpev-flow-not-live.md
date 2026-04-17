---
slug: dpev-flow-not-live
status: root-cause-found
trigger: |
  DATA_START
  After shipping Phase 19.2 (E2E Debug Flow), live UAT reveals the new D→P→E→V flow is not
  actually wired end-to-end in the Ink CLI. User ran `ngix 502` (note the typo) against
  gemini-2.5-pro and observed three distinct regressions.

  Symptom 1 (PRIMARY): After PLAN phase completes (23s), the session goes directly to
  "Session complete" without showing the new plan-approval UI, without streaming execution
  steps, and without running verification. The Phase 19.2 backend work (stream-debug.ts
  plan-approval gate, executePlan chaining, dpev:verification event) does not appear to
  be hit at all.

  Symptom 2: 30-60 seconds of silence between typing the prompt and the first DISCOVERY
  event appearing. The new `dpev:phase discovery active` event (pipeline.ts:168) from
  Phase 19.2 is supposed to fire BEFORE discovery commands run, yielding immediate feedback.

  Symptom 3: Second attempt with the same `ngix 502` prompt shows DIAGNOSIS running for
  1m 9s then failing with "Error / No output generated. Check the stream for errors."
  First attempt succeeded, second attempt failed with empty stream.

  Symptom 4 (UX wish, not blocking): diagnosis/plan output is raw Markdown-ish text —
  user wants a nicer terminal renderer (marked-terminal, ink-markdown, cli-markdown, etc.)

  Two targeted questions the user wants answered first:
  Q1: Which CLI endpoint does the `>  ngix 502` prompt actually hit — POST /stream/debug
      (the new Phase 19.2 route) or POST /execute (the old route)? grep the Ink code.
  Q2: Does "No output generated" reproduce on ALL prompts, or only on `ngix 502`?
      (Hypothesis: typo -> skill-routing fails -> empty stream / LLM returns nothing)
  DATA_END
created: 2026-04-17T10:50:00Z
updated: 2026-04-17T11:30:00Z
---

# Debug Session: DPEV Flow Not Live

## Symptoms

- **Expected:** After user types a debug prompt, Ink UI shows: (a) immediate
  DISCOVERY active indicator within <1s of submit, (b) PLAN rendered as structured
  PlanView with Y/N approval prompt, (c) on Y, execution steps stream live with
  per-step approval for write/destructive, (d) verification result displayed
  after execution. Session status only moves to "completed" after verification.
- **Actual:** Flow stops after PLAN — "Session complete" appears immediately
  with no approval UI, no execution, no verification. Also 30-60s silent gap
  before DISCOVERY starts showing activity. Second attempt with same prompt
  fails with "No output generated" after 1m 9s DIAGNOSIS hang.
- **Error messages:**
  - "Session complete (019d96f3)" shown after PLAN, despite Phase 19.2 code
    requiring plan-approval gate before completion.
  - "Error / No output generated. Check the stream for errors." on 2nd run.
- **Timeline:** Started after merging Phase 19.2 (commits af312cf..4b22e12).
  Before Phase 19.2, the old flow worked: D+P only via /execute. Phase 19.2
  added E+V to /stream/debug but the Ink CLI may still be wired to the old
  route.
- **Reproduction:**
  1. `npm run dev` (Ink UI starts on port 3001)
  2. Type prompt `ngix 502` (or other debug prompts) at the `>_` input
  3. Observe: DISCOVERY -> DIAGNOSIS -> PLAN -> "Session complete"
     (no plan-approval step, no execution, no verification)
  4. Retry same prompt -> may hang on DIAGNOSIS and emit empty-stream error.

## Current Focus

- **hypothesis:** CONFIRMED (partially) — the Ink CLI DOES call /stream/debug
  correctly. The flow-stop bug is in the backend `hasActionablePlan` gate:
  when `fixPlan` is undefined (silent planning failure on typo prompt), the
  plan-approval gate is skipped and `dpev:complete success` fires immediately.
  The 30-60s silence is caused by LLM triage (selectSkill) running BEFORE the
  first SSE event is emitted.
- **test:** Traced full input pipeline: CommandInput → handleCommand →
  parseInfraCommand → setActivePrompt → DPEVPanel → LiveDPEVPanel → useDPEV
  → useSSE POST /stream/debug → runDPEV → stream-debug.ts hasActionablePlan gate.
- **expecting:** Confirmed that endpoint wiring is correct. Bugs are in (a)
  stream-debug.ts plan-approval gate falls through on undefined fixPlan and
  (b) pipeline.ts emits discovery active AFTER triage, not before.
- **next_action:** Present findings to user for review before applying fixes.
- **reasoning_checkpoint:** null
- **tdd_checkpoint:** null

## Evidence

- timestamp: 2026-04-17T11:05:00Z
  finding: Q1 ANSWERED — The Ink UI correctly POSTs to /stream/debug.
  files:
    - src/ui/hooks/useDPEV.ts:304 — useSSE url is ${apiBaseUrl}/stream/debug with method POST and body { prompt }
    - src/ui/panels/DPEVPanel.tsx:218 — plan-approve POSTs to /stream/debug/plan-approve (Phase 19.2 endpoint)
    - src/ui/panels/DPEVPanel.tsx:242 — step-approve POSTs to /stream/debug/step-approve (Phase 19.2 endpoint)
  conclusion: Frontend-to-backend wiring is correct. The old /execute route is NOT hit.
    Hypothesis in Current Focus was WRONG.

- timestamp: 2026-04-17T11:10:00Z
  finding: Symptom 1 ROOT CAUSE — backend skips plan-approval gate when fixPlan is undefined
  files:
    - src/api/routes/stream-debug.ts:201 — `const hasActionablePlan = !!(dpevResult.fixPlan && dpevResult.fixPlan.steps.length > 0);`
    - src/api/routes/stream-debug.ts:239-241 — "No actionable plan: legacy behavior -- mark completed, emit dpev:complete"
      sends `dpev:complete { sessionId, status: 'success' }` and ends session
    - src/orchestrator/pipeline.ts:814-817 — planning wrapped in try/catch. On planErr,
      fixPlan stays undefined; error is LOGGED to auditLogger but NOT surfaced to user
      and NOT rethrown. Session silently completes.
  conclusion: For any prompt that results in fixPlan being undefined OR having 0 steps
    (e.g. typo like "ngix 502" causes LLM to fail parsing, planning silently fails),
    the backend treats this as SUCCESS and emits dpev:complete without ever sending
    dpev:plan-approval. Frontend status goes from 'streaming' directly to 'complete'.
    This is the PRIMARY bug for Symptom 1. The plan-approval UI never renders because
    the plan-approval SSE event is never emitted.

- timestamp: 2026-04-17T11:15:00Z
  finding: Symptom 2 ROOT CAUSE — discovery active event emitted AFTER triage LLM call
  files:
    - src/orchestrator/pipeline.ts:130-136 — `selectSkill()` runs triage LLM BEFORE line 168 emits
      the first dpev:phase discovery active event.
    - src/orchestrator/router.ts:80-86 — selectSkill calls generateObject (LLM call). With
      gemini-2.5-pro, this can take 30-60s, exactly matching the reported silent gap.
    - No SSE event fires during triage — no "triage active" phase exists, and
      the first event the UI receives is `dpev:phase discovery active` at pipeline.ts:168,
      which happens only AFTER selectSkill completes.
  conclusion: The 30-60s silence is not a bug in Phase 19.2 — it's a pre-existing issue that
    Phase 19.2 partially addressed (by adding dpev:phase discovery active) but didn't
    fully fix. The fix requires emitting a dpev:phase triage|routing active event
    immediately on POST /stream/debug, before selectSkill is called, so the UI shows
    something ("Routing skill...") during the triage wait.

- timestamp: 2026-04-17T11:20:00Z
  finding: Symptom 3 ROOT CAUSE — "No output generated" is raw LLM error on typo prompt
  files:
    - src/orchestrator/pipeline.ts:683-691 — streamDiagnosis emits dpev:token chunks
      but then `runDiagnosis` is called a SECOND time at line 694 for structured
      output (generateObject with StructuredDiagnosisSchema).
    - src/orchestrator/diagnosis.ts:317 — `generateObject({ model, schema, system, prompt })`.
      When gemini-2.5-pro cannot produce a valid object for the schema (e.g. because the
      prompt `ngix 502` is ambiguous), it either throws or returns an empty/invalid object.
    - src/orchestrator/diagnosis.ts:333-338 — On generateObject throw, falls back to
      generateText via provider.generateCommand. If that also returns empty string,
      diagnosis = "" (no error raised).
    - src/api/routes/stream-debug.ts:242-247 — The outer try/catch at line 183-247 catches
      any throw from runDPEV and emits dpev:error with `message: err.message`. The exact
      text "No output generated. Check the stream for errors." is NOT in our code — it's
      likely the raw error message from the AI SDK (generateObject) when gemini returns
      an empty or malformed response.
    - Run 1 vs Run 2 difference is explained by transient LLM behavior: gemini-2.5-pro
      sometimes produces *something* parseable for the typo on attempt 1 (hence PLAN
      completing in 23s and "Session complete" appearing), and on attempt 2 fails to
      produce structured output or times out (hence 1m 9s hang + empty stream error).
  conclusion: The typo `ngix 502` confuses the LLM, causing planning to either silently
    fail (Run 1) or the diagnosis itself to fail with an empty response (Run 2).
    This is a USER-FACING ROBUSTNESS bug — the pipeline should have guardrails when
    diagnosis produces empty output, and should surface a clear error to the user rather
    than either silently completing or showing a raw LLM error string.

- timestamp: 2026-04-17T11:25:00Z
  finding: ADDITIONAL CONCERN — potentially stale useSSE closure on prompt change
  files:
    - src/ui/hooks/useSSE.ts:67-127 — useEffect dependency array is `[url, stableOnEvent]`.
      The `options` object (which contains `body: { prompt }`) is NOT in the deps array.
      If the user submits a second prompt without unmounting the DPEVPanel (e.g. by
      dispatching from inside the same live session), useSSE will NOT reconnect.
    - src/ui/App.tsx:347-363 — DPEVPanel is rendered without a `key={activePrompt}` prop.
      When activePrompt changes, React reuses the same LiveDPEVPanel instance rather
      than remounting it. Combined with the above stale-options bug, this means the
      second prompt submission would not trigger a fresh /stream/debug POST — the
      existing SSE connection (already closed) simply stays stale.
  conclusion: This is a SECONDARY bug that may not affect the current reproduction
    (which is a single submit flow), but it is a latent issue for users who submit
    multiple prompts in a session. Worth addressing but not blocking Symptom 1-3 fix.

## Eliminated Hypotheses

- Hypothesis: Ink CLI still calls old /execute route. FALSIFIED — grep confirmed
  useDPEV and DPEVPanel use /stream/debug and its Phase 19.2 sub-endpoints.

## Resolution

### Root Cause Summary

**THREE INDEPENDENT BUGS** are causing the three symptoms:

**Bug A (Symptom 1 — PRIMARY):** stream-debug.ts silently treats
"no fixPlan" as success and emits dpev:complete without ever firing
the dpev:plan-approval event. The legacy `hasActionablePlan` branch
at stream-debug.ts:239-241 is unreachable in the happy-path UAT but
reachable whenever planning silently fails (typo prompt, LLM returns
unparseable JSON, etc.), which is exactly the user's live test case.

**Bug B (Symptom 2):** pipeline.ts:168 emits `dpev:phase discovery active`
AFTER selectSkill() at pipeline.ts:130-136 returns. With a slow triage
model (gemini-2.5-pro), this gap is 30-60s. The UI has no "routing"
phase to render, so the user sees silence.

**Bug C (Symptom 3):** diagnosis.ts silently accepts empty diagnosis
from generateCommand fallback at line 337. The full pipeline then has
nothing to plan against, leading to either silent completion or a raw
"No output generated" error from the AI SDK surfaced via dpev:error.

### Recommended Fixes

**Fix A (Symptom 1):** In `src/api/routes/stream-debug.ts`, when
`hasActionablePlan` is false, do NOT emit `dpev:complete success`. Either:

1. If `dpevResult.fixPlan` is missing OR has zero steps, emit a
   `dpev:error { message: "Planning produced no actionable steps. Try
   rephrasing your prompt (e.g. 'debug nginx 502' instead of 'ngix 502')." }`
   and then `dpev:complete { status: 'failed' }`.

2. Alternatively, emit `dpev:plan-approval` with an empty fixPlan.steps
   array and let the UI show "No plan generated, re-prompt?" — but the
   first option (explicit error) is cleaner.

File + line to change:
- `src/api/routes/stream-debug.ts:201-241` — tighten the
  `hasActionablePlan` branch: when false, emit `dpev:error` with a
  user-friendly message, mark session `failed`, then emit
  `dpev:complete status='failed'`. Do NOT emit `dpev:complete success`.

**Fix B (Symptom 2):** In `src/orchestrator/pipeline.ts`, emit
`dpev:phase routing active` immediately at the top of runDPEV, BEFORE
selectSkill at line 130. Add a corresponding `complete` event after
selection.

File + line to change:
- `src/orchestrator/pipeline.ts:~119` (before line 122) — add
  `input.onEvent?.('dpev:phase', { phase: 'routing', model: triageModelId, status: 'active' });`
- `src/orchestrator/pipeline.ts:~136` (after selectSkill) — add
  `input.onEvent?.('dpev:phase', { phase: 'routing', model: triageModelId, status: 'complete' });`

Then update `src/ui/components/DPEVPhaseHeader.tsx` (or wherever phase
labels are rendered) to accept 'routing' as a valid phase with a nice
label like "Routing skill".

**Fix C (Symptom 3):** In `src/orchestrator/diagnosis.ts:337`, after
`diagnosis = await provider.generateCommand(...)`, check for empty
diagnosis and throw a clear error.

File + line to change:
- `src/orchestrator/diagnosis.ts:337-338` — add guard:
  ```ts
  diagnosis = await provider.generateCommand(prompt, systemPrompt, preferredRole);
  if (!diagnosis || diagnosis.trim().length === 0) {
    throw new Error(
      `Diagnosis returned empty output. The LLM could not process the prompt. ` +
      `Try rephrasing (e.g. avoid typos or ambiguous terms).`
    );
  }
  ```

Optional / secondary:
- `src/ui/App.tsx:349` — add `key={activePrompt}` prop on the DPEVPanel
  instance for the live-prompt branch. This ensures useSSE remounts and
  makes a fresh POST /stream/debug on every submit, avoiding the stale
  closure issue.

### Why Tests Missed This

1. All stream-debug.ts tests happy-path: they set up fake runDPEV return
   values with a populated fixPlan. None of them exercise the
   hasActionablePlan=false branch with a successful-looking pipeline
   (discovery OK, diagnosis OK, just no plan).
2. Pipeline tests inject mock LLMs that always return parseable output.
   The "LLM returns empty string for typo prompt" scenario was never
   covered.
3. Discovery spinner was verified as "fires before runParallelDiscovery"
   — correct — but not as "fires before selectSkill". The triage gap
   was not part of any verification truth or TERM-E0x requirement.
