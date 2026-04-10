---
phase: 14-pipeline-parallel-discovery
plan: 02
subsystem: orchestrator
tags: [pipeline, dpev, refactor, extraction, thin-handler, parallel-discovery]

requires:
  - phase: 14-01
    provides: runParallelDiscovery, extractCommandTarget, DiscoveryCommand/DiscoveryResult types
provides:
  - "runDPEV() - full DPEV pipeline orchestrator (discovery -> diagnosis -> planning)"
  - "runDiagnosis() - structured + free-text diagnosis with hallucination checking"
  - "diagnosis.ts module with all diagnostic utilities extracted from debug.ts"
  - "Thin debug.ts HTTP handler (141 lines) delegating to pipeline"
affects: [15-context-management, 16-fix-caching, 17-semantic-memory, orchestrator]

tech-stack:
  added: []
  patterns: [thin-handler-delegation, pipeline-orchestrator, backward-compatible-re-exports]

key-files:
  created:
    - src/orchestrator/pipeline.ts
    - src/orchestrator/diagnosis.ts
    - tests/orchestrator/pipeline.test.ts
  modified:
    - src/api/routes/debug.ts
    - tests/api/debug-dpev.test.ts
    - tests/api/debug-log-filter.test.ts
    - tests/api/sanity-checker.test.ts

key-decisions:
  - "Pipeline covers D-P only (discovery, diagnosis, planning) -- execution stays in /execute route for EXEC-03 safety"
  - "Backward-compatible re-exports in debug.ts alongside canonical import updates for belt-and-suspenders safety"
  - "runDiagnosis returns hallucinationError object instead of HTTP 422 -- HTTP handler translates"

patterns-established:
  - "Thin HTTP handler pattern: routes/*.ts are <200 lines, delegating to orchestrator modules"
  - "Pipeline orchestrator pattern: runDPEV sequences stages, each in its own module"

requirements-completed: [EXEC-03]

duration: 5min
completed: 2026-04-10
---

# Phase 14 Plan 02: Pipeline Extraction + Debug.ts Slimming Summary

**DPEV pipeline orchestrator extracted from 687-line debug.ts into pipeline.ts + diagnosis.ts, reducing handler to 141-line thin HTTP delegate**

## Performance

- **Duration:** 5 min
- **Started:** 2026-04-10T12:35:47Z
- **Completed:** 2026-04-10T12:40:49Z
- **Tasks:** 3
- **Files modified:** 7

## Accomplishments
- Extracted diagnosis.ts with 12 exported functions/types: runDiagnosis, checkForHallucinations, preFilterIfLogHeavy, enforceDPEVSequence, flattenDiagnosis, validatePlanNames, extractCommands, extractContainerNames, DPEVPhase, DiagnosisInput, DiagnosisResult, STRICT_GROUNDING_PENALTY
- Created pipeline.ts with runDPEV() orchestrating the full discovery -> diagnosis -> planning flow using parallel discovery from Plan 01
- Slimmed debug.ts from 687 lines to 141 lines (thin HTTP handler pattern)
- All 639 tests pass with zero regressions (5 e2e Docker-dependent failures pre-existing)
- 4 new pipeline integration tests covering stage ordering, hallucination propagation, field completeness, and missing planning skill

## Task Commits

Each task was committed atomically:

1. **Task 1: Extract diagnosis.ts with all utility functions from debug.ts** - `c0ddcd8` (feat)
2. **Task 2: Create pipeline.ts, slim debug.ts to thin handler, fix all test imports** - `236a1eb` (refactor)
3. **Task 3: Full regression suite + line count verification** - verification only, no commit needed

## Files Created/Modified
- `src/orchestrator/diagnosis.ts` - Diagnostic utilities + runDiagnosis with structured/free-text diagnosis and hallucination checking (375 lines)
- `src/orchestrator/pipeline.ts` - DPEV pipeline orchestrator with runDPEV sequencing discovery -> diagnosis -> planning (335 lines)
- `src/api/routes/debug.ts` - Thin HTTP handler delegating to runDPEV with fallback path (141 lines)
- `tests/orchestrator/pipeline.test.ts` - 4 pipeline integration tests
- `tests/api/debug-dpev.test.ts` - Updated import to diagnosis.ts
- `tests/api/debug-log-filter.test.ts` - Updated import to diagnosis.ts
- `tests/api/sanity-checker.test.ts` - Updated import to diagnosis.ts

## Decisions Made
- Pipeline covers D-P only (discovery, diagnosis, planning) -- execution remains triggered separately via /execute route, preserving EXEC-03 serial execution with circuit breaker and damage budget unchanged
- Backward-compatible re-exports added in debug.ts alongside canonical import updates -- belt-and-suspenders approach prevents breakage during transition
- runDiagnosis returns hallucinationError as data object instead of directly sending HTTP 422, maintaining clean separation between orchestration and HTTP concerns

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Pipeline orchestrator is ready for all v1.3 feature phases to hook into
- Phase 15 (context management) can extend pipeline.ts with rolling context injection
- Phase 16 (fix-caching) can intercept before/after diagnosis in the pipeline
- Phase 17 (semantic memory) can inject memory context at the enriched prompt stage
- No blockers

---
*Phase: 14-pipeline-parallel-discovery*
*Completed: 2026-04-10*

## Self-Check: PASSED
- All 4 created/modified source files exist
- Both task commits verified (c0ddcd8, 236a1eb)
- debug.ts confirmed at 141 lines (under 200 target)
- 639 tests pass, zero regressions
