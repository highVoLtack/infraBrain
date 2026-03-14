---
gsd_state_version: 1.0
milestone: v1.2
milestone_name: The Knowledge Layer
status: executing
stopped_at: Completed 12.6-01-PLAN.md
last_updated: "2026-03-14T17:51:47.452Z"
last_activity: 2026-03-14 -- Plan 12.6-01 complete (self-healing executor module with LLM correction loop, 22 tests, 560 total)
progress:
  total_phases: 7
  completed_phases: 6
  total_plans: 19
  completed_plans: 17
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-13)

**Core value:** The AI diagnoses, plans, and fixes infrastructure problems autonomously while the human admin retains full control — every critical action requires approval, every decision is auditable, and the system can be taught any IT system through simple Markdown files.
**Current focus:** v1.2 The Knowledge Layer

## Current Position

Phase: 12.6-self-healing-executor
Plan: 01 of 3 complete
Status: Executing
Last activity: 2026-03-14 -- Plan 12.6-01 complete (self-healing executor module with LLM correction loop, 22 tests, 560 total)

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

### From Phase 12.5-01
- SkillFrontmatterSchema extended with negative_triggers and when_not_to_use (both default to [])
- EnrichedSkillSummary interface exported from registry.ts for typed routing data
- registry.list() returns enriched objects: name, description, triggers, negative_triggers, when_not_to_use, priority
- log-analysis triggers narrowed to 6 log-specific terms (error/debug/diagnose/why removed)
- log-analysis has 8 negative_triggers and 3 when_not_to_use for routing exclusion
- All 6 skills have negative_triggers and when_not_to_use in frontmatter
- 512 tests passing, 2 pre-existing nginx E2E failures, 4 skipped

### From Phase 12.5-02
- preFilterSkills() Level 0 pre-filter: positive trigger match + negative trigger exclusion
- Two-tier routing in selectSkill(): pre-filter narrows candidates, LLM resolves ambiguity
- Single-candidate shortcut skips LLM call entirely (deterministic for clear prompts)
- ROUTING_CONSTITUTION with Negative Selection protocol exported from context.ts
- buildRoutingPrompt() accepts EnrichedSkillSummary[] with triggers/when_not_to_use/priority
- enforceDPEVSequence() validates DPEV ordering at phase transitions in debug route
- Debug route tracks completedPhases array (discovery -> diagnosis -> plan)
- 523 tests passing, 2 pre-existing nginx E2E failures, 4 skipped

### From Phase 12.5-03
- Permission trap demo parameterized via DATA_DIR env var (app.py + Dockerfile ARG/ENV)
- Remix scenario: vault-processor-99 container with /var/lib/internal/secrets path
- E2E test discovers container name and data path dynamically -- zero hardcoded strings
- Full DPEV chain proven with remix: linux-expert routing, chown -u 0 fix, PID recovery
- Phase 12.5 complete: skill schema + two-tier routing + agnosticism proof delivered
- 523 tests passing, 2 pre-existing nginx E2E failures, 4 skipped

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

- [Phase 12.5-01]: negative_triggers and when_not_to_use use .default([]) for backwards compatibility
- [Phase 12.5-01]: log-analysis triggers narrowed per user decision -- broad terms removed to prevent over-matching
- [Phase 12.5-01]: EnrichedSkillSummary exported as named interface for router.ts/context.ts imports
- [Phase 12.5-01]: registry.list() return type is breaking change -- Plan 02 updates callers
- [Phase 12.5]: negative_triggers and when_not_to_use use .default([]) for backwards compatibility

- [Phase 12.5-02]: preFilterSkills returns ALL skills on empty result (safety net for unrecognized queries)
- [Phase 12.5-02]: Single-candidate shortcut skips LLM entirely for deterministic routing
- [Phase 12.5-02]: negative_triggers are Level 0 only -- never sent to LLM (when_not_to_use goes to LLM via routing prompt)
- [Phase 12.5-02]: DPEV enforcement is additive -- validates at transitions but doesn't restructure handler
- [Phase 12.5-02]: Discovery auto-completes after runDiscovery returns (whether commands exist or not)

- [Phase 12.5-03]: DATA_DIR defaults to /app/data for full backwards compatibility with original demo
- [Phase 12.5-03]: Container name discovered via docker compose ps, data path via docker exec printenv
- [Phase 12.5-03]: Canned fix plan built inside beforeAll after dynamic discovery (not at module scope)

### Post-Phase 12.5 Live Testing (2026-03-14)
- GROUND TRUTH injection into planner: discoveryContext passed through to fix plan LLM prompt
- Shell mode discovery: runDiscovery uses needsShell() + runShellCommand() for complex commands
- Error-only log filtering: discovery greps for error/fatal/denied/fail only (2966 → 176 tokens)
- Agnostic discovery E2E test: random container name + random path, 6 tests proving zero hardcoded values
- Planning skill routed to strategic model (llama3.3:70b) for better command generation
- Docker command sanitizer (fixKnownCommandErrors): strips -it, fixes -u placement, replaces $(id -u/g)
- CRITICAL FINDING: Local LLMs (7B-70B) ALL generate wrong chown/docker exec syntax -- different variant each run
- DECISION: Self-healing executor needed (error → LLM correction → retry) instead of regex band-aids
- Next: Merge Superpowers + GSD patterns into self-healing executor architecture
- 538 tests passing (2 pre-existing nginx E2E failures)

### From Phase 12.6-01
- selfHealStep() correction loop: on failure, asks LLM for corrected command, validates through full safety pipeline, retries up to 3 times
- buildCorrectionPrompt: fresh each time (no previous attempts), includes stderr, exit code, step description, tools
- extractCommandFromLLMResponse: strips markdown fences, prose prefixes, short lines
- validateCorrectedCommand: enforceSkillAllowlist + validateCommand + dynamicRewrite pipeline
- verifyEffect: for WRITE/DESTRUCTIVE-risk steps, LLM generates read-only verification command after exit 0
- Fail-open verification: bad verification commands skip rather than block successful fixes
- CorrectionAttempt, SelfHealResult, SelfHealContext types in execution/types.ts
- selfHealing config section: maxAttempts=3, correctionTimeoutMs=15000
- self_heal_attempt and self_heal_exhausted audit event types
- 22 new tests, 560 total passing (2 pre-existing nginx E2E failures)

## Decisions

- [Phase 12.6-01]: Fresh correction prompt per attempt (no previous attempt history) per user decision
- [Phase 12.6-01]: Fail-open verification: bad verification commands skip rather than block successful fixes
- [Phase 12.6-01]: Effect verification only for WRITE and DESTRUCTIVE risk steps, not READ
- [Phase 12.6-01]: Safety-blocked corrections count as attempts and deduct budget

## Session Continuity

Last session: 2026-03-14T17:51:47.449Z
Stopped at: Completed 12.6-01-PLAN.md
Next: Phase 12.6 Plan 02 (executor integration -- wire selfHealStep into step execution loop)
