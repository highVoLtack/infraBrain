---
gsd_state_version: 1.0
milestone: v1.3
milestone_name: The Intelligence Layer
status: completed
stopped_at: Completed 18-02-PLAN.md
last_updated: "2026-04-15T10:22:19.746Z"
last_activity: 2026-04-15 -- Plan 02 complete (Pipeline parallel inference + health route inferenceMode)
progress:
  total_phases: 6
  completed_phases: 5
  total_plans: 15
  completed_plans: 15
  percent: 100
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-31)

**Core value:** The AI diagnoses, plans, and fixes infrastructure problems autonomously while the human admin retains full control -- every critical action requires approval, every decision is auditable, and the system can be taught any IT system through simple Markdown files.
**Current focus:** v1.3 The Intelligence Layer -- Phase 18 (Parallel Inference)

## Current Position

Phase: 18 of 19 (Parallel Inference)
Plan: 2 of ? executed
Status: Plan 18-02 complete -- Pipeline parallel inference + health route inferenceMode
Last activity: 2026-04-15 -- Plan 02 complete (Pipeline parallel inference + health route inferenceMode)

Progress: [██████████] 100%

## Performance Metrics

**Velocity:**
- v1.0: 7 phases, 22 plans (6 days)
- v1.1: 4 phases, 10 plans (1 day)
- v1.2: 9 phases, 24 plans (4 days)
- v1.3: 6 phases, 13+ plans (4 planned for Phase 17)

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

### Pending Todos

None yet.

### Blockers/Concerns

- MemPalace TypeScript data model has no reference implementation (highest-risk phase)
- vLLM concurrent 7B+32B on single 32GB GPU needs benchmarking (Phase 18)
- Qdrant BGE-M3 embeddings need validation for both error patterns and incident summaries

## Session Continuity

Last session: 2026-04-15T10:05:52.621Z
Stopped at: Completed 18-02-PLAN.md
Resume: Phase 18 Plan 03 (timing benchmarks) or next plan
