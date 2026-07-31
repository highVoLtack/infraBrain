---
gsd_state_version: 1.0
milestone: v1.3
milestone_name: The Intelligence Layer
current_phase: 19.3
current_phase_name: dpev-observability
status: executing
stopped_at: "19.3-06 code complete; Task 3 phase-closing human-verify checkpoint OUTSTANDING"
last_updated: "2026-07-31T12:35:25.269Z"
last_activity: 2026-07-31
last_activity_desc: Phase 19.3 Plan 06 code complete — replay parity, keyboard arbitration, cost honesty; awaiting closing UAT
progress:
  total_phases: 10
  completed_phases: 9
  total_plans: 32
  completed_plans: 32
  percent: 90
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-31)

**Core value:** The AI diagnoses, plans, and fixes infrastructure problems autonomously while the human admin retains full control -- every critical action requires approval, every decision is auditable, and the system can be taught any IT system through simple Markdown files.
**Current focus:** Phase 19.3 — dpev-observability

## Current Position

Phase: 19.3 (dpev-observability) — AWAITING CLOSING UAT
Plan: 6 of 6
Status: All 6 plans implemented; 19.3-06 Task 3 human-verify checkpoint outstanding
Last activity: 2026-07-31 — Phase 19.3 Plan 06 code complete (replay parity, keyboard arbitration, cost honesty)

Progress: [██████████] 100% (32/32 plans; phase closes on UAT sign-off)

## Performance Metrics

**Velocity:**

- v1.0: 7 phases, 22 plans (6 days)
- v1.1: 4 phases, 10 plans (1 day)
- v1.2: 9 phases, 24 plans (4 days)
- v1.3: 6 phases, 21 plans (6 days) -- SHIPPED 2026-04-15

**Recent Trend:** Stable -- phases complete in 1-2 sessions each

## Accumulated Context

### Decisions

- [v1.3]: MemPalace in native TypeScript (no Python sidecar, no ChromaDB, no MCP)
- [v1.3]: Qdrant is single vector store for both fix-caching and semantic memory
- [v1.3]: 100% air-gapped, zero external API calls
- [v1.3]: Extract debug.ts pipeline before feature work (prevents merge conflicts)
- [v1.3]: Build backend features before UI (Ink last over stable APIs)
- [14-01]: PQueue concurrency:1 per container via lazy-init Map for discovery mutex
- [14-02]: Pipeline covers D-P only -- execution stays in /execute route for EXEC-03 safety
- [14-02]: Backward-compatible re-exports in debug.ts alongside canonical import updates
- [14-02]: runDiagnosis returns hallucinationError as data -- HTTP handler translates to 422
- [15-01]: Plain TypeScript interfaces for context types (not zod) -- internal types
- [15-01]: Lazy singleton tokenizer pattern for Qwen3 BPE counting
- [15-01]: Worker model threshold at 10 unrecognized lines per CONTEXT.md decision
- [Phase 15-02]: Eviction priority by type: IPs first, then ports, containers, custom, error_codes last
- [Phase 15-02]: Tier 3 fallback: aggressive 1-line compression + drop oldest when no worker model
- [Phase 15-02]: Synchronous saveSnapshot (writeFileSync) for guaranteed audit trail before eviction
- [Phase 15-03]: ContextManager replaces ad-hoc GROUND TRUTH string in pipeline prompt assembly
- [Phase 15-03]: contextWindow defaults to 32768 matching Qwen3 context size
- [Phase 15-03]: checkBudget uses accurate BPE counter; estimateTokens kept as heuristic fallback
- [16-01]: LanceDB seed-row-then-delete for schema-inferred table creation
- [16-01]: CacheStore singleton keyed by dataDir with lazy init promise deduplication
- [16-01]: All cache store operations gracefully degrade (return null/empty, never throw)
- [16-02]: Cache check inserted between noise filter and diagnosis in pipeline
- [16-02]: Fast-path hits skip entire LLM diagnosis/planning/command extraction
- [16-02]: Speculative hits logged but proceed to full LLM (parallel exec is Phase 18)
- [16-02]: Skill invalidation only purges changed files (new files have no cached entries)
- [16-02]: Cache mocks required in all test files that exercise the pipeline
- [Phase 16]: Cache check between noise filter and diagnosis; fast-path skips LLM entirely
- [16-03]: Cache write in execute route is non-critical (try-catch, never affects response)
- [16-03]: Startup invalidation + embedding check run after skill registry with graceful degradation
- [16-04]: Read-then-increment pattern for counter updates in LanceDB (getById before updateStats)
- [Phase 17-01]: WAL uses synchronous appendFileSync for guaranteed write-before-mutation audit trail
- [Phase 17-01]: Memory decayLambda defaults to 0.02 (5x slower than cache 0.1) for long-lived architectural knowledge
- [Phase 17-01]: WAL rotation renames to .wal.1.jsonl (single archive) for simplicity
- [Phase 17-02]: EntityStore getActive() filters expired entities in application layer (LanceDB SQL lacks temporal operators)
- [Phase 17-02]: Entity extractor uses word-boundary regex for 20+ known service names to prevent false positives
- [Phase 17-02]: Container name regex requires at least one hyphen/underscore to distinguish from plain words
- [Phase 17-02]: searchByEntities uses in-app filtering (not SQL IN) due to LanceDB query limitations
- [Phase 17-03]: Embedding resolution moved before cache check so cache+memory share resolved config
- [Phase 17-03]: L3 conditional trigger uses best (max) L2 similarity vs threshold, not average
- [Phase 17-03]: Token budget truncates L3 first (less valuable), then L2 line-by-line
- [Phase 17-03]: Memory mocks required in all test files exercising pipeline (same pattern as cache mocks)
- [Phase 17-04]: Intent classifier uses generateObject with workerModel for structured LLM output (same pattern as router/planner)
- [Phase 17-04]: root_cause sourced from structuredDiagnosis.rootCause (not req.body.diagnosis) for distinct embedding input
- [Phase 17-04]: Memory filing in execute route is non-critical: wrapped in try-catch, never affects response
- [Phase 17-04]: Memory mocks required in all test files importing execute.ts (wal, entity-extractor, memory-search, embedder)
- [Phase 18-01]: InferenceScheduler is a plain object factory (not class) matching createModelRegistry pattern
- [Phase 18-01]: Probe cache uses simple timestamp comparison, not interval-based refresh
- [Phase 18-01]: runParallel wraps task.execute() in timing wrapper, dispatches via Promise.all (rejections handled in wrapper)
- [Phase 18-01]: getMode defaults to 'sequential' before probeBackends is called (safe fallback)
- [Phase 18-02]: InferenceScheduler is optional in DPEVInput -- when absent, pipeline uses sequential mode (zero behavioral change)
- [Phase 18-02]: 122B diagnosis receives raw (unfiltered) discovery context in parallel mode -- large model can handle noise
- [Phase 18-02]: 9B preprocess results enrich planning phase -- noise filter + compaction run inside parallel task
- [Phase 18-02]: Cache check uses raw discovery in parallel mode (noise filter hasn't run yet) -- embedding similarity still valid
- [Phase 18-02]: Health route inferenceMode is purely additive -- existing response fields unchanged
- [Phase 19-01]: Extracted getLayoutMode as pure function from useResponsive for testability without React context
- [Phase 19-01]: usePanel implemented as mutable state factory (not React useState) for direct testability
- [Phase 19-01]: parseSSEStream persists event/data state across chunk boundaries for split-chunk resilience
- [Phase 19-01]: @inkjs/ui@2 installs cleanly with Ink v7 -- no compatibility wrappers needed
- [Phase 19-02]: Module-scoped Map keyed by sessionId for cache approval resolvers (concurrent session safety)
- [Phase 19-02]: onEvent/requestCacheApproval optional in DPEVInput -- when absent, pipeline unchanged (zero behavioral change)
- [Phase 19-02]: Token streaming uses streamDiagnosis when onEvent provided -- runDiagnosis still needed for structured output
- [Phase 19-02]: SSE routes mounted after existing REST routes for backward compatibility
- [Phase 19-03]: ApprovalDestructive uses useInput character-by-character instead of TextInput for reliable ink-testing-library testability
- [Phase 19-03]: React 19 batched state updates require setTimeout(50ms) flush in ink-testing-library tests for post-input re-render verification
- [Phase 19-03]: StepCard uses @inkjs/ui Spinner for running status, static Unicode icons for other states
- [Phase 19-05]: Pure function extraction pattern for every Ink component (getPanelConfig, parseHealthData, formatSessionItem, etc.)
- [Phase 19-05]: Text domain badges [D]/[P]/[N] instead of emoji for terminal compatibility
- [Phase 19-05]: EntityStoreReader interface for dependency injection in entities route
- [Phase 19-05]: GET /entities queries all 6 entity types and deduplicates (EntityStore.getActive requires entityType param)
- [Phase 19-05]: Windowed session rendering (max 20) to prevent terminal performance issues per RESEARCH.md Pitfall 3
- [Phase 19-04]: dpevReducer exported as pure function (not inside hook) for direct unit testing without React context
- [Phase 19-04]: shouldShowCacheHitBanner disambiguates cache hit vs execution approval by checking pendingApproval absence
- [Phase 19-04]: APPROVAL_RESPONSE resumes to 'executing' if executionSteps exist, 'streaming' otherwise (context-aware)
- [Phase 19-04]: DPEVPanel dual-mode: prompt prop activates live SSE streaming, replaySession renders read-only state
- [Phase 19-06]: Gemini Cloud provider via LLM_API_KEY env var and config.json apiKey for cloud backend support
- [Phase 19-06]: DPEV reducer handles phases arriving as 'complete' without prior 'active' (robust for varied backends)
- [Phase 19-06]: Session panel filters 'unknown' entries for clean session display
- [Phase 19-06]: Persistent command input always visible at bottom of screen
- [Phase 19-06]: Health check trailing slash fix and API key propagation for Gemini-compatible endpoints
- [Phase 19.1-01]: DPEV phase audit calls wrapped in try-catch as non-critical path (pipeline never fails due to audit logging)
- [Phase 19.1-01]: Per-session AuditLogger created per SSE request for correct audit.jsonl routing
- [Phase 19.1-01]: baseDir added to StreamDebugRouteDeps (defaults to process.cwd()) for session directory derivation
- [Phase 19.1-01]: Session persistence non-critical: all store operations wrapped in try-catch
- [Phase 19.1-02]: buildReplayState sorts entries ASC before processing (API returns DESC) for correct phase ordering
- [Phase 19.1-02]: Backward compat: buildReplayState handles both dpev_phase_start and old phase_start event types
- [Phase 19.1-02]: Entity refreshKey incremented on session select and prompt dismiss (Esc) for two refresh triggers
- [Phase 19.1-02]: Session filter removed eventCount>0 gate since Plan 01 provides real targets for in-progress sessions
- [Phase 19.1-02]: Session panel polls every 10s for fresh data during active SSE sessions
- [Phase 19.3-01]: computeCost returns null (not 0) for unknown models so the UI renders an em-dash instead of a false $0
- [Phase 19.3-01]: MarkdownView renders MDAST directly to Ink Box/Text -- no ANSI string boundary, avoids chalk non-TTY auto-disable
- [Phase 19.3-01]: MarkdownView memoizes the parsed AST via React.useMemo keyed on children to survive streaming re-renders
- [Phase 19.3-01]: npx tsc --noEmit unusable as a phase gate: 8 pre-existing zod v4 / ai v6 / lancedb v0.27 type-drift errors predate 19.3
- [Phase 19.3-02]: req.on('close') is not a disconnect signal on http.IncomingMessage -- it fires when the request body stream ends, so per-session cleanup must live only in the finally block
- [Phase 19.3-02]: dpev:usage carries a real locally-counted inputTokens (Qwen3 BPE) with null output/total/cost per D-11 -- a partial input-only cost would understate the real figure
- [Phase 19.3-02]: substatus for the parallel path is emitted at dispatch time before scheduler.runParallel, not inside task.execute
- [Phase 19.3-02]: /status aggregates each dashboard section in its own try/catch -- store failures degrade to 0/null, never HTTP 500
- [Phase 19.3-03]: handleSSEEvent exported at module scope — SSE routing bugs (D-17) are invisible to reducer-only tests
- [Phase 19.3-03]: USAGE_UPDATE matches phases by name right-to-left — usage arrives after PHASE_COMPLETE
- [Phase 19.3-03]: timerColor checks 'complete' before 'execution' so finished execution phases fade to gray
- [Phase 19.3-05]: StatusOverlay parses latestCall when present rather than hardcoding undefined — a locked field shape must be wired to be testable
- [Phase 19.3-05]: context.currentTokens stub resolved as an optional sessionTokens prop seam — lifting useDPEV out of DPEVPanel is a Rule 4 architectural change
- [Phase ?]: 19.3-04: DPEV keyboard map extracted as exported pure helpers (handlePhaseInput/isPhaseInputActive/virtualFocusedIndex) — LiveDPEVPanel cannot be mounted in tests without an EventSource, so an inline useInput closure would have shipped D-03 uncovered
- [Phase ?]: 19.3-04: PHASE_FOCUS bounds clamping stays in the reducer only; the input handler dispatches unclamped indices
- [Phase 19.3-06]: One keyboard owner resolved by resolveKeyboardOwner(ctx) — every Ink input consumer derives isActive/activeFocus from that single value, never its own boolean. CommandInput was the only consumer without a gate, which is why j/k, Esc and an approval's 'n' all reached the prompt
- [Phase 19.3-06]: The global s/g shortcut is scoped to the dpev-panel owner only — SessionPanel and EntityPanel have a '/' search mode that accumulates printable characters
- [Phase 19.3-06]: useDPEV stays inside DPEVPanel; the panel reports a two-field primitive projection upward (projectLiveStatus) instead of lifting state to App. Lifting would need a DPEVAction RESET and would lose the prompt-keyed remount — Rule 4 cost for two scalars
- [Phase 19.3-06]: Session cost renders $– when no phase reported a non-null costUsd — the client recovers "nothing to sum" vs "summed to zero" from per-phase usage, so session-usage.ts needs no change
- [Phase 19.3-06]: buildReplayState merges steps by stepIndex mirroring the STEP_UPDATE reducer, and skips execution_start envelopes with no stepIndex (executor.ts:86 logs a plan-level one that would otherwise become a phantom step)
- [Phase 19.3-06]: TERM-UX04/07/08 left Planned — the arbitration is correct in code and unit-covered, but no test can drive a live SSE session, and TERM-UX08's "step output" clause is blocked by the executor's audit payload

### Pending Todos

- **[MODEL-QUALITY-001]** Investigate Gemini 2.5-pro vs. Ollama 122B infra-diagnosis quality.
  User observed "damals Ollama 122B hat's gepackt, jetzt mit Gemini wackelt's" during Phase 19.2 live UAT.
  Scope: side-by-side same broken-nginx scenario, same prompts, compare diagnosis accuracy + fix-plan
  viability. Outcome decides whether (a) Gemini prompts need tuning, (b) route strategic calls to
  local Ollama when available, or (c) multi-model consensus. Not UX — separate phase or todo cleanup
  after Phase 19.3 (DPEV Observability) ships. Captured 2026-04-17.

- **[V2-CAVEMAN-001]** Nano-LLM Distillation Pipeline (v2.0 feature).
  Build Caveman distillation: Qwen 2.5 1.5B-multilingual (or similar nano) compresses completed
  session artifacts into emoji + hanzi high-density encoding. Target: 80-90% token savings on
  long-term memory so a whole year of IT history fits into one Gemini prompt. Writes distilled_payload
  column (schema prepared in Phase 17.1). Belongs to v2.0 — not before. Captured 2026-04-17.

- **[V2-DUAL-RETRIEVAL-001]** Dual-Track LanceDB Retrieval (v2.0 feature).
  Retrieval stays on raw-text BGE-M3 vectors (embeddings need natural language for accurate similarity),
  but the payload that gets injected into the LLM context is the distilled_payload (compressed
  emoji/hanzi). Orthogonal to [V2-CAVEMAN-001] — this is the READ side, Caveman is the WRITE side.
  Both ship together in v2.0. Captured 2026-04-17.

### Blockers/Concerns

- MemPalace TypeScript data model: RESOLVED -- native TypeScript implementation shipped in Phase 17
- vLLM concurrent 7B+32B on single 32GB GPU: RESOLVED -- InferenceScheduler with graceful fallback shipped in Phase 18
- Qdrant BGE-M3 embeddings: RESOLVED -- LanceDB embedded store used for both fix-caching (Phase 16) and semantic memory (Phase 17)
- TERM-UX04 keyboard arbitration: RESOLVED in 19.3-06 -- resolveKeyboardOwner/resolveEscapeAction in src/ui/App.tsx. j/k no longer leak, Esc collapses the focused phase before exiting. Not yet observed live; first item for the phase-closing UAT
- Approval keystrokes leak into CommandInput: RESOLVED in 19.3-06 -- CommandInput stands down whenever any other surface owns the keyboard. Pinned by a named regression test with a control case. Was safety-relevant (a live command one Enter from submission)
- **OPEN — replay cannot show step output.** src/execution/executor.ts:341 is the only step-level audit emission in src/ and writes {stepIndex, command, exitCode}; step_start/step_failed are declared in AuditEventType but never emitted. buildReplayState already reads risk/target/totalSteps/stdout/stderr when present, so the fix is one file on the producer side. This is what keeps TERM-UX08 Planned. Detail in 19.3 deferred-items.md
- **OPEN — Phase 19.3 closing UAT not run.** 19.3-06 Task 3 is a blocking human-verify gate needing a live LLM backend + Docker demo stack. Run `npm run dev` with NO arguments, then type `debug nginx 502` into the Ink prompt -- any CLI argument takes the one-shot Commander path (src/index.ts:118) and never renders Ink

## Session Continuity

**Resume file:** .planning/phases/19.3-dpev-observability/19.3-06-PLAN.md

Last session: 2026-07-31
Stopped at: 19.3-06 code complete (all 6 plans implemented); Task 3 phase-closing human-verify checkpoint OUTSTANDING
Resume: Live UAT -- `npm run dev` (no arguments), then type `debug nginx 502` at the prompt. Verify j/k + Enter + Esc phase navigation first (TERM-UX04, newly reachable), that `n` at a [Y/n] approval no longer echoes into the command box, the session footer cost, and the replay round trip. Then mark requirements and close the phase.

## Performance Metrics

| Phase | Plan | Duration | Notes |
|-------|------|----------|-------|
| Phase 19.3 P01 | 10 min | 3 tasks | 8 files |
| Phase 19.3 P02 | 20 min | 3 tasks | 11 files |
| Phase 19.3 P03 | 13 min | 2 tasks | 5 files |
| Phase 19.3 P05 | 14 min | 1 tasks | 3 files |
| Phase 19.3 P04 | ~22 min | 1 tasks | 3 files |
| Phase 19.3 P06 | ~40 min | 5 tasks | 5 files |
