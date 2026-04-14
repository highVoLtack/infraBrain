---
phase: 17-mempalace-semantic-memory
plan: 03
subsystem: memory
tags: [semantic-search, temporal-decay, wake-up-context, prompt-injection, pipeline-integration]

# Dependency graph
requires:
  - phase: 17-01
    provides: MemPalace type contracts (IncidentRecord, Wing, MemoryConfig, MemorySearchResult), WAL
  - phase: 17-02
    provides: IncidentStore (vector search, getRecent, getStats), EntityStore (searchByEntities), entity-extractor, memory-scoring
  - phase: 16-qdrant-fix-caching
    provides: CacheStore, embedder (generateEmbedding), pipeline cache check pattern
provides:
  - Cross-session semantic search with temporal decay reranking (searchWithDecay)
  - 4-layer wake-up context builder (L0 identity, L1 recent, L2 filtered search, L3 conditional deep semantic)
  - ContextManager [MEMORY] block injection between Ground Truth and Observations
  - Pipeline memory enrichment between cache check and diagnosis (non-blocking)
affects: [17-04-PLAN]

# Tech tracking
tech-stack:
  added: []
  patterns: [4-layer wake-up context with pinned/evictable split, conditional L3 trigger on weak L2 similarity, non-blocking pipeline enrichment with try-catch]

key-files:
  created:
    - src/memory/memory-search.ts
    - src/memory/wake-up.ts
    - tests/memory/memory-search.test.ts
    - tests/memory/wake-up.test.ts
  modified:
    - src/context/context-manager.ts
    - src/orchestrator/pipeline.ts
    - tests/context/context-manager.test.ts
    - tests/orchestrator/pipeline.test.ts
    - tests/api/routes.test.ts
    - tests/e2e/poc-nginx-502.test.ts
    - tests/e2e/poc-postgres-connleak.test.ts
    - tests/e2e/postgres-loop-guard.test.ts

key-decisions:
  - "Embedding resolution moved before cache check block so both cache and memory can share resolved baseURL/modelId"
  - "L3 conditional trigger uses best L2 similarity (max across all L2 results) compared to threshold, not average"
  - "Token budget enforcement truncates by removing L3 first, then truncating L2 line-by-line"
  - "Memory mocks required in all test files that exercise the pipeline (same pattern as cache mocks)"

patterns-established:
  - "Wake-up context: buildWakeUpContext returns {pinned, evictable} for ContextManager injection"
  - "Non-blocking enrichment: memory failures caught and logged, never block pipeline execution"
  - "ContextManager.injectMemory(): adds pinned+evictable blocks with independent token tracking"
  - "Memory mock pattern: vi.mock memory stores + wake-up in all pipeline-exercising test files"

requirements-completed: [MEM-02, MEM-04]

# Metrics
duration: 17min
completed: 2026-04-14
---

# Phase 17 Plan 03: Search, Wake-Up & Pipeline Integration Summary

**4-layer wake-up context with temporal decay search, conditional L3 entity lookup, [MEMORY] block in ContextManager between Ground Truth and Observations, and non-blocking pipeline enrichment**

## Performance

- **Duration:** 17 min
- **Started:** 2026-04-14T11:33:47Z
- **Completed:** 2026-04-14T11:50:58Z
- **Tasks:** 2 (Task 1 TDD: RED + GREEN, Task 2 auto)
- **Files modified:** 12

## Accomplishments
- searchWithDecay re-ranks vector search results by combining cosine similarity with temporal decay via computeMemoryScore, over-fetching 2x from store for proper reranking
- buildWakeUpContext produces 4 independent layers: L0 identity (incident count, domains, success rate), L1 recent (last 5 as one-liners), L2 filtered vector search, L3 conditional deep entity search
- L3 only fires when best L2 similarity < threshold (0.7), preventing wasteful entity queries when vector search already has strong matches
- ContextManager.injectMemory() adds [MEMORY] block between Ground Truth and Observations with separate pinned/evictable token tracking
- Pipeline calls buildWakeUpContext between cache check and diagnosis in a non-blocking try-catch
- Embedding model resolution moved before cache check block so both cache and memory share resolved config
- Memory mocks added to all 6 test files that exercise the pipeline (preventing LanceDB init attempts)

## Task Commits

Each task was committed atomically (TDD flow for Task 1):

1. **Task 1 RED: Failing memory search + wake-up tests** - `18dd9a8` (test)
2. **Task 1 GREEN: memory-search.ts + wake-up.ts** - `5b78f62` (feat)
3. **Task 2: Pipeline + ContextManager integration** - `86ec9c8` (feat)

## Files Created/Modified
- `src/memory/memory-search.ts` - searchWithDecay with over-fetch reranking, formatIncidentEmbeddingInput
- `src/memory/wake-up.ts` - 4-layer wake-up context builder (L0/L1/L2/L3) with token budget enforcement
- `src/context/context-manager.ts` - Added injectMemory(), [MEMORY] block in buildContext(), memory token tracking
- `src/orchestrator/pipeline.ts` - Memory enrichment block, shared embedding resolution, memory imports
- `tests/memory/memory-search.test.ts` - 6 tests for searchWithDecay sorting, decay, wing filtering, over-fetch
- `tests/memory/wake-up.test.ts` - 9 tests for L0-L3 layers, conditional trigger, graceful degradation, token budget
- `tests/context/context-manager.test.ts` - 5 new tests for injectMemory, buildContext memory order, reset, getUsage
- `tests/orchestrator/pipeline.test.ts` - Added memory store mocks
- `tests/api/routes.test.ts` - Added memory store mocks
- `tests/e2e/poc-nginx-502.test.ts` - Added memory store mocks
- `tests/e2e/poc-postgres-connleak.test.ts` - Added memory store mocks
- `tests/e2e/postgres-loop-guard.test.ts` - Added memory store mocks

## Decisions Made
- Embedding resolution moved before cache check block so both cache and memory enrichment can use resolved embeddingBaseURL/embeddingModelId (avoids duplication)
- L3 conditional trigger compares the best (max) L2 similarity against the threshold, not average -- a single strong match means L3 is unnecessary
- Token budget enforcement for L2+L3 truncates L3 first (less valuable), then truncates L2 line-by-line (progressive degradation)
- Memory mocks follow the same pattern as cache mocks -- required in every test file that exercises the pipeline path

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Added memory mocks to 4 additional test files exercising pipeline**
- **Found during:** Task 2 (Pipeline integration)
- **Issue:** Adding memory imports to pipeline.ts caused 4 test files (routes, 3 e2e) to timeout or fail because they lacked memory store mocks and attempted real LanceDB init
- **Fix:** Added identical memory mock blocks (incident-store, entity-store, wake-up) to routes.test.ts, poc-nginx-502.test.ts, poc-postgres-connleak.test.ts, postgres-loop-guard.test.ts
- **Files modified:** tests/api/routes.test.ts, tests/e2e/poc-nginx-502.test.ts, tests/e2e/poc-postgres-connleak.test.ts, tests/e2e/postgres-loop-guard.test.ts
- **Verification:** routes.test.ts and postgres-loop-guard.test.ts now pass (poc-nginx/postgres e2e still timeout on Docker infra, pre-existing)
- **Committed in:** 86ec9c8 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1: bug fix for missing test mocks)
**Impact on plan:** Essential for preventing test regressions. No scope creep.

## Issues Encountered
None beyond the test mock issue documented above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Memory search and wake-up context fully integrated into pipeline
- ContextManager ready to inject [MEMORY] blocks into LLM prompts
- All memory types imported from src/memory/types.ts (single source of truth)
- Plan 04 (incident auto-filing, memory skill routing) has all prerequisites met
- No blockers for downstream plans

## Self-Check: PASSED

All files verified present, all commits verified in git log.

---
*Phase: 17-mempalace-semantic-memory*
*Completed: 2026-04-14*
