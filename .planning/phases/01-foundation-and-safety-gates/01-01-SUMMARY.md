---
phase: 01-foundation-and-safety-gates
plan: 01
subsystem: llm
tags: [vercel-ai-sdk, ollama, typescript, esm, vitest, zod, token-budget]

# Dependency graph
requires:
  - phase: none
    provides: greenfield project
provides:
  - TypeScript ESM project scaffold with Vitest test framework
  - LLM provider abstraction (createProvider) wrapping Vercel AI SDK streamText/generateText
  - Ollama model factory (createOllamaModel) as sole ai-sdk-ollama import point
  - Token budget estimation, pre-flight checking, and usage tracking
  - Config types with Zod schema and default values
affects: [01-02, 01-03, 01-04, 02-01]

# Tech tracking
tech-stack:
  added: [ai@6.x, ai-sdk-ollama@3.x, express@5.x, better-sqlite3@12.x, commander@14.x, zod@4.x, uuid@13.x, chalk@5.x, typescript@5.x, vitest@4.x, tsx, tsup]
  patterns: [provider-abstraction, factory-pattern, tdd-red-green]

key-files:
  created: [package.json, tsconfig.json, vitest.config.ts, src/index.ts, src/llm/types.ts, src/llm/provider.ts, src/llm/ollama.ts, src/llm/token-budget.ts, src/config/types.ts, src/config/defaults.ts, tests/llm/provider.test.ts, tests/llm/token-budget.test.ts]
  modified: []

key-decisions:
  - "Used LanguageModel type from AI SDK v6 (union of string | V3 | V2) for provider interface"
  - "Used maxOutputTokens instead of maxTokens (AI SDK v6 API change from v5)"
  - "Zod v4 installed (latest); API compatible with plan's z.object usage"

patterns-established:
  - "Provider abstraction: all LLM calls go through createProvider, never import Ollama directly"
  - "Factory pattern: createOllamaModel is the sole ai-sdk-ollama import point (CORE-02)"
  - "TDD workflow: write failing tests first, then implement to pass"
  - "ESM with .js extensions in all TypeScript import paths"

requirements-completed: [CORE-01, CORE-02, CORE-09]

# Metrics
duration: 5min
completed: 2026-03-07
---

# Phase 1 Plan 01: Project Scaffolding and LLM Provider Summary

**TypeScript ESM project with Vercel AI SDK v6 provider abstraction, Ollama factory, and token budget enforcement using 4-char heuristic estimation**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-07T13:57:02Z
- **Completed:** 2026-03-07T14:02:19Z
- **Tasks:** 2
- **Files modified:** 12

## Accomplishments
- TypeScript ESM project initialized with all production and dev dependencies
- LLM provider abstraction with streamDiagnosis (streaming) and generateCommand (one-shot) methods
- Ollama isolated behind factory function -- sole ai-sdk-ollama import point ensures CORE-02 pluggability
- Token budget system: estimateTokens (4-char heuristic with CJK adjustment), checkBudget (pre-flight validation), trackUsage (80% warning threshold)
- 13 tests passing across provider and token-budget test suites

## Task Commits

Each task was committed atomically:

1. **Task 1: Initialize project and create LLM provider abstraction** - `d69fee0` (feat)
2. **Task 2: Implement token budget tracking and enforcement** - `6fc1fee` (feat)

_Note: TDD tasks -- tests written first (RED), then implementation (GREEN)_

## Files Created/Modified
- `package.json` - Project config with ESM, scripts, all dependencies
- `tsconfig.json` - TypeScript config targeting ES2022 with NodeNext resolution
- `vitest.config.ts` - Vitest test configuration
- `src/index.ts` - Entry point re-exporting LLM modules
- `src/llm/types.ts` - LLMProvider interface, TokenUsage, TaskBudget types
- `src/llm/provider.ts` - createProvider wrapping AI SDK streamText/generateText
- `src/llm/ollama.ts` - createOllamaModel factory (sole Ollama import)
- `src/llm/token-budget.ts` - estimateTokens, checkBudget, trackUsage
- `src/config/types.ts` - Zod schema for InfraBrainConfig
- `src/config/defaults.ts` - DEFAULT_CONFIG and OLLAMA_HEALTH_URL
- `tests/llm/provider.test.ts` - 6 tests for provider and ollama factory
- `tests/llm/token-budget.test.ts` - 7 tests for token budget system

## Decisions Made
- Used `LanguageModel` type from AI SDK v6 instead of `LanguageModelV1` (v6 renamed types)
- Used `maxOutputTokens` instead of `maxTokens` in streamText/generateText calls (AI SDK v6 breaking change)
- Zod v4 was installed as latest; API is compatible with plan specifications
- Set `skipLibCheck: true` in tsconfig for faster compilation with third-party types

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed AI SDK v6 type name changes**
- **Found during:** Task 1
- **Issue:** Plan specified `LanguageModelV1` and `maxTokens` but AI SDK v6 uses `LanguageModel` and `maxOutputTokens`
- **Fix:** Updated imports to use `LanguageModel` type, replaced `maxTokens` with `maxOutputTokens` in provider calls
- **Files modified:** src/llm/types.ts, src/llm/provider.ts, tests/llm/provider.test.ts
- **Verification:** TypeScript compiles cleanly, all tests pass
- **Committed in:** d69fee0

**2. [Rule 3 - Blocking] Fixed Zod v4 default() on nested object**
- **Found during:** Task 1
- **Issue:** `.default({})` on a nested Zod object with required defaults caused TypeScript error in v4
- **Fix:** Changed to `.default({ diagnosis: 4096, command: 2048 })` with explicit values
- **Files modified:** src/config/types.ts
- **Verification:** TypeScript compiles cleanly
- **Committed in:** d69fee0

---

**Total deviations:** 2 auto-fixed (both blocking -- library API differences from plan assumptions)
**Impact on plan:** Both fixes necessary to work with current library versions. No scope creep.

## Issues Encountered
None beyond the auto-fixed deviations above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- LLM provider abstraction ready for all downstream plans
- Token budget system ready for integration with safety gates (Plan 03)
- Config schema ready for state storage expansion (Plan 02)
- All 13 plan-specific tests passing; 40 total tests in suite green

## Self-Check: PASSED

All 12 created files verified present. Both task commits (d69fee0, 6fc1fee) verified in git log.

---
*Phase: 01-foundation-and-safety-gates*
*Completed: 2026-03-07*
