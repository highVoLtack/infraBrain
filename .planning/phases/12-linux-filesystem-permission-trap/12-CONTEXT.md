# Phase 12: Linux Filesystem Permission Trap Scenario - Context

**Gathered:** 2026-03-14
**Status:** Ready for planning
**Source:** User-provided context via /gsd:insert-phase

<domain>
## Phase Boundary

This phase proves that InfraBrain's Technical Lead (Qwen 32B) can handle raw Linux OS-level troubleshooting without any DB-specific logic. A Docker container crashes with "Permission Denied" due to a filesystem ownership mismatch — InfraBrain must autonomously diagnose and fix it.

</domain>

<decisions>
## Implementation Decisions

### Scenario Setup
- Create `demo/permission-trap/` directory
- Docker Compose: Simple Python app that tries to write to `/app/data/status.pid`
- The Sabotage: `/app/data` directory is owned by root:root with 700 permissions, but app runs as UID 1000
- Result: App crashes with "Permission Denied"

### New Skill
- Create `linux-filesystem-troubleshoot.md` skill file
- Diagnostic Ladder:
  1. Check container logs (see Permission Denied)
  2. Check directory permissions (`ls -ld /app/data`)
  3. Check current user (`id` / `whoami`)
  4. Correlate: Owner mismatch
- Fix: `chown 1000:1000 /app/data` or `chmod 777`

### Architecture
- Reuse existing DPEV loop, sub-agent execution, and Engine-First patterns
- No DB-specific logic — pure OS-level troubleshooting
- Follow same patterns as Nginx 502, Postgres, Docker Storage scenarios

### Claude's Discretion
- Specific Python app implementation details (minimal is fine)
- Skill file structure (follow existing skill patterns)
- E2E test implementation approach
- Whether to add new tool allowlist entries for filesystem commands

</decisions>

<specifics>
## Specific Ideas

- The Python app should be minimal — just try to write a PID file on startup
- The fix should demonstrate both `chown` and understanding of Unix permission model
- E2E test should follow the pattern from Postgres and Docker Storage scenarios
- Skill should work with the existing model routing (Technical Lead handles this, no forensic routing needed)

</specifics>

<deferred>
## Deferred Ideas

None — this is a focused scenario insertion.

</deferred>

---

*Phase: 12-linux-filesystem-permission-trap*
*Context gathered: 2026-03-14 via user insert-phase description*
