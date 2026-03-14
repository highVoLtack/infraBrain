---
phase: 12-linux-filesystem-permission-trap
plan: 01
subsystem: infra
tags: [docker, linux, permissions, chaos-library, python]

requires:
  - phase: 10-docker-storage-full-scenario
    provides: Chaos Library pattern (demo dir, compose, reset script)
provides:
  - Docker permission trap demo environment (demo/permission-trap/)
  - Idempotent reset script producing broken container state
  - Container with UID mismatch on root-owned directory
affects: [12-02, 12-03]

tech-stack:
  added: []
  patterns: [permission-trap-pattern, uid-mismatch-container]

key-files:
  created:
    - demo/permission-trap/docker-compose.yml
    - demo/permission-trap/app/Dockerfile
    - demo/permission-trap/app/app.py
    - demo/permission-trap/reset-permission-trap.sh
  modified: []

key-decisions:
  - "Container stays alive after PermissionError via sleep loop for docker exec diagnostics"
  - "Single-service compose with no ports or volumes -- all state is inside container"

patterns-established:
  - "Permission trap pattern: root-owned dir (mode 700) + USER 1000 = PermissionError on write"

requirements-completed: [SCEN-07]

duration: 1min
completed: 2026-03-14
---

# Phase 12 Plan 01: Permission Trap Demo Environment Summary

**Docker permission trap with root-owned /app/data (mode 700) and UID 1000 app user, producing reproducible PermissionError via idempotent reset script**

## Performance

- **Duration:** 1 min
- **Started:** 2026-03-14T08:14:23Z
- **Completed:** 2026-03-14T08:15:36Z
- **Tasks:** 2
- **Files created:** 4

## Accomplishments
- Docker Compose environment with single permission-app container that reliably produces PermissionError
- Container runs as UID 1000, /app/data owned by root:root with mode 700 -- classic Linux permission trap
- App stays alive after failure for diagnostic access via docker exec
- Idempotent reset script tears down, rebuilds, and verifies broken state within seconds

## Task Commits

Each task was committed atomically:

1. **Task 1: Create Docker Compose environment with permission trap** - `b99848c` (feat)
2. **Task 2: Create idempotent reset script with broken-state verification** - `aad6138` (feat)

## Files Created/Modified
- `demo/permission-trap/docker-compose.yml` - Single-service compose for permission-app
- `demo/permission-trap/app/Dockerfile` - Python 3-slim with root-owned /app/data (mode 700) and USER 1000
- `demo/permission-trap/app/app.py` - Writes PID file, catches PermissionError, stays alive
- `demo/permission-trap/reset-permission-trap.sh` - Idempotent reset with broken-state polling

## Decisions Made
- Container stays alive after PermissionError via sleep loop, enabling docker exec diagnostics (matches docker-storage pattern)
- Single-service compose with no ports or volumes -- all state is inside container, simplifying the scenario

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Permission trap demo ready for Plan 02 (linux-filesystem-troubleshoot skill)
- Reset script provides reliable broken state for E2E testing in Plan 03
- Verified: container UID=1000, /app/data drwx------ root:root, logs show "Permission denied"

---
*Phase: 12-linux-filesystem-permission-trap*
*Completed: 2026-03-14*
