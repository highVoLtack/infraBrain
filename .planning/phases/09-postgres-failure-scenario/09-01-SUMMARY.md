---
phase: 09-postgres-failure-scenario
plan: 01
subsystem: infra
tags: [docker, postgres, psycopg2, chaos-library, connection-leak]

requires:
  - phase: 05-poc-scenario-and-integration
    provides: Nginx demo environment and E2E test pattern
provides:
  - Postgres connection leak Docker environment (demo/postgres/)
  - Chaos Library directory structure (demo/<scenario>/)
  - Restructured nginx demo under demo/nginx/
affects: [09-02, 09-03, future-scenarios]

tech-stack:
  added: [psycopg2-binary, postgres:16, python:3-slim]
  patterns: [chaos-library-directory-structure, per-scenario-reset-scripts]

key-files:
  created:
    - demo/postgres/docker-compose.yml
    - demo/postgres/leaky-app/Dockerfile
    - demo/postgres/leaky-app/leak.py
    - demo/postgres/leaky-app/init.sql
    - demo/postgres/reset-postgres.sh
  modified:
    - demo/nginx/docker-compose.yml (moved from demo/)
    - demo/nginx/nginx.conf (moved from demo/)
    - demo/nginx/reset.sh (moved from demo/)
    - tests/e2e/poc-nginx-502.test.ts

key-decisions:
  - "Chaos Library pattern: demo/<scenario>/ with per-scenario compose and reset scripts"
  - "Leaky-app uses non-superuser account to leave 2 superuser slots for diagnostics"

patterns-established:
  - "Chaos Library: each scenario lives in demo/<name>/ with docker-compose.yml and reset script"
  - "Reset script pattern: teardown, build, poll for broken state confirmation"

requirements-completed: [SCEN-01, SCEN-03]

duration: 1min
completed: 2026-03-13
---

# Phase 9 Plan 1: Postgres Failure Scenario Environment Summary

**Postgres connection leak Docker environment with 18-connection saturation and Chaos Library demo directory restructure**

## Performance

- **Duration:** 1 min
- **Started:** 2026-03-13T09:40:17Z
- **Completed:** 2026-03-13T09:41:39Z
- **Tasks:** 2
- **Files modified:** 9

## Accomplishments
- Restructured demo/ into Chaos Library pattern with per-scenario subdirectories (demo/nginx/, demo/postgres/)
- Created complete Postgres connection leak environment: postgres:16 with max_connections=20, leaky-app opening 18 connections
- Idempotent reset-postgres.sh with 60s polling timeout for broken state confirmation
- Updated all E2E test path references -- existing nginx test compiles against new structure

## Task Commits

Each task was committed atomically:

1. **Task 1: Restructure demo directory** - `4b1704b` (refactor)
2. **Task 2: Create Postgres Docker environment** - `99cbef1` (feat)

## Files Created/Modified
- `demo/nginx/docker-compose.yml` - Moved from demo/ root (nginx scenario)
- `demo/nginx/nginx.conf` - Moved from demo/ root (nginx config)
- `demo/nginx/reset.sh` - Moved from demo/ root (nginx reset script)
- `tests/e2e/poc-nginx-502.test.ts` - Updated path references to demo/nginx/
- `demo/postgres/docker-compose.yml` - Postgres + leaky-app compose with max_connections=20, port 5433
- `demo/postgres/leaky-app/Dockerfile` - Python 3-slim with psycopg2-binary
- `demo/postgres/leaky-app/leak.py` - Opens 18 connections with 2s retry backoff, holds forever
- `demo/postgres/leaky-app/init.sql` - Creates non-superuser leaky account
- `demo/postgres/reset-postgres.sh` - Idempotent teardown/build/poll script (60s timeout)

## Decisions Made
- Chaos Library pattern: each scenario in demo/<name>/ with own compose and reset script
- Leaky-app uses non-superuser (leaky) to leave 2 superuser_reserved_connections for diagnostic access
- Host port 5433 for Postgres to avoid collisions with local installations

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Postgres Docker environment ready for diagnostic skill development (09-02)
- Reset script can create/recreate broken state for E2E testing
- Chaos Library pattern established for future scenarios

---
*Phase: 09-postgres-failure-scenario*
*Completed: 2026-03-13*
