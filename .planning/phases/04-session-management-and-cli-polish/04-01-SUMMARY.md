---
phase: 04-session-management-and-cli-polish
plan: 01
subsystem: cli
tags: [json-envelope, commander, express, chalk, status-dashboard]

requires:
  - phase: 01-foundation
    provides: CLI commands framework, Express server, WriteThrough store, config schema
  - phase: 03-execution-engine
    provides: Lock manager for reading active locks

provides:
  - JsonEnvelope<T> type and envelope/errorEnvelope helpers for all CLI --json output
  - Global --json option on Commander program (available to all commands)
  - GET /status API route with Ollama health, active plans, recent sessions, locks
  - /infra:status CLI command with chalk-formatted dashboard
  - WriteThrough.getRecentSessions and getIncompleteSessions query methods
  - resumeWindowMs config field (24h default)
  - formatStatusDashboard function for docker-ps-style output

affects: [04-02-session-lifecycle, 04-03-session-resume]

tech-stack:
  added: []
  patterns: [json-envelope-pattern, global-cli-option, status-dashboard-factory]

key-files:
  created:
    - src/cli/json-envelope.ts
    - src/api/routes/status.ts
    - tests/cli/json-output.test.ts
    - tests/cli/status.test.ts
    - tests/api/status.test.ts
  modified:
    - src/cli/commands.ts
    - src/cli/formatter.ts
    - src/api/server.ts
    - src/state/store.ts
    - src/config/types.ts

key-decisions:
  - "JsonEnvelope shape: { ok, command, data, error } -- consistent across all commands"
  - "Global --json via program.optsWithGlobals() with regular function() actions for correct this binding"
  - "Status route reads lock files directly from lockDir (same pattern as locks/manager.ts)"
  - "Ollama health check uses 3s AbortController timeout in status route"

patterns-established:
  - "JSON envelope: all CLI commands wrap output in envelope()/errorEnvelope() when --json is active"
  - "Status route factory: createStatusRoute(deps) with injectable store, config, lockDir"
  - "Dashboard formatting: formatStatusDashboard returns multi-section string, conditional sections"

requirements-completed: [INTF-02, INTF-04]

duration: 4min
completed: 2026-03-08
---

# Phase 04 Plan 01: JSON Envelope and Status Dashboard Summary

**JSON output envelope with global --json CLI flag, GET /status API route, and docker-ps-style /infra:status dashboard**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-08T15:40:04Z
- **Completed:** 2026-03-08T15:44:25Z
- **Tasks:** 2
- **Files modified:** 10

## Accomplishments
- JsonEnvelope<T> type with envelope() and errorEnvelope() helpers used by all CLI commands
- Global --json option wired into Commander program; debug, health, and status commands all support it
- GET /status API route returning Ollama health (with 3s timeout), active plans, recent sessions, and locks
- Chalk-formatted status dashboard with conditional locks section (hidden when no locks)
- WriteThrough extended with getRecentSessions and getIncompleteSessions for session querying
- resumeWindowMs added to config schema (24h default, used by future session resume)

## Task Commits

Each task was committed atomically (TDD: test then feat):

1. **Task 1: JSON envelope, global --json option, and status store methods**
   - `088969c` (test) - failing tests for envelope helpers and store query methods
   - `b7b32ef` (feat) - json-envelope.ts, store methods, resumeWindowMs config
2. **Task 2: Status API route, CLI command with --json, and dashboard formatting**
   - `e2c1e34` (test) - failing tests for status route and dashboard formatter
   - `d7448c0` (feat) - status route, CLI command, formatter, server mounting

## Files Created/Modified
- `src/cli/json-envelope.ts` - JsonEnvelope<T> type, envelope(), errorEnvelope() helpers
- `src/api/routes/status.ts` - GET /status route with Ollama health, sessions, locks
- `src/cli/commands.ts` - Global --json option, /infra:status command, --json on debug/health
- `src/cli/formatter.ts` - formatStatusDashboard with Ollama, plans, sessions, conditional locks
- `src/api/server.ts` - Mount status route, added store/lockDir to ServerDeps
- `src/state/store.ts` - getRecentSessions(limit), getIncompleteSessions(windowMs)
- `src/config/types.ts` - resumeWindowMs field added to InfraBrainConfigSchema
- `tests/cli/json-output.test.ts` - Envelope shape and store query tests
- `tests/cli/status.test.ts` - Dashboard formatter tests
- `tests/api/status.test.ts` - Status route API tests

## Decisions Made
- JsonEnvelope uses { ok, command, data, error } shape for consistent machine-parseable output
- Used program.optsWithGlobals() with regular function() actions (not arrow) for Commander this binding
- Status route reads lock files directly from lockDir (reuses pattern from locks/manager.ts)
- Ollama health check in status route uses 3-second AbortController timeout
- Locks section in dashboard is conditionally hidden when no active locks (per user decision)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- JSON envelope pattern established for all future CLI commands
- WriteThrough query methods ready for session lifecycle (Plan 02) and resume (Plan 03)
- resumeWindowMs config ready for session resume feature
- Status dashboard can be extended with new sections as features are added

---
*Phase: 04-session-management-and-cli-polish*
*Completed: 2026-03-08*
