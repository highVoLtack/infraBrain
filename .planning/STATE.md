---
gsd_state_version: 1.0
milestone: v1.2
milestone_name: The Knowledge Layer
status: in-progress
last_updated: "2026-03-14T09:15:03Z"
last_activity: 2026-03-14 -- Plan 12.1-02 complete (skill frontmatter schema extension)
progress:
  total_phases: 2
  completed_phases: 1
  total_plans: 6
  completed_plans: 5
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-13)

**Core value:** The AI diagnoses, plans, and fixes infrastructure problems autonomously while the human admin retains full control — every critical action requires approval, every decision is auditable, and the system can be taught any IT system through simple Markdown files.
**Current focus:** v1.2 The Knowledge Layer

## Current Position

Phase: 12.1-dynamic-command-rewriter
Plan: 02 of 3 complete
Status: Phase 12.1 in progress
Last activity: 2026-03-14 -- Plan 12.1-02 complete (skill frontmatter schema extension)

## Accumulated Context

### From v1.1
- Engine-First Architecture proven: SQL Rewriter, Sanity Checker, findDbContainer, stripHostFlag
- Multi-model registry with domain-expertise routing (default/strategic/forensic)
- 440 tests passing across 42 files, 60+ source files
- Anti-hallucination hardening: MANDATORY_EXECUTION_PROTOCOL, GROUND TRUTH labels, Zod schema
- TOON encoding validated for structured data compression

### From v1.0
- Full DPEV loop (Diagnose → Plan → Execute → Verify) proven end-to-end
- CLI + REST API architecture, dual state storage (files + SQLite)
- Safety system: circuit breaker, damage budget, HITL approval, rollback
- Ollama provider abstraction with pluggable model support

### Roadmap Evolution

- Phase 12 inserted as first v1.2 phase: Linux Filesystem Permission Trap Scenario (URGENT) — prove OS-level troubleshooting without DB logic
- Phase 12.1 inserted: Dynamic Command Rewriter — Permission Trap revealed hardcoded SQL Rewriter doesn't scale. New skill-driven rewrite engine replaces scenario-specific TypeScript

### From Phase 12-01
- Permission trap demo: demo/permission-trap/ with compose, Dockerfile, app.py, reset script
- Container stays alive after PermissionError via sleep loop for docker exec diagnostics
- Single-service compose, no ports/volumes -- all state inside container

### From Phase 12-02
- linux-filesystem-troubleshoot skill with 4-step Diagnostic Ladder (permission correlation)
- 4 discovery commands registered for ground truth injection (docker ps -a, logs, ls -ld, id)
- Safety rules: id/stat=READ, chown/chmod/docker-exec=WRITE
- Preferred fix pattern: chown over chmod 777

### From Phase 12-03
- Full DPEV E2E test: 4 sequential tests covering broken state, diagnosis, fix execution, audit trail
- Mocked LLM with Diagnostic Ladder reasoning for permission correlation
- Fix uses chown 1000:1000 + restart (not chmod 777)
- Recovery verified via log polling (container may exit after successful PID write)
- No DB-specific logic -- pure OS-level troubleshooting proven

### From Phase 12.1-01
- dynamicRewrite() pure function: regex-match pipeline with strip-then-wrap-then-exec
- RewriteRuleSchema (Zod): match, container, user, wrapper, risk, strip_flags
- Container auto-resolution: "auto" -> first discovered, specific -> verify + fallback
- First-match-wins rule ordering, case-insensitive regex
- 21 unit tests covering all rewrite behaviors

### From Phase 12.1-02
- RewriteRuleSchema defined inline in types.ts (Plan 01 not yet delivered)
- 3 skills migrated with declarative rewrite_rules in YAML frontmatter
- Backwards-compatible: skills without rewrite_rules default to []

## Decisions

- Classified docker exec as WRITE (conservative -- can run arbitrary commands inside containers)
- Followed existing skill structure (docker-storage.md pattern) for consistency
- Poll logs for recovery signal instead of docker exec after restart (container exits after success)
- Defined RewriteRuleSchema inline in types.ts since Plan 01 dynamic-rewriter.ts not yet created
- Used YAML single-quoted strings for regex patterns in skill frontmatter to avoid escape issues
- Wrapper {cmd} replaces with full stripped command -- wrapper is the entire executable line
- Empty containers list causes passthrough (no container = no docker exec wrapping)

## Session Continuity

Last session: 2026-03-14
Stopped at: Completed 12.1-02-PLAN.md
Next: Plan 12.1-03 (integration) to wire dynamic rewriter engine with skill frontmatter
