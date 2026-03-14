---
phase: 12-linux-filesystem-permission-trap
plan: 02
subsystem: skills
tags: [linux, filesystem, permissions, chown, chmod, docker, diagnostic-skill]

requires:
  - phase: 12-linux-filesystem-permission-trap
    provides: "Docker Compose scenario with permission-app container (Plan 01)"
provides:
  - "linux-filesystem-troubleshoot diagnostic skill with 4-step Diagnostic Ladder"
  - "4 discovery commands for ground truth injection"
  - "Safety classifications for filesystem commands (id, stat, chown, chmod, docker exec)"
affects: [12-linux-filesystem-permission-trap]

tech-stack:
  added: []
  patterns: ["4-step Diagnostic Ladder for OS-level permission correlation", "chown-over-chmod-777 fix preference"]

key-files:
  created:
    - skills/linux-filesystem-troubleshoot.md
  modified:
    - src/api/routes/debug.ts
    - src/safety/rules.ts

key-decisions:
  - "Followed existing skill structure (docker-storage.md pattern) for consistency"
  - "Prefer chown over chmod 777 as the correct permission fix"
  - "Classified docker exec as WRITE (conservative -- can run arbitrary commands inside containers)"

patterns-established:
  - "OS-level diagnostic skills use docker ps -a (not docker ps) to catch exited containers"
  - "Permission skills use docker exec -u 0 for root-level fixes"

requirements-completed: [SCEN-07]

duration: 2min
completed: 2026-03-14
---

# Phase 12 Plan 02: Diagnostic Skill & Safety Rules Summary

**Linux filesystem permission diagnostic skill with 4-step Diagnostic Ladder, discovery commands, and safety classifications for chown/chmod/id/stat/docker-exec**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-14T08:14:27Z
- **Completed:** 2026-03-14T08:16:52Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Created linux-filesystem-troubleshoot skill with 4-step Diagnostic Ladder for permission correlation
- Registered 4 discovery commands in debug.ts for ground truth injection (docker ps -a, logs, ls -ld, id)
- Added safety classifications: id/stat as READ, chown/chmod/docker-exec as WRITE
- All 435 existing tests pass with zero regressions

## Task Commits

Each task was committed atomically:

1. **Task 1: Create linux-filesystem-troubleshoot diagnostic skill** - `e8f03a3` (feat)
2. **Task 2: Register discovery commands and update safety rules** - `2a7860f` (feat)

## Files Created/Modified
- `skills/linux-filesystem-troubleshoot.md` - 4-step Diagnostic Ladder skill for Linux filesystem permission issues
- `src/api/routes/debug.ts` - DISCOVERY_COMMANDS entry with 4 commands for ground truth injection
- `src/safety/rules.ts` - Safety classifications for id, stat (READ) and chown, chmod, docker exec (WRITE)

## Decisions Made
- Followed existing skill structure (docker-storage.md pattern) for consistency across all skills
- Prefer chown over chmod 777 as the correct permission fix -- changing ownership is more secure than opening permissions
- Classified docker exec as WRITE (conservative default since it can run arbitrary commands inside containers)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Plan verification referenced `tests/unit/safety-classifier.test.ts` which does not exist; used full test suite (`tests/safety/classifier.test.ts` and all 435 tests) to verify no regressions instead.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Skill is auto-loaded by SkillRegistry from skills/ directory
- Discovery commands ready for ground truth injection during diagnosis
- Safety rules in place for all filesystem-related commands
- Ready for Plan 03 (integration testing / E2E scenario)

---
*Phase: 12-linux-filesystem-permission-trap*
*Completed: 2026-03-14*
