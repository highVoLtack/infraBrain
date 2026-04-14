# Roadmap: InfraBrain

## Milestones

- v1.0 MVP -- Phases 1-7 (shipped 2026-03-12) | [Archive](milestones/v1.0-ROADMAP.md)
- v1.1 The Scenario Factory -- Phases 8-11 (shipped 2026-03-13) | [Archive](milestones/v1.1-ROADMAP.md)
- v1.2 The Knowledge Layer -- Phases 12-13.1 (shipped 2026-03-17)
- v1.3 The Intelligence Layer -- Phases 14-19 (in progress)

## Phases

<details>
<summary>v1.0 MVP (Phases 1-7) -- SHIPPED 2026-03-12</summary>

- [x] Phase 1: Foundation and Safety Gates (5/5 plans) -- completed 2026-03-07
- [x] Phase 2: Skill System and Orchestrator (3/3 plans) -- completed 2026-03-08
- [x] Phase 3: Execution Engine and Safety Net (3/3 plans) -- completed 2026-03-08
- [x] Phase 4: Session Management and CLI Polish (4/4 plans) -- completed 2026-03-08
- [x] Phase 5: POC Scenario and Integration (2/2 plans) -- completed 2026-03-08
- [x] Phase 6: Resume Wiring and Audit Completeness (2/2 plans) -- completed 2026-03-12
- [x] Phase 7: Audit Metadata and Integration Polish (3/3 plans) -- completed 2026-03-12

**Total:** 7 phases, 22 plans, 39/39 requirements, 354 tests

</details>

<details>
<summary>v1.1 The Scenario Factory (Phases 8-11) -- SHIPPED 2026-03-13</summary>

- [x] Phase 8: Rolling Context Injection (2/2 plans) -- completed 2026-03-13
- [x] Phase 9: Postgres Failure Scenario (3/3 plans + Engine-First hardening) -- completed 2026-03-13
- [x] Phase 10: Docker Storage Failure Scenario (3/3 plans) -- completed 2026-03-13
- [x] Phase 11: Cross-Scenario Validation and UX Polish (2/2 plans) -- completed 2026-03-13

**Total:** 4 phases, 10 plans, 13/13 requirements, 440 tests, Engine-First architecture

</details>

<details>
<summary>v1.2 The Knowledge Layer (Phases 12-13.1) -- SHIPPED 2026-03-17</summary>

- [x] Phase 12: Linux Filesystem Permission Trap Scenario (3/3 plans) -- completed 2026-03-14
- [x] Phase 12.1: Dynamic Command Rewriter (3/3 plans) -- completed 2026-03-14
- [x] Phase 12.2: Skill-Driven Discovery (2/2 plans) -- completed 2026-03-14
- [x] Phase 12.3: Agnostic Skills + Engine-Proof Rewriter (2/2 plans) -- completed 2026-03-14
- [x] Phase 12.4: Agnostic Skill Redesign (3/3 plans) -- completed 2026-03-14
- [x] Phase 12.5: Intelligent Routing + Framework Merge (3/3 plans) -- completed 2026-03-14
- [x] Phase 12.6: Self-Healing Executor (3/3 plans) -- completed 2026-03-14
- [x] Phase 12.6 Demo: Multi-Fault Validation -- validated 2026-03-15 (5/5 faults)
- [x] Phase 13: Execution Hardening (2/2 plans) -- completed 2026-03-16
- [x] Phase 13.1: vLLM Multi-Model Integration (3/3 plans) -- completed 2026-03-17

**Total:** 9 phases + demo, 24 plans, Engine-First + Self-Healing + Multi-Model

</details>

## v1.3 The Intelligence Layer

- [x] **Phase 14: Pipeline Extraction + Parallel Discovery** - Extract debug.ts into pipeline orchestrator, run discovery commands in parallel with safety mutex (completed 2026-04-10)
- [x] **Phase 15: Auto-Compact Context Management** - Token counting and automatic context compaction at 83% threshold with ground truth pinning (completed 2026-04-10)
- [x] **Phase 16: Qdrant Fix-Caching** - Vector similarity search returns cached fixes in 2s instead of 113s LLM reasoning (completed 2026-04-10)
- [x] **Phase 17: MemPalace Semantic Memory** - Native TypeScript incident memory with temporal knowledge graph and semantic search (completed 2026-04-14)
- [ ] **Phase 18: Parallel Inference Pipeline** - Concurrent 9B pre-processing + 122B reasoning via Promise.allSettled
- [ ] **Phase 19: Ink/React Terminal UI** - Full terminal renderer with live DPEV tracking, streaming output, and rich dashboard

## Phase Details

### Phase 14: Pipeline Extraction + Parallel Discovery
**Goal**: Discovery commands run in parallel (2-5x speedup) on a cleanly extracted pipeline that prevents merge conflicts for all subsequent phases
**Depends on**: Phase 13.1 (unified OpenAI-compat provider)
**Requirements**: EXEC-01, EXEC-02, EXEC-03, EXEC-04
**Success Criteria** (what must be TRUE):
  1. Discovery commands for a multi-container scenario complete in parallel (observable wall-clock speedup vs sequential)
  2. Two commands targeting the same container never execute concurrently (mutex prevents race conditions)
  3. Execution steps remain serial with circuit breaker and damage budget unchanged (safety preserved)
  4. Parallel discovery results appear as a single merged context block in the LLM diagnosis prompt
  5. debug.ts is under 200 lines with pipeline logic extracted to src/orchestrator/
**Plans:** 2/2 plans complete
Plans:
- [x] 14-01-PLAN.md -- Parallel discovery module with per-container mutex (p-queue)
- [x] 14-02-PLAN.md -- Pipeline extraction, diagnosis module, slim debug.ts, fix test imports

### Phase 15: Auto-Compact Context Management
**Goal**: Context window usage is tracked in real-time and automatically compacted before overflow, preserving ground truth while discarding noise
**Depends on**: Phase 14 (pipeline orchestrator is integration point for context hooks)
**Requirements**: CTXT-01, CTXT-02, CTXT-03, CTXT-04, CTXT-05, CTXT-06
**Success Criteria** (what must be TRUE):
  1. Admin can see token count and context usage percentage during a diagnosis session (dev-mode logging or status output)
  2. A self-healing loop that would overflow 32K context triggers compaction automatically and completes without error
  3. Critical data (container names, port numbers, error codes, discovery facts) survives compaction intact
  4. Healthcheck spam and systemd journal noise are filtered out before reaching the LLM
  5. Context compaction fires exactly once per threshold crossing (no recursive summarization loop)
**Plans:** 3/3 plans complete
Plans:
- [x] 15-01-PLAN.md -- Token counter, types, and noise filter (foundation)
- [x] 15-02-PLAN.md -- Ground truth pinning, compactor, and ContextManager (core logic)
- [x] 15-03-PLAN.md -- Pipeline integration, config, and integration tests

### Phase 16: Qdrant Fix-Caching
**Goal**: Repeat errors are resolved in under 2 seconds via vector similarity cache lookup, with zero LLM calls for cache hits
**Depends on**: Phase 15 (auto-compact needed because cache metadata expands context)
**Requirements**: CACHE-01, CACHE-02, CACHE-03, CACHE-04, CACHE-05, CACHE-06, CACHE-07, CACHE-08
**Success Criteria** (what must be TRUE):
  1. Running the same error scenario twice returns a cached fix on the second run (observable in terminal output as "Cache Hit" with provenance)
  2. Cached fix resolves in under 2 seconds (vs 60-120s for LLM reasoning)
  3. InfraBrain starts, diagnoses, and fixes problems normally when LanceDB is unavailable (graceful degradation)
  4. Updating a skill file invalidates stale cached fixes for that skill's domain
  5. LanceDB embedded store initializes automatically in-process (no external services)
**Plans:** 4/4 plans complete
Plans:
- [ ] 16-01-PLAN.md -- Cache types, LanceDB store, BGE-M3 embedder, confidence scoring (foundation)
- [ ] 16-02-PLAN.md -- Cache lookup, pipeline integration, skill invalidation, graceful degradation
- [ ] 16-03-PLAN.md -- Cache write on fix success, provenance display, CLI commands, integration tests

### Phase 17: MemPalace Semantic Memory
**Goal**: InfraBrain remembers every incident it has worked on and uses past experience to improve future diagnoses
**Depends on**: Phase 16 (Qdrant infrastructure proven, shared instance)
**Requirements**: MEM-01, MEM-02, MEM-03, MEM-04, MEM-05, MEM-06, MEM-07, MEM-08, MEM-09
**Success Criteria** (what must be TRUE):
  1. After fixing an incident, admin can ask "what did we fix last week?" and get a semantically relevant answer from memory
  2. A new diagnosis session automatically receives relevant context from past similar incidents (wake-up context layers visible in dev logging)
  3. Infrastructure entities (hostnames, service names, IPs) extracted from diagnostic text appear as searchable knowledge graph entries
  4. Recent incidents score higher than old ones at equal semantic similarity (temporal decay observable in search results)
  5. All memory mutations are recorded in a write-ahead log (audit trail for what was remembered and when)
**Plans:** 4/4 plans complete
Plans:
- [x] 17-01-PLAN.md -- Types, config schema, and write-ahead log (foundation contracts)
- [x] 17-02-PLAN.md -- IncidentStore, EntityStore, entity extractor, memory scoring (data layer)
- [x] 17-03-PLAN.md -- Memory search, wake-up context, pipeline [MEMORY] integration
- [x] 17-04-PLAN.md -- Intent classifier, memory skill, incident auto-filing

### Phase 18: Parallel Inference Pipeline
**Goal**: 9B models pre-process logs and extract patterns while 122B reasons about diagnosis, cutting total inference time
**Depends on**: Phase 15 (auto-compact), Phase 16 (fix-cache), Phase 17 (stable feature set)
**Requirements**: INFER-01, INFER-02, INFER-03, INFER-04, INFER-05
**Success Criteria** (what must be TRUE):
  1. During a diagnosis, 9B intent classification completes in under 200ms before 122B deep reasoning begins
  2. 9B log pre-processing runs concurrently with 122B reasoning (observable via dev-mode timing logs showing overlapping model calls)
  3. With only a single vLLM backend available, inference falls back to sequential mode transparently (no errors, same results)
  4. Separate vLLM instances serve different model sizes without VRAM contention (health check shows multiple backends)
**Plans:** 2 plans
Plans:
- [ ] 18-01-PLAN.md -- InferenceScheduler types, backend probe, parallel dispatch, timing instrumentation
- [ ] 18-02-PLAN.md -- Pipeline parallel inference integration, health route enhancement

### Phase 19: Ink/React Terminal UI
**Goal**: Admin interacts with InfraBrain through a rich, reactive terminal interface with live progress tracking, streaming output, and a status dashboard
**Depends on**: Phase 14-18 (all backend features and SSE endpoints stable)
**Requirements**: TERM-01, TERM-02, TERM-03, TERM-04, TERM-05, TERM-06, TERM-07, TERM-08
**Success Criteria** (what must be TRUE):
  1. Admin sees which DPEV phase is active, which model is being used, and elapsed time -- all updating live during diagnosis
  2. LLM output streams token-by-token in the terminal (not buffered until complete)
  3. Approval prompts render as interactive Ink components (Y/N/details) replacing readline
  4. Terminal output adapts correctly to narrow (80-col) and wide (200-col) terminals without truncation or overflow
  5. All existing CLI commands (`/infra:debug`, `/infra:status`, `/infra:history`, `/infra:resume`) work through the Ink renderer with identical behavior
**Plans:** [To be planned]

## Progress

**Execution Order:** Phases 14 -> 15 -> 16 -> 17 -> 18 -> 19

| Phase | Milestone | Plans | Status | Completed |
|-------|-----------|-------|--------|-----------|
| 1-7 | v1.0 | 22/22 | Complete | 2026-03-12 |
| 8-11 | v1.1 | 10/10 | Complete | 2026-03-13 |
| 12 | v1.2 | 3/3 | Complete | 2026-03-14 |
| 12.1 | v1.2 | 3/3 | Complete | 2026-03-14 |
| 12.2 | v1.2 | 2/2 | Complete | 2026-03-14 |
| 12.3 | v1.2 | 2/2 | Complete | 2026-03-14 |
| 12.4 | v1.2 | 3/3 | Complete | 2026-03-14 |
| 12.5 | v1.2 | 3/3 | Complete | 2026-03-14 |
| 12.6 | v1.2 | 3/3 | Complete | 2026-03-14 |
| 12.6 Demo | v1.2 | -- | Validated | 2026-03-15 |
| 13 | v1.2 | 2/2 | Complete | 2026-03-16 |
| 13.1 | v1.2 | 3/3 | Complete | 2026-03-17 |
| 14 | v1.3 | 2/2 | Complete | 2026-04-10 |
| 15 | v1.3 | 3/3 | Complete | 2026-04-10 |
| 16 | v1.3 | 4/4 | Complete | 2026-04-10 |
| 17 | v1.3 | 4/4 | Complete | 2026-04-14 |
| 18 | v1.3 | 0/2 | Planned | - |
| 19 | v1.3 | TBD | Not started | - |

---
*Roadmap created: 2026-03-07*
*Last updated: 2026-04-14 -- Phase 18 planned (2 plans in 2 waves)*
