---
phase: 05-poc-scenario-and-integration
plan: 01
subsystem: infra
tags: [docker, nginx, httpbin, diagnostic-ladder, snapshot, skill]

requires:
  - phase: 03-execution-engine
    provides: "Snapshot module, executor pipeline, fix plan generation"
  - phase: 02-skill-system
    provides: "Skill registry, skill loader, orchestrator router/planner"
provides:
  - "Docker Compose broken Nginx/httpbin environment with network isolation"
  - "nginx-troubleshoot.md Diagnostic Ladder skill"
  - "Universal fix plan generation from any skill diagnosis"
  - "Docker network connect/disconnect snapshot commands"
  - "Scenario Factory reset.sh for idempotent environment setup"
affects: [05-02, 05-03, e2e-tests]

tech-stack:
  added: [httpbin, nginx-alpine]
  patterns: [diagnostic-ladder, scenario-factory, universal-fix-plan-generation]

key-files:
  created:
    - demo/docker-compose.yml
    - demo/nginx.conf
    - demo/reset.sh
    - skills/nginx-troubleshoot.md
  modified:
    - src/api/routes/debug.ts
    - src/execution/snapshot.ts
    - tests/api/routes.test.ts
    - tests/execution/snapshot.test.ts

key-decisions:
  - "Universal fix plan generation: debug route always uses planning skill for plan generation after any skill diagnosis"
  - "Docker network snapshot: connect/disconnect map to docker network inspect for before/after state capture"
  - "Diagnostic Ladder: 5-step systematic investigation sequence (HTTP check, error log, network inspect, cross-layer correlation, fix proposal)"

patterns-established:
  - "Diagnostic Ladder: ordered investigation sequence enforced by skill system prompt"
  - "Scenario Factory: idempotent bash script for reproducible broken environments"
  - "Universal fix plan: decouple diagnosis skill from planning skill for fix generation"

requirements-completed: [POC-01, POC-02]

duration: 2min
completed: 2026-03-08
---

# Phase 5 Plan 1: Demo Environment and Integration Wiring Summary

**Docker/Nginx 502 broken environment with Diagnostic Ladder skill, universal fix plan generation from any skill, and docker network snapshot commands**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-08T18:28:00Z
- **Completed:** 2026-03-08T18:30:30Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments
- Created Docker Compose environment with network-isolated Nginx/httpbin causing deterministic 502
- Authored nginx-troubleshoot.md skill with 5-step Diagnostic Ladder and structured fix proposal format
- Removed planning-skill gate from debug route -- fix plans now generated from any skill's diagnosis
- Added docker network connect/disconnect to snapshot command map for state capture
- All 314 tests passing (3 new tests added)

## Task Commits

Each task was committed atomically:

1. **Task 1: Create Docker demo environment and Nginx troubleshoot skill** - `c5cb1f3` (feat)
2. **Task 2: Extend debug route and add docker network snapshot commands** - `2cdbd8c` (feat)

## Files Created/Modified
- `demo/docker-compose.yml` - Docker Compose with frontend/backend network isolation
- `demo/nginx.conf` - Nginx reverse proxy config pointing to backend:80
- `demo/reset.sh` - Idempotent Scenario Factory script (tear down + start + verify 502)
- `skills/nginx-troubleshoot.md` - Diagnostic Ladder skill for Nginx 502 diagnosis and fix
- `src/api/routes/debug.ts` - Removed planning-only gate, universal fix plan generation
- `src/execution/snapshot.ts` - Added docker network connect/disconnect snapshot entries
- `tests/api/routes.test.ts` - Test for fix plan generation from non-planning skill
- `tests/execution/snapshot.test.ts` - Tests for docker network snapshot commands

## Decisions Made
- Universal fix plan generation: debug route uses the planning skill to generate structured fix plans from any skill's diagnostic output (not just the planning skill itself)
- Docker network snapshot commands map to `docker network inspect <network>` capturing the first arg (network name)
- Diagnostic Ladder enforces systematic 5-step investigation: HTTP check, error log analysis, network inspection, cross-layer correlation, fix proposal

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Broken environment ready for E2E testing (demo/reset.sh creates deterministic 502)
- nginx-troubleshoot skill loadable by SkillRegistry for router selection
- Debug route integration complete for full DPEV loop wiring
- Snapshot module handles docker network operations for before/after state diffs

---
*Phase: 05-poc-scenario-and-integration*
*Completed: 2026-03-08*

## Self-Check: PASSED
