---
phase: 10-docker-storage-failure-scenario
plan: 01
subsystem: infra
tags: [docker, tmpfs, redis, chaos-engineering, storage-failure]

requires:
  - phase: 09-postgres-connection-leak-scenario
    provides: Chaos Library pattern (demo/<scenario>/ with compose + reset script)
provides:
  - Docker storage failure demo environment (logger + Redis + shared tmpfs)
  - Idempotent reset script producing verified broken state
affects: [10-02-docker-storage-skill, 10-03-e2e-test]

tech-stack:
  added: [redis:7-alpine, alpine:3]
  patterns: [tmpfs-backed named volume for shared storage, dd-based disk saturation, dual verification archetype]

key-files:
  created:
    - demo/docker-storage/docker-compose.yml
    - demo/docker-storage/logger/Dockerfile
    - demo/docker-storage/logger/entrypoint.sh
    - demo/docker-storage/reset-docker-storage.sh
  modified: []

key-decisions:
  - "Fill tmpfs to 100% via dd until ENOSPC rather than fixed 9MB count -- ensures Redis cannot write any RDB regardless of dump size"
  - "3-second delay before bloat so Redis starts and creates initial dump.rdb first"
  - "BusyBox df parsing via awk instead of --output=pcent (not available on Alpine)"

patterns-established:
  - "ENOSPC fill pattern: dd with count exceeding volume size + || true to handle expected error"
  - "Dual verification archetype: physical resource check (tmpfs >=90%) AND application health check (Redis MISCONF)"

requirements-completed: [SCEN-04, SCEN-06]

duration: 6min
completed: 2026-03-13
---

# Phase 10 Plan 01: Docker Storage Failure Environment Summary

**Shared tmpfs volume filled to 100% via dd crashes Redis BGSAVE, producing MISCONF error state verified by idempotent reset script**

## Performance

- **Duration:** 6 min
- **Started:** 2026-03-13T12:14:00Z
- **Completed:** 2026-03-13T12:20:00Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Docker Compose environment with logger and Redis sharing a tmpfs-backed named volume
- Logger fills 10MB tmpfs to 100% via dd, leaving zero space for Redis RDB snapshots
- Redis enters MISCONF state refusing all writes within seconds of disk saturation
- Idempotent reset script with dual verification (disk full + Redis broken) exits 0 reliably

## Task Commits

Each task was committed atomically:

1. **Task 1: Create Docker Compose environment with shared tmpfs volume** - `66ff3cc` (feat)
2. **Task 2: Create idempotent reset script with dual broken-state verification** - `237ed10` (feat)

## Files Created/Modified
- `demo/docker-storage/docker-compose.yml` - Logger + Redis services sharing tmpfs-backed named volume
- `demo/docker-storage/logger/Dockerfile` - Alpine-based bloat generator container
- `demo/docker-storage/logger/entrypoint.sh` - dd-based instant disk saturation with 3s startup delay
- `demo/docker-storage/reset-docker-storage.sh` - Idempotent teardown/rebuild with dual broken-state verification

## Decisions Made
- Used dd with count exceeding volume size + `|| true` to fill tmpfs to exactly 100% rather than estimating a fixed byte count
- Added 3-second delay in entrypoint before bloating so Redis can start and create its initial dump.rdb
- Used BusyBox-compatible df parsing with awk instead of GNU coreutils `--output=pcent` flag (unavailable on Alpine)
- Lowered verification threshold to 90% (actual fill is 100%) for robustness margin

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed BusyBox df parsing on Alpine**
- **Found during:** Task 2 (reset script verification)
- **Issue:** Plan specified `df --output=pcent` which is a GNU coreutils flag not available in BusyBox (Alpine)
- **Fix:** Changed to `df /shared | awk 'NR==2 {gsub(/%/,""); print $5}'`
- **Files modified:** demo/docker-storage/reset-docker-storage.sh
- **Verification:** Script correctly parses 100% usage
- **Committed in:** 237ed10 (Task 2 commit)

**2. [Rule 1 - Bug] Fixed insufficient tmpfs fill leaving Redis operational**
- **Found during:** Task 2 (reset script verification)
- **Issue:** Original 9MB fill (count=9) left 1MB free -- enough for Redis's 106-byte RDB dump, so Redis never entered MISCONF state
- **Fix:** Changed to dd with count=10240 (exceeds 10MB volume) + `|| true` to fill until ENOSPC, plus 3s startup delay
- **Files modified:** demo/docker-storage/logger/entrypoint.sh
- **Verification:** tmpfs at 100%, Redis returns MISCONF on SET
- **Committed in:** 237ed10 (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (2 bugs)
**Impact on plan:** Both fixes necessary for correct broken-state reproduction. No scope creep.

## Issues Encountered
- Redis with `--save 1 1 --stop-writes-on-bgsave-error yes` needs an actual write attempt to trigger BGSAVE failure detection. The reset script's poll loop SET command naturally triggers this.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Broken state environment ready for docker-storage diagnostic skill (Plan 02, already complete)
- Reset script available for E2E test (Plan 03) to set up test fixtures

---
*Phase: 10-docker-storage-failure-scenario*
*Completed: 2026-03-13*
