---
phase: 09-postgres-failure-scenario
plan: 02
subsystem: skills
tags: [postgres, diagnostic-ladder, pg_stat_activity, forensic-model, discovery-commands]

# Dependency graph
requires:
  - phase: 05-poc-scenario
    provides: "Skill system, SkillRegistry, discovery commands pattern in debug.ts"
  - phase: 08-rolling-context
    provides: "Rolling context injection for multi-step fix plan PID handoff"
provides:
  - "postgres-troubleshoot.md diagnostic skill with 5-step Database Archetype Ladder"
  - "5 discovery commands for Postgres ground truth injection"
affects: [09-03-docker-compose-environment, 09-04-e2e-test]

# Tech tracking
tech-stack:
  added: []
  patterns: ["Database Skill Archetype: Discovery -> Saturation -> Activity -> Correlation -> Remediation"]

key-files:
  created: [skills/postgres-troubleshoot.md]
  modified: [src/api/routes/debug.ts]

key-decisions:
  - "Hardcoded network name postgres_pgnet (Docker Compose project name convention) instead of subshell expansion"
  - "pg_terminate_backend classified as write risk not destructive -- connections are already leaked/idle"
  - "5 discovery commands pre-inject all evidence so LLM does pure cross-domain reasoning"

patterns-established:
  - "Database Skill Archetype: 5-step Diagnostic Ladder (Discovery -> Saturation -> Activity -> Correlation -> Remediation)"
  - "Cross-domain correlation: map DB client_addr to container names via Docker network topology"

requirements-completed: [SCEN-02]

# Metrics
duration: 2min
completed: 2026-03-13
---

# Phase 9 Plan 2: Postgres Diagnostic Skill Summary

**Postgres-troubleshoot skill with 5-step Diagnostic Ladder and 5 discovery commands for cross-domain connection leak diagnosis using forensic model**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-13T09:40:20Z
- **Completed:** 2026-03-13T09:42:03Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Created postgres-troubleshoot.md skill with Database Archetype Diagnostic Ladder (Discovery -> Saturation -> Activity -> Correlation -> Remediation)
- Registered 5 discovery commands in debug.ts for ground truth injection (containers, network topology, active count, max_connections, idle connections)
- Skill uses preferred_model: forensic for cross-domain correlation reasoning
- Complete example showing connection leak scenario end-to-end with 3-step fix plan

## Task Commits

Each task was committed atomically:

1. **Task 1: Create postgres-troubleshoot.md diagnostic skill** - `99cbef1` (feat)
2. **Task 2: Register postgres-troubleshoot discovery commands in debug route** - `8ac1a91` (feat)

## Files Created/Modified
- `skills/postgres-troubleshoot.md` - Postgres diagnostic skill with 5-step Diagnostic Ladder, triggers, tools, forensic model preference, and full example
- `src/api/routes/debug.ts` - Added postgres-troubleshoot entry to DISCOVERY_COMMANDS with 5 commands

## Decisions Made
- Hardcoded network name `postgres_pgnet` instead of dynamic subshell expansion (parseCommand may not handle `$()`)
- pg_terminate_backend classified as "write" risk (Y/n approval) not "destructive" -- leaked idle connections are safe to terminate
- All psql commands use `docker exec postgres-demo psql -U postgres` pattern (never assume host psql)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Skill and discovery commands ready for Docker Compose environment (Plan 03) and E2E test (Plan 04)
- The 5 discovery commands will pre-inject ground truth into LLM context when Postgres scenario is running
- Cross-domain correlation (pg_stat_activity.client_addr -> Docker network topology -> container name) ready for E2E validation

---
*Phase: 09-postgres-failure-scenario*
*Completed: 2026-03-13*
