---
phase: 19-ink-terminal-ui
plan: 02
subsystem: api
tags: [sse, express, streaming, dpev, approval-flow, event-stream]

# Dependency graph
requires:
  - phase: 19-01
    provides: SSE event protocol types (SSEEventMap), UI type system
provides:
  - SSE endpoint POST /stream/debug for DPEV pipeline streaming
  - SSE endpoint POST /stream/execute for execution step streaming
  - Cache hit approval POST /stream/debug/approve
  - Execution step approval POST /stream/execute/approve
  - Pipeline event emission via onEvent callback in DPEVInput
  - Token-by-token streaming via streamDiagnosis when onEvent provided
affects: [19-03, 19-04, 19-05, 19-06]

# Tech tracking
tech-stack:
  added: []
  patterns: [module-scoped Map for concurrent session approval resolvers, SSE initSSE/sendEvent helper pattern, Promise-resolver pattern for bidirectional SSE+POST approval]

key-files:
  created:
    - src/api/routes/stream-debug.ts
    - src/api/routes/stream-execute.ts
    - tests/api/stream-debug.test.ts
    - tests/api/stream-execute.test.ts
  modified:
    - src/orchestrator/pipeline.ts
    - src/api/server.ts

key-decisions:
  - "Module-scoped Map keyed by sessionId for cacheApprovals (concurrent session safety)"
  - "Module-scoped Map keyed by sessionId:stepIndex for stepApprovals (concurrent session safety)"
  - "requestCacheApproval returns Promise<boolean> resolved by POST /approve (Promise-resolver pattern)"
  - "onEvent/requestCacheApproval are optional in DPEVInput -- when absent, pipeline behavior is identical to existing code"
  - "Token streaming uses existing streamDiagnosis() when onEvent is provided -- runDiagnosis still called for structured output"
  - "SSE routes mounted after existing REST routes in server.ts for backward compatibility"

patterns-established:
  - "SSE route pattern: initSSE(res) + sendEvent(res, event, data) helpers shared across streaming routes"
  - "Approval resolver pattern: module-scoped Map stores Promise resolvers, POST endpoint resolves them"
  - "Client disconnect handler: req.on('close') rejects pending approvals and cleans up resolver map"

requirements-completed: [TERM-02, TERM-07]

# Metrics
duration: 7min
completed: 2026-04-15
---

# Phase 19 Plan 02: SSE Streaming Endpoints Summary

**Express SSE endpoints for DPEV pipeline and execution streaming with bidirectional cache hit and step approval flows via Promise-resolver pattern -- 17 new tests, 104 total API tests green**

## Performance

- **Duration:** 7 min
- **Started:** 2026-04-15T13:11:06Z
- **Completed:** 2026-04-15T13:18:22Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- POST /stream/debug streams all DPEV events (dpev:phase, dpev:token, dpev:diagnosis, dpev:plan, dpev:cache-hit, dpev:complete, dpev:error)
- POST /stream/execute streams execution events (exec:step, exec:approval, dpev:complete)
- Bidirectional approval: POST /stream/debug/approve for cache hit Y/N, POST /stream/execute/approve for step Y/N
- Pipeline.ts extended with onEvent and requestCacheApproval callbacks (fully backward compatible)
- Token-by-token streaming via provider.streamDiagnosis() wired into SSE when onEvent present
- Both parallel and sequential cache paths support requestCacheApproval

## Task Commits

Each task was committed atomically:

1. **Task 1 RED: Failing tests for stream-debug** - `a54aa30` (test)
2. **Task 1 GREEN: SSE streaming DPEV endpoint with cache hit approval** - `4327c01` (feat)
3. **Task 2 RED: Failing tests for stream-execute** - `3a64798` (test)
4. **Task 2 GREEN: SSE streaming execution with approval flow + server mount** - `3dfd6a6` (feat)

## Files Created/Modified
- `src/api/routes/stream-debug.ts` - SSE endpoint for DPEV pipeline streaming + cache hit approval POST
- `src/api/routes/stream-execute.ts` - SSE endpoint for execution step streaming + step approval POST
- `src/orchestrator/pipeline.ts` - Added onEvent and requestCacheApproval to DPEVInput, event emissions at pipeline transitions
- `src/api/server.ts` - Mounted /stream/debug and /stream/execute after existing routes
- `tests/api/stream-debug.test.ts` - 10 tests covering SSE streaming, cache hit approval, error handling
- `tests/api/stream-execute.test.ts` - 7 tests covering SSE execution streaming, step approval, validation

## Decisions Made
- Used module-scoped Map (not per-request closure) for approval resolvers to support concurrent sessions safely
- requestCacheApproval uses Promise-resolver pattern: POST /stream/debug/approve resolves the Promise stored in the Map
- Token streaming calls streamDiagnosis when onEvent is provided, but still runs runDiagnosis for structured output (both needed)
- SSE routes mounted AFTER existing REST routes in server.ts to guarantee backward compatibility
- Client disconnect handler resolves pending approvals with false (reject) and cleans up Map entries

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed race condition in approval test for stream-execute**
- **Found during:** Task 2 (GREEN phase)
- **Issue:** Test sent POST /approve before the SSE handler had registered the resolver in the Map, causing 404 race condition
- **Fix:** Refactored test to use poll-and-approve pattern inside the mock's requestApproval callback, ensuring resolver is registered before approval POST
- **Files modified:** tests/api/stream-execute.test.ts
- **Verification:** All 7 stream-execute tests pass consistently
- **Committed in:** 3dfd6a6 (Task 2 GREEN commit)

**2. [Rule 2 - Missing Critical] Added requestCacheApproval to parallel path cache handling**
- **Found during:** Task 1 (GREEN phase)
- **Issue:** Plan specified requestCacheApproval for sequential path cache hits, but parallel path also has cache hit detection that needed the same treatment
- **Fix:** Added identical requestCacheApproval flow to the parallel path's fast-path cache section
- **Files modified:** src/orchestrator/pipeline.ts
- **Verification:** Both paths now correctly support cache approval
- **Committed in:** 4327c01 (Task 1 GREEN commit)

---

**Total deviations:** 2 auto-fixed (1 bug, 1 missing critical)
**Impact on plan:** Both auto-fixes necessary for correctness. No scope creep.

## Issues Encountered
None beyond the auto-fixed deviations documented above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- SSE endpoints ready for Ink UI consumption in Plan 19-04 (DPEV streaming panel)
- Event types from Plan 19-01 match the events emitted by these endpoints
- useSSE hook from Plan 19-01 can connect to POST /stream/debug
- Plan 19-03 (core components) can build approval components targeting POST /stream/execute/approve

## Self-Check: PASSED

All created files verified present. All 4 commit hashes verified in git log.

---
*Phase: 19-ink-terminal-ui*
*Completed: 2026-04-15*
