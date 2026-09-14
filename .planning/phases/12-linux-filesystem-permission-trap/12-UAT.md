---
status: testing
phase: 12-linux-filesystem-permission-trap
source: [12-01-SUMMARY.md, 12-02-SUMMARY.md, 12-03-SUMMARY.md]
started: 2026-03-14T08:30:00Z
updated: 2026-03-14T12:45:00Z
---

## Current Test

number: 1
name: Cold Start Smoke Test
expected: |
  Kill any running permission-app container. Run `bash demo/permission-trap/reset-permission-trap.sh`. Script exits 0, prints "SUCCESS: permission-app crashed with exit code 1". Container is running (sleep loop), `docker logs permission-app` shows "FATAL: Permission denied writing to /app/data/status.pid".
awaiting: user response

## Tests

### 1. Cold Start Smoke Test
expected: Kill any running permission-app container. Run `bash demo/permission-trap/reset-permission-trap.sh`. Script exits 0, prints "SUCCESS". Container is running (sleep loop), `docker logs permission-app` shows "FATAL: Permission denied writing to /app/data/status.pid".
result: [pending]

### 2. Container Permission Trap Verified
expected: Run `docker exec permission-app ls -ld /app/data` — shows `drwx------ root root`. Run `docker exec permission-app id` — shows `uid=1000`. The ownership mismatch is visible.
result: [pending]

### 3. Skill Auto-Loaded by Registry
expected: Skill file exists with correct frontmatter. All 29 skill tests pass.
result: pass

### 4. Discovery Commands in Skill Frontmatter
expected: `skills/linux-filesystem-troubleshoot.md` declares 4 discovery commands in YAML frontmatter. Orchestrator reads from `skill.frontmatter.discovery`.
result: pass

### 5. Safety Rules Classify Filesystem Commands
expected: id/stat=READ, chown/chmod/docker-exec=WRITE. All 46 safety tests pass.
result: pass

### 6. E2E Test Suite Passes
expected: Run `npx vitest run tests/e2e/poc-permission-trap.test.ts`. All 4 tests pass.
result: [pending]

### 7. Full Test Suite No Regressions
expected: Run `npx vitest run`. 480+ tests pass. 2 nginx E2E failures are pre-existing (not from Phase 12).
result: pass

## Summary

total: 7
passed: 4
issues: 0
pending: 3
skipped: 0

## Gaps

[none yet]
