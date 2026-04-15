---
phase: 18-parallel-inference
plan: 01
subsystem: orchestrator
tags: [promise-allsettled, parallel-inference, backend-probe, timing-instrumentation, vllm]

# Dependency graph
requires:
  - phase: 13.1-vllm-multi-model-integration
    provides: Multi-backend ModelRegistry with per-role baseUrl support
  - phase: health-route
    provides: extractUniqueBackendUrls and BackendHealth probe pattern
provides:
  - InferenceScheduler with probeBackends, isAvailable, getMode, runParallel
  - InferenceMode type (parallel | sequential)
  - BackendStatus, InferenceTask, InferenceResult, SchedulerConfig types
  - Timing instrumentation with overlapping execution window logging
affects: [18-02-pipeline-integration, 18-03-timing-benchmarks, 19-ink-terminal-ui]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "InferenceScheduler factory (plain object, not class) matching createModelRegistry pattern"
    - "Probe cache with configurable TTL via simple timestamp comparison"
    - "Promise.all with per-task timing wrapper for concurrent dispatch with instrumentation"
    - "DEV_MODE timing logs with overlap calculation"

key-files:
  created:
    - src/orchestrator/inference-types.ts
    - src/orchestrator/inference-scheduler.ts
    - tests/orchestrator/inference-scheduler.test.ts
  modified: []

key-decisions:
  - "InferenceScheduler is a plain object factory (not class) -- matches createModelRegistry pattern"
  - "Probe cache uses simple timestamp comparison, not interval-based refresh"
  - "runParallel wraps task.execute() in timing then dispatches via Promise.all (rejections handled in wrapper)"
  - "getMode defaults to 'sequential' before probeBackends is called (safe fallback)"

patterns-established:
  - "InferenceScheduler factory: createInferenceScheduler(config, registry, opts?) returns plain object"
  - "Backend probe reuses extractUniqueBackendUrls from health.ts (no duplicate URL extraction logic)"
  - "Timing wrapper pattern: wrap async function, record startMs/endMs, convert rejections to InferenceResult"

requirements-completed: [INFER-01, INFER-02, INFER-04, INFER-05]

# Metrics
duration: 4min
completed: 2026-04-15
---

# Phase 18 Plan 01: InferenceScheduler Summary

**InferenceScheduler with backend probing, parallel/sequential mode detection, and Promise.allSettled dispatch with per-task timing instrumentation**

## Performance

- **Duration:** 4 min
- **Started:** 2026-04-15T09:45:41Z
- **Completed:** 2026-04-15T09:49:53Z
- **Tasks:** 1 (TDD: RED -> GREEN)
- **Files created:** 3

## Accomplishments
- Created InferenceScheduler module that probes all configured backends in parallel and determines parallel/sequential execution mode
- Implemented runParallel primitive that dispatches concurrent model calls with per-task timing instrumentation and overlap logging
- Backend probe results cached with configurable TTL (default 30s) to avoid re-probing on every pipeline call
- 17 comprehensive tests covering probing, caching, mode detection, parallel dispatch, timing, and sequential fallback

## Task Commits

Each task was committed atomically:

1. **Task 1 RED: Failing tests** - `cc2ab2b` (test)
2. **Task 1 GREEN: Implementation** - `67529cf` (feat)

_TDD task: test-first, then implementation. No refactor needed._

## Files Created/Modified
- `src/orchestrator/inference-types.ts` - BackendStatus, InferenceTask, InferenceResult, SchedulerConfig, InferenceMode types
- `src/orchestrator/inference-scheduler.ts` - createInferenceScheduler factory with probeBackends, isAvailable, getMode, runParallel
- `tests/orchestrator/inference-scheduler.test.ts` - 17 unit tests covering all scheduler behaviors

## Decisions Made
- InferenceScheduler is a plain object factory (not class) -- matches createModelRegistry pattern used throughout the codebase
- Probe cache uses simple timestamp comparison, not interval -- avoids background refresh complexity
- runParallel wraps each task.execute() in a timing wrapper that converts rejections to InferenceResult objects, then uses Promise.all (since all promises are guaranteed to resolve after wrapping)
- getMode defaults to 'sequential' before probeBackends is called -- safe fallback ensures pipeline works even if probe is skipped

## Deviations from Plan

None -- plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None -- no external service configuration required.

## Next Phase Readiness
- InferenceScheduler ready for pipeline integration (Plan 02) -- DPEVInput will be extended with optional scheduler
- Types exported for use in pipeline.ts and execute route
- Sequential fallback is transparent -- same interface works in both modes
- Pre-existing E2E test failures in poc-nginx-502.test.ts are unrelated (confirmed by running without changes)

---
*Phase: 18-parallel-inference*
*Completed: 2026-04-15*
