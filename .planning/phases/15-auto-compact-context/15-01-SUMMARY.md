---
phase: 15-auto-compact-context
plan: 01
subsystem: context
tags: [tokenizer, qwen3, bpe, noise-filter, regex, worker-model]

# Dependency graph
requires:
  - phase: 14-pipeline-parallel-discovery
    provides: runParallelDiscovery output format, worker ModelRole
provides:
  - Qwen3 BPE token counter (countTokens, getTokenizer singleton)
  - Context module types (Observation, PinnedFact, ContextSection, ContextManagerConfig, CompactionResult, EvictionResult)
  - Noise filter with regex pre-processing and worker model fallback (filterNoise, NOISE_PATTERNS)
  - noise_patterns field in SkillFrontmatterSchema
affects: [15-02, 15-03, 15-04, context-manager, pipeline-integration]

# Tech tracking
tech-stack:
  added: ["@lenml/tokenizer-qwen3"]
  patterns: ["lazy singleton tokenizer", "regex noise pipeline with worker model fallback", "10-line threshold for model invocation"]

key-files:
  created:
    - src/context/types.ts
    - src/context/token-counter.ts
    - src/context/noise-filter.ts
    - tests/context/token-counter.test.ts
    - tests/context/noise-filter.test.ts
  modified:
    - src/skills/types.ts
    - package.json

key-decisions:
  - "Plain TypeScript interfaces for context types (not zod) -- internal types, not user-facing config"
  - "Lazy singleton tokenizer pattern -- first call pays ~100-500ms init, subsequent calls instant"
  - "Worker model threshold at 10 unrecognized lines -- below that, include all lines without model call"

patterns-established:
  - "Token counter singleton: getTokenizer() lazy-inits fromPreTrained(), countTokens() wraps encode().length"
  - "Noise filter pipeline: hardcoded patterns + skill patterns + optional worker model fallback"

requirements-completed: [CTXT-01, CTXT-05, CTXT-06]

# Metrics
duration: 3min
completed: 2026-04-10
---

# Phase 15 Plan 01: Token Counter and Noise Filter Summary

**Qwen3 BPE token counter via @lenml/tokenizer-qwen3 and regex noise filter with worker model fallback for 10+ unrecognized lines**

## Performance

- **Duration:** 3 min
- **Started:** 2026-04-10T13:44:04Z
- **Completed:** 2026-04-10T13:46:59Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- Accurate Qwen3 BPE token counting replaces 4-char heuristic, critical for 83% threshold precision
- Noise filter removes healthcheck spam, systemd boilerplate, and journal metadata before LLM context injection
- Worker model invoked only when discovery key has 10+ unrecognized lines, keeping latency low
- noise_patterns field added to SkillFrontmatterSchema for skill-declared noise patterns
- 20 tests across 2 test files, all passing

## Task Commits

Each task was committed atomically:

1. **Task 1: Install tokenizer, create types, build token counter**
   - `b2f1841` (test: failing tests for token counter and context types)
   - `67d347a` (feat: implement token counter and context types)
2. **Task 2: Noise filter with regex patterns and worker model fallback**
   - `a8e337c` (test: failing tests for noise filter)
   - `de46f22` (feat: implement noise filter with regex + worker model fallback)

_TDD tasks have RED (test) and GREEN (feat) commits._

## Files Created/Modified
- `src/context/types.ts` - Shared types: Observation, PinnedFact, ContextSection, ContextManagerConfig, CompactionResult, EvictionResult
- `src/context/token-counter.ts` - Qwen3 tokenizer wrapper singleton with countTokens/getTokenizer
- `src/context/noise-filter.ts` - Regex pre-processor with hardcoded + skill patterns and worker model fallback
- `src/skills/types.ts` - Added noise_patterns field to SkillFrontmatterSchema
- `tests/context/token-counter.test.ts` - 7 tests: accuracy, empty string, heuristic difference, singleton
- `tests/context/noise-filter.test.ts` - 13 tests: all noise categories, skill patterns, worker threshold, return shape

## Decisions Made
- Plain TypeScript interfaces for context types (not zod) -- these are internal module types, not user-facing config that needs validation
- Lazy singleton tokenizer: first call initializes, subsequent calls return cached instance
- Worker model threshold fixed at 10 unrecognized lines per the CONTEXT.md decision

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Token counter ready for use by ContextManager (Plan 02+)
- Noise filter ready for pipeline integration between runParallelDiscovery and LLM prompt assembly
- Context types ready for ground truth, compactor, and context manager modules

## Self-Check: PASSED

All 5 created files verified on disk. All 4 task commits verified in git log.

---
*Phase: 15-auto-compact-context*
*Completed: 2026-04-10*
