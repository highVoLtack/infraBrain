---
gsd_state_version: 1.0
milestone: v1.2
milestone_name: The Knowledge Layer
status: completed
stopped_at: Phase 12.5 context gathered
last_updated: "2026-03-14T13:59:52.091Z"
last_activity: 2026-03-14 -- Plan 12.4-03 complete (E2E + unit tests migrated to universal expert skills, 506 tests passing)
progress:
  total_phases: 6
  completed_phases: 5
  total_plans: 13
  completed_plans: 13
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-13)

**Core value:** The AI diagnoses, plans, and fixes infrastructure problems autonomously while the human admin retains full control — every critical action requires approval, every decision is auditable, and the system can be taught any IT system through simple Markdown files.
**Current focus:** v1.2 The Knowledge Layer

## Current Position

Phase: 12.4-agnostic-skill-redesign
Plan: 03 of 3 complete
Status: Complete
Last activity: 2026-03-14 -- Plan 12.4-03 complete (E2E + unit tests migrated to universal expert skills, 506 tests passing)

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

### From Phase 12.1-03
- debug.ts wired to dynamicRewrite() replacing hardcoded rewriteForContainer()
- Both structured diagnosis and generateFixPlan paths apply dynamic rewriting
- extractContainerNames() handles both "Running containers" and "All containers with status" discovery keys
- DB container prioritized at front of targetContainers via findDbContainer()
- rewriteForContainer() and stripHostFlag() marked @deprecated in runner.ts
- 475 tests passing (2 pre-existing nginx E2E failures out of scope)

### From Phase 12.2-01
- DiscoveryCommandSchema validates command+label pairs via Zod with min-length constraints
- discovery field on SkillFrontmatterSchema defaults to [] for backwards compatibility
- 16 discovery commands migrated from hardcoded DISCOVERY_COMMANDS into 4 skill YAML files
- YAML single-quoted strings handle Go template syntax ({{.Names}}) and embedded SQL quotes ('idle')

### From Phase 12.2-02
- DISCOVERY_COMMANDS constant fully removed from debug.ts (61 lines of hardcoded domain knowledge deleted)
- runDiscovery refactored to take SkillFile argument, reads from skill.frontmatter.discovery
- debug.ts is now a 100% Agnostic Engine -- zero hardcoded domain knowledge remains
- 477 tests passing, all E2E scenarios work with skill-driven discovery

### From Phase 12.3-01
- parseDockerExec() token-walk parser: extracts flags, container, inner command from docker exec strings
- Docker exec branch in dynamicRewrite(): parse -> match inner against rules -> inject user -> strip -it -> reassemble
- No double-injection: checks for existing -u/--user before injecting rule.user
- Belt-and-suspenders -it stripping in rewriter (complements validator.ts sanitizeDockerExec)
- 29 unit tests (21 existing + 8 new docker-exec-aware), 488 full suite passing

### From Phase 12.3-02
- COMMAND-ONLY MODE sections added to linux-filesystem-troubleshoot.md and docker-storage.md
- Skill examples updated to bare commands -- engine handles docker exec wrapping
- Three-skill-mode taxonomy established: SQL-ONLY (postgres), COMMAND-ONLY (linux-fs, docker-storage), as-is (nginx)
- E2E validation confirms docker-exec-aware rewriter handles canned fix plans correctly (no changes needed)
- Phase 12.3 complete -- engine-first architecture fully proven across all skill types

### From Phase 12.4-01
- ToolDeclarationSchema: risk (required), user, wrapper, strip_flags, container (default 'auto')
- SkillFrontmatterSchema tools field: z.union([string[], Record<string, ToolDeclaration>]).default({})
- toolsToRewriteRules() adapter converts unified tool map to RewriteRule[] for dynamicRewrite()
- allowlist.ts uses Array.isArray() to detect format, Object.keys() for map tools
- debug.ts derives rewrite rules from tool map for new-format skills, falls back to rewrite_rules for legacy
- context.ts generateToolList() auto-injects YOUR TOOLS section into system prompt for map-format skills
- Removed unused version and author fields from SkillFrontmatterSchema
- 489 tests passing, zero regressions

### From Phase 12.4-02
- 3 universal expert skills: linux-expert (permissions+disk+OOM), postgres-expert (connections+deadlocks+slow queries), network-expert (HTTP+proxy+Docker networking)
- Domain Knowledge sections replace Diagnostic Ladders -- LLM reasons from knowledge, not scripted steps
- All skills use map-format tools with risk classification, no hardcoded container names
- Generic discovery commands only (docker ps -a, docker stats --no-stream)
- 4 old scenario-specific skills deleted: linux-filesystem-troubleshoot, docker-storage, postgres-troubleshoot, nginx-troubleshoot
- log-analysis.md converted to map-format tools
- 6 total skills: linux-expert, postgres-expert, network-expert, log-analysis, planning, verification

### From Phase 12.4-03
- All 4 E2E tests migrated: permission-trap, docker-storage, nginx-502, postgres-connleak use universal expert skills
- 2 new loader tests: map-format tools validation, real skills directory integration (6 skills)
- 506 tests passing, 2 pre-existing nginx E2E failures, 4 skipped
- Phase 12.4 complete: tool schema + universal skills + test migration all delivered

## Decisions

- Classified docker exec as WRITE (conservative -- can run arbitrary commands inside containers)
- Followed existing skill structure (docker-storage.md pattern) for consistency
- Poll logs for recovery signal instead of docker exec after restart (container exits after success)
- Defined RewriteRuleSchema inline in types.ts since Plan 01 dynamic-rewriter.ts not yet created
- Used YAML single-quoted strings for regex patterns in skill frontmatter to avoid escape issues
- Wrapper {cmd} replaces with full stripped command -- wrapper is the entire executable line
- Empty containers list causes passthrough (no container = no docker exec wrapping)
- DB container prioritized at front of targetContainers list for rewrite rule resolution
- Rewrite rules and containers extracted once before diagnosis, shared by both code paths
- Kept findDbContainer in debug.ts for DB container prioritization (not deprecated)
- [Phase 12.2]: YAML single-quoted strings for Go template syntax and embedded quotes in discovery commands
- [Phase 12.2]: Discovery commands declared in skill YAML frontmatter, not hardcoded in TypeScript
- [Phase 12.2-02]: SkillFile import added for typed runDiscovery signature instead of string-based lookup
- [Phase 12.3-01]: Token-walk parser over regex for docker exec flag parsing -- more robust for value-flags
- [Phase 12.3-01]: parseDockerExec not exported -- internal helper, not public API
- [Phase 12.3-01]: User injection prepended to flag list for consistent docker exec formatting
- [Phase 12.3]: Token-walk parser over regex for docker exec flag parsing
- [Phase 12.3-02]: Discovery frontmatter commands kept as-is -- engine-executed, not LLM-generated
- [Phase 12.3-02]: Infrastructure commands (docker restart/logs/ps) left in skill text -- not inside-container commands
- [Phase 12.3-02]: No E2E test changes needed -- docker exec parser handles existing canned fix plans correctly

- [Phase 12.4-01]: ToolDeclarationSchema requires risk field -- tools must declare their risk level
- [Phase 12.4-01]: Default tools to {} (empty map) not [] -- new-format-first design
- [Phase 12.4-01]: z.union([string[], Record]) with .default({}) for backward-compat migration
- [Phase 12.4-01]: generateToolList injected only for map-format skills, not legacy string[]
- [Phase 12.4-01]: Removed unused version and author fields from SkillFrontmatterSchema

- [Phase 12.4-02]: linux-expert merges filesystem permissions + disk pressure + OOM into single universal skill
- [Phase 12.4-02]: Discovery commands are generic only -- LLM gathers evidence using tools guided by domain knowledge
- [Phase 12.4-02]: Old skills deleted (not deprecated) to avoid registry confusion
- [Phase 12.4-02]: log-analysis.md tool "docker logs" changed to "docker" key in map format
- [Phase 12.4]: Universal expert skills replace scenario-specific skills: linux-expert merges permissions+disk+OOM, Domain Knowledge over Diagnostic Ladders

- [Phase 12.4-03]: Mock skill objects in unit tests kept with old names -- self-contained fixtures that don't use registry.get()
- [Phase 12.4-03]: 2 pre-existing nginx E2E failures remain out of scope (Docker networking environment issue)

## Session Continuity

Last session: 2026-03-14T13:59:52.088Z
Stopped at: Phase 12.5 context gathered
Next: Phase 12.4 complete -- all plans delivered
