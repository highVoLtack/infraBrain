---
phase: 02-skill-system-and-orchestrator
plan: 03
subsystem: orchestrator
tags: [ai-sdk, generateObject, zod-schema, skill-routing, fix-plan, chalk]

# Dependency graph
requires:
  - phase: 02-skill-system-and-orchestrator
    provides: SkillFile types, SkillRegistry, per-skill allowlist, core skill files
  - phase: 01-foundation-and-safety-gates
    provides: LLMProvider, AuditLogger, safety validator, CLI commands, Express server
provides:
  - LLM-based skill router (selectSkill) with --skill override
  - Multi-message conversation builder (buildMessages, buildRoutingPrompt)
  - Structured fix plan generator (generateFixPlan) with Zod-validated output
  - Fix plan Markdown and CLI table formatters
  - Orchestrator wired into /debug route with per-skill allowlist enforcement
  - CLI --skill flag for manual skill override
  - SkillRegistry populated at startup from configurable skillsDir
  - Audit logging for skill_selection events
affects: [execution-engine, session-management, phase-03]

# Tech tracking
tech-stack:
  added: []
  patterns: [llm-skill-routing-via-generateObject, zod-structured-output, multi-message-skill-context-injection, per-skill-allowlist-before-global-safety]

key-files:
  created:
    - src/orchestrator/types.ts
    - src/orchestrator/context.ts
    - src/orchestrator/router.ts
    - src/orchestrator/planner.ts
    - tests/orchestrator/router.test.ts
    - tests/orchestrator/planner.test.ts
  modified:
    - src/api/routes/debug.ts
    - src/api/server.ts
    - src/cli/commands.ts
    - src/index.ts
    - src/audit/types.ts
    - src/audit/logger.ts

key-decisions:
  - "generateObject with Zod schemas for structured LLM output (skill selection and fix plans)"
  - "Per-skill allowlist checked before global safety validator (defense-in-depth)"
  - "Graceful degradation: debug route falls back to direct LLM call when no skills loaded"

patterns-established:
  - "Orchestrator skill routing: selectSkill with LLM path + manual override path"
  - "Multi-message conversation: system prompt as system, skill context as assistant, user input as user"
  - "Fix plan structure: single command per step with rollback and risk level"

requirements-completed: [CORE-05, SKIL-01]

# Metrics
duration: 3min
completed: 2026-03-08
---

# Phase 02 Plan 03: Orchestrator Router, Context Builder, and Fix Plan Generator Summary

**LLM-based skill router with generateObject structured output, multi-message context injection, fix plan generation with Zod-validated JSON/Markdown/CLI table output, wired into /debug API and CLI with --skill override**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-08T01:52:17Z
- **Completed:** 2026-03-08T01:55:43Z
- **Tasks:** 2
- **Files modified:** 12

## Accomplishments
- Orchestrator types with Zod schemas: FixStep, FixPlan, SkillSelection, OrchestratorResult
- LLM-based skill router via generateObject with SkillSelectionSchema, plus direct --skill override path
- Multi-message conversation builder injecting skill context as system + assistant + user messages
- Fix plan generator producing structured JSON, Markdown tables, and chalk-colored CLI tables
- Full integration into /debug route with per-skill allowlist enforcement before global safety
- CLI --skill flag, startup skill loading, audit logging for skill selections
- 9 new orchestrator tests, all 145 total tests passing

## Task Commits

Each task was committed atomically:

1. **Task 1: Orchestrator types, router, context builder, and planner** - `e5dcafa` (feat)
2. **Task 2: Wire orchestrator into CLI and API debug route** - `3fb072c` (feat)

## Files Created/Modified
- `src/orchestrator/types.ts` - FixStep/FixPlan/SkillSelection Zod schemas and OrchestratorResult interface
- `src/orchestrator/context.ts` - buildMessages and buildRoutingPrompt for skill-injected conversations
- `src/orchestrator/router.ts` - selectSkill with LLM routing and --skill override
- `src/orchestrator/planner.ts` - generateFixPlan, generatePlanMarkdown, formatPlanTable
- `src/api/routes/debug.ts` - Integrated orchestrator: skill selection, allowlist, fix plan generation
- `src/api/server.ts` - Added optional registry dependency to ServerDeps
- `src/cli/commands.ts` - Added --skill flag, fix plan display, skill message display
- `src/index.ts` - SkillRegistry creation and population at startup
- `src/audit/types.ts` - Added skill_selection event type
- `src/audit/logger.ts` - Added logSkillSelection method
- `tests/orchestrator/router.test.ts` - 5 tests for selectSkill, buildMessages, buildRoutingPrompt
- `tests/orchestrator/planner.test.ts` - 4 tests for generateFixPlan, generatePlanMarkdown, formatPlanTable

## Decisions Made
- Used AI SDK generateObject with Zod schemas for both skill selection and fix plan generation (structured, validated output)
- Per-skill allowlist checked before global safety validator in the debug route (defense-in-depth per context decisions)
- Graceful degradation: when no skills loaded or skill selection fails, falls back to direct LLM call preserving existing behavior

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Orchestrator complete: skill routing, context injection, fix plan generation all working
- Phase 2 fully complete: skill system (01), log analysis (02), orchestrator (03)
- Ready for Phase 3: execution engine can consume FixPlan steps with rollback info
- Ready for Phase 3: per-step risk levels enable approval gate integration

---
*Phase: 02-skill-system-and-orchestrator*
*Completed: 2026-03-08*

## Self-Check: PASSED
