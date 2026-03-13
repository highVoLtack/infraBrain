---
phase: 11-cross-scenario-validation-and-ux-polish
plan: 01
subsystem: testing
tags: [e2e, dpev, audit, vitest, mock-factory]

# Dependency graph
requires:
  - phase: 09-postgres-scenario
    provides: Postgres E2E test with mock provider pattern
  - phase: 10-docker-storage-scenario
    provides: Docker storage E2E test with DPEV loop
provides:
  - Shared assertDPEVSequence helper for DPEV phase ordering validation
  - Shared createMockLLMProvider factory for E2E test mock setup
  - Verification audit event type completing the DPEV sequence
affects: [11-02, future-scenarios]

# Tech tracking
tech-stack:
  added: []
  patterns: [scenario-factory-archetype, shared-test-helpers, dpev-sequence-validation]

key-files:
  created:
    - tests/e2e/helpers/assert-dpev-sequence.ts
    - tests/e2e/helpers/create-mock-provider.ts
    - tests/e2e/helpers/index.ts
  modified:
    - src/audit/types.ts
    - src/api/routes/execute.ts
    - tests/e2e/poc-nginx-502.test.ts
    - tests/e2e/poc-postgres-connleak.test.ts
    - tests/e2e/poc-docker-storage.test.ts

key-decisions:
  - "DPEV phase map: skill_selection->S, decision->D, execution_start/step_complete/execution_complete->E, verification->V"
  - "assertDPEVSequence sorts by timestamp ASC before validation (queryAuditLog returns DESC)"
  - "createMockLLMProvider includes getDefault on registry mock for full interface compliance"

patterns-established:
  - "Scenario Factory Archetype: Setup -> Trigger DPEV -> Assert Result -> Validate Audit Sequence"
  - "Shared test helpers in tests/e2e/helpers/ with barrel export"
  - "Zero Legacy policy: all E2E tests must use shared helpers, no inline mocks"

requirements-completed: [E2E-03]

# Metrics
duration: 2min
completed: 2026-03-13
---

# Phase 11 Plan 01: Scenario Factory Test Infrastructure Summary

**Shared DPEV sequence validator and mock provider factory with verification audit event, refactoring all 3 E2E tests to the Scenario Factory archetype**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-13T14:06:32Z
- **Completed:** 2026-03-13T14:09:01Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments
- Created assertDPEVSequence helper that validates both presence and monotonic ordering of S->D->E->V phases
- Created createMockLLMProvider factory eliminating duplicated mock setup across all E2E tests
- Added verification audit event type completing the DPEV sequence in the execute route
- Refactored all 3 E2E tests to Scenario Factory archetype with Zero Legacy compliance

## Task Commits

Each task was committed atomically:

1. **Task 1: Create shared test helpers and add verification event type** - `e8a504f` (feat)
2. **Task 2: Refactor all 3 E2E tests to Scenario Factory archetype** - `ca293b1` (refactor)

## Files Created/Modified
- `tests/e2e/helpers/assert-dpev-sequence.ts` - DPEV phase ordering validator with timestamp sorting
- `tests/e2e/helpers/create-mock-provider.ts` - Shared mock LLM provider factory
- `tests/e2e/helpers/index.ts` - Barrel export for test helpers
- `src/audit/types.ts` - Added verification event type to AuditEventType union
- `src/api/routes/execute.ts` - Emits verification event after successful execution
- `tests/e2e/poc-nginx-502.test.ts` - Refactored to use shared helpers (also fixed missing registry)
- `tests/e2e/poc-postgres-connleak.test.ts` - Refactored to use shared helpers
- `tests/e2e/poc-docker-storage.test.ts` - Refactored to use shared helpers

## Decisions Made
- DPEV phase map groups execution events (start/step_complete/complete) under E phase for monotonic ordering validation
- assertDPEVSequence sorts by timestamp ASC before validation since queryAuditLog returns DESC order
- createMockLLMProvider includes getDefault on registry mock for full ModelRegistry interface compliance
- Nginx-502 test registry bug fixed via shared factory (was missing registry property)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Shared test infrastructure ready for future scenario additions
- All E2E tests standardized on Scenario Factory archetype
- Plan 11-02 can build on shared helpers for additional cross-scenario validation

---
*Phase: 11-cross-scenario-validation-and-ux-polish*
*Completed: 2026-03-13*
