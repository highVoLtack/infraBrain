---
phase: 16-qdrant-fix-caching
plan: 02
subsystem: cache
tags: [cache-lookup, pipeline-integration, invalidation, graceful-degradation, tdd]

# Dependency graph
requires:
  - phase: 16-qdrant-fix-caching
    plan: 01
    provides: CacheStore, embedder, confidence scoring, cache types
  - phase: 15-auto-compact-context
    provides: Noise-filtered discovery context used as cache embedding input
provides:
  - checkCache() for pipeline-facing cache lookup with confidence classification
  - storeFixInCache() for writing successful fixes to cache
  - recordFixOutcome() for tracking fix success/failure
  - hashSkillFiles() and runStartupInvalidation() for skill-based cache purge
  - Pipeline cache check between noise filter and diagnosis
  - CacheHitProvenance in DPEVResult for display
  - noCache flag on DPEVInput for --no-cache CLI support
affects: [16-03-cli-cache-management, 18-parallel-inference]

# Tech tracking
tech-stack:
  added: []
  patterns: [cache-before-diagnosis-pipeline-insertion, skill-hash-invalidation, three-tier-cache-result]

key-files:
  created:
    - src/cache/cache-lookup.ts
    - src/cache/invalidation.ts
    - tests/cache/cache-lookup.test.ts
    - tests/cache/invalidation.test.ts
    - tests/cache/degradation.test.ts
  modified:
    - src/orchestrator/pipeline.ts
    - tests/orchestrator/pipeline.test.ts
    - tests/api/routes.test.ts
    - tests/e2e/poc-nginx-502.test.ts
    - tests/e2e/poc-postgres-connleak.test.ts
    - tests/e2e/postgres-loop-guard.test.ts

key-decisions:
  - "Cache check inserted between noise filter and enforceDPEVSequence('diagnosis') in pipeline"
  - "Fast-path hits skip entire LLM diagnosis/planning/command extraction pipeline"
  - "Speculative hits logged but proceed to full LLM diagnosis (parallel execution is Phase 18)"
  - "Invalidation compares only previously-known files (new skills do not trigger purge)"
  - "Cache mocks added to all test files that exercise the pipeline"

patterns-established:
  - "Three-tier cache classification: fast-path (>=0.85), speculative (0.75-0.85), miss (<0.75)"
  - "Pipeline cache mock pattern: vi.mock cache-lookup + lance-store in test files"
  - "Skill hash invalidation: SHA-256 per .md file, stored as JSON, compared on startup"

requirements-completed: [CACHE-03, CACHE-04, CACHE-05, CACHE-07]

# Metrics
duration: 8min
completed: 2026-04-10
---

# Phase 16 Plan 02: Pipeline Integration Summary

**Cache lookup wired into DPEV pipeline with three-tier classification, skill-based invalidation, and graceful degradation on all failure modes**

## Performance

- **Duration:** 8 min
- **Started:** 2026-04-10T18:31:29Z
- **Completed:** 2026-04-10T18:44:00Z
- **Tasks:** 2
- **Files modified:** 11

## Accomplishments
- Cache lookup classifies results into fast-path/speculative/miss based on vector similarity thresholds
- Pipeline skips LLM diagnosis entirely on fast-path cache hit, returning cached fix in DPEVResult
- Skill file changes detected on startup trigger per-skill cache purge via SHA-256 hash comparison
- All cache operations degrade gracefully (null store, failed embedding, exceptions) -- never throw into pipeline
- noCache flag bypasses cache check entirely for --no-cache CLI support
- 23 new cache tests + all 756 existing non-Docker tests passing

## Task Commits

Each task was committed atomically:

1. **Task 1: Cache lookup, invalidation, and degradation (TDD)** - `8ac0d1b` (test+feat)
2. **Task 2: Pipeline integration -- cache check before diagnosis** - `a265470` (feat)

## Files Created/Modified
- `src/cache/cache-lookup.ts` - checkCache, storeFixInCache, recordFixOutcome with graceful degradation
- `src/cache/invalidation.ts` - hashSkillFiles (SHA-256), runStartupInvalidation (per-skill purge)
- `src/orchestrator/pipeline.ts` - Cache check block between noise filter and diagnosis, CacheHitProvenance, noCache
- `tests/cache/cache-lookup.test.ts` - 9 tests for cache classification and store operations
- `tests/cache/invalidation.test.ts` - 7 tests for hash comparison and selective purge
- `tests/cache/degradation.test.ts` - 7 tests for graceful degradation on all failure paths
- `tests/orchestrator/pipeline.test.ts` - Added cache mocks
- `tests/api/routes.test.ts` - Added cache mocks
- `tests/e2e/poc-nginx-502.test.ts` - Added cache mocks
- `tests/e2e/poc-postgres-connleak.test.ts` - Added cache mocks
- `tests/e2e/postgres-loop-guard.test.ts` - Added cache mocks

## Decisions Made
- Cache check inserted after ContextManager/noise filter and before enforceDPEVSequence('diagnosis') to use filtered discovery as embedding input
- Fast-path returns abbreviated DPEVResult with cached diagnosis + fix plan, skipping all LLM calls
- Speculative hits are logged but NOT executed in parallel (Phase 18 territory)
- Skill invalidation only purges entries for files that existed before AND changed (new files have no cached entries to purge)
- Added cache mocks to all 5 test files that exercise the pipeline to prevent real LanceDB/embedding calls

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added cache mocks to e2e and API test files**
- **Found during:** Task 2 (Pipeline integration)
- **Issue:** E2e and API tests that exercise the pipeline timed out because generateEmbedding retries 3 times against unreachable vLLM server
- **Fix:** Added vi.mock for cache-lookup.js and lance-store.js to all test files that import/use the pipeline
- **Files modified:** tests/e2e/poc-nginx-502.test.ts, tests/e2e/poc-postgres-connleak.test.ts, tests/e2e/postgres-loop-guard.test.ts, tests/api/routes.test.ts
- **Verification:** All tests pass without timeout
- **Committed in:** a265470 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Essential fix to prevent test timeouts from embedding API retry delay. No scope creep.

## Issues Encountered
None beyond the test mock issue documented above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Cache lookup and invalidation complete -- pipeline checks cache before every diagnosis
- Ready for Plan 03 (CLI cache management) to add cache clear/list commands and storeFixInCache integration in /execute route
- CacheHitProvenance in DPEVResult ready for Plan 03 display formatting

## Self-Check: PASSED

All 5 created files verified present. Both task commits (8ac0d1b, a265470) verified in git log. 23 new cache tests + 756 existing tests passing.

---
*Phase: 16-qdrant-fix-caching*
*Completed: 2026-04-10*
