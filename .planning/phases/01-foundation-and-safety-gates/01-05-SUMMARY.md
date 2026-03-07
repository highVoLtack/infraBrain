---
phase: 01-foundation-and-safety-gates
plan: 05
subsystem: llm, cli, safety
tags: [token-budget, approval-gate, gap-closure, readline, pre-flight-check]

# Dependency graph
requires:
  - phase: 01-01
    provides: LLM provider abstraction (createProvider), token budget module (checkBudget)
  - phase: 01-03
    provides: Approval gate (requestApproval), formatter (formatApprovalResult), risk classifier
  - phase: 01-04
    provides: CLI commands (registerCommands), REPL (startRepl), debug command flow
provides:
  - Token budget enforcement wired into every LLM call (pre-flight check in provider.ts)
  - Approval gate wired into debug command flow for interactive mode
  - No orphaned modules remaining in Phase 1
affects: [02-01, 03-01]

# Tech tracking
tech-stack:
  added: []
  patterns: [pre-flight-budget-check, late-binding-readline, approval-gate-in-command-loop]

key-files:
  created: []
  modified:
    - src/llm/provider.ts
    - src/cli/commands.ts
    - src/cli/repl.ts
    - tests/llm/provider.test.ts
    - tests/cli/commands.test.ts

key-decisions:
  - "setReadline() late-binding pattern to inject readline from REPL into commands module"
  - "Approval gate skipped in one-shot mode (no rl) for backward compatibility"
  - "Budget check throws Error on overflow (fail-fast, caller must handle)"

patterns-established:
  - "Pre-flight budget check: every LLM call checks token budget before sending to model"
  - "Late-binding readline: commands module accepts rl via setReadline() after REPL creates it"

requirements-completed: [CORE-01, CORE-02, CORE-09, CORE-10, SAFE-01, SAFE-02, SAFE-03, SAFE-09, SAFE-10, INTF-01, INTF-05, INTF-06]

# Metrics
duration: 3min
completed: 2026-03-07
---

# Phase 1 Plan 05: Token Budget and Approval Gate Wiring Summary

**Pre-flight token budget enforcement before every LLM call and interactive approval gate after /infra:debug returns commands, closing both Phase 1 gap-closure items**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-07T22:42:39Z
- **Completed:** 2026-03-07T22:45:55Z
- **Tasks:** 2 (both TDD)
- **Files modified:** 5

## Accomplishments
- provider.ts now calls checkBudget before every streamText/generateText call, throwing on overflow
- Debug command flow calls requestApproval for each allowed command when readline is available
- formatApprovalResult displays approval/rejection outcome after each command
- Blocked commands displayed but skip approval gate entirely
- 88 total tests passing across 10 test files (8 new tests added)
- Both previously orphaned modules (token-budget.ts, approval.ts) now imported in production code

## Task Commits

Each task was committed atomically (TDD: RED then GREEN):

1. **Task 1: Wire token budget enforcement into LLM provider**
   - `b0e5d77` (test) -- RED: failing budget enforcement tests
   - `388a3ca` (feat) -- GREEN: checkBudget wired into provider.ts
2. **Task 2: Wire approval gate into CLI debug command flow**
   - `6b3df92` (test) -- RED: failing approval wiring tests
   - `a66c8aa` (feat) -- GREEN: requestApproval wired into commands.ts

## Files Created/Modified
- `src/llm/provider.ts` - Added checkBudget import and pre-flight call before streamText/generateText
- `src/cli/commands.ts` - Added requestApproval + formatApprovalResult imports, approval loop in debug action, setReadline export
- `src/cli/repl.ts` - Calls setReadline after creating readline interface
- `tests/llm/provider.test.ts` - 4 new tests: budget exceeded/allowed for both generateCommand and streamDiagnosis
- `tests/cli/commands.test.ts` - 4 new tests: approval called, result displayed, blocked skipped, rejection shown

## Decisions Made
- setReadline() late-binding pattern chosen over restructuring index.ts initialization order (fewer changes needed)
- Approval gate skipped when no readline available (backward compatible with one-shot CLI mode)
- Budget check throws Error on overflow rather than returning error object (fail-fast pattern)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 1 fully complete: all foundation components wired, tested, and connected
- No orphaned modules remain -- every Phase 1 module is imported in production code
- 88 tests across 10 files providing regression safety for Phase 2 development
- LLM provider with budget enforcement ready for skill system integration (Phase 2)
- Safety validation pipeline with approval gates ready for execution engine (Phase 3)

---
*Phase: 01-foundation-and-safety-gates*
*Completed: 2026-03-07*

## Self-Check: PASSED

All 5 modified files verified present. All 4 task commits (b0e5d77, 388a3ca, 6b3df92, a66c8aa) verified in git log. 88 tests passing.
