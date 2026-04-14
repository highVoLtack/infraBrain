---
phase: 17-mempalace-semantic-memory
plan: 04
subsystem: memory
tags: [intent-classification, memory-skill, auto-filing, lancedb, vercel-ai-sdk, generateObject, semantic-memory]

# Dependency graph
requires:
  - phase: 17-01
    provides: MemPalace type contracts (IncidentRecord, EntityRecord, WALEntry, MemoryConfig), WAL, config schema
  - phase: 17-02
    provides: IncidentStore, EntityStore, entity extractor, memory scoring
  - phase: 17-03
    provides: searchWithDecay, formatIncidentEmbeddingInput, wake-up context, pipeline integration
provides:
  - LLM-based intent classifier for memory queries (memory/action/combined)
  - Memory skill with list/narrative/combined response formatting
  - memory.md skill file for skill routing with German+English triggers
  - Incident auto-filing in execute route after successful DPEV execution
  - Entity extraction and filing into EntityStore during auto-filing
  - WAL audit trail before every memory mutation in execute route
affects: [18-parallel-inference, 19-ink-terminal-ui]

# Tech tracking
tech-stack:
  added: []
  patterns: [LLM intent classification via generateObject, memory skill routing, non-critical auto-filing in execute route]

key-files:
  created:
    - src/memory/intent-classifier.ts
    - src/memory/memory-skill.ts
    - skills/memory.md
    - tests/memory/intent-classifier.test.ts
    - tests/memory/memory-skill.test.ts
  modified:
    - src/api/routes/execute.ts
    - tests/api/routes.test.ts
    - tests/api/resume.test.ts
    - tests/api/rolling-context-routes.test.ts
    - tests/e2e/poc-nginx-502.test.ts
    - tests/e2e/poc-postgres-connleak.test.ts
    - tests/e2e/postgres-loop-guard.test.ts
    - tests/e2e/poc-permission-trap.test.ts
    - tests/e2e/poc-docker-storage.test.ts
    - tests/skills/loader.test.ts

key-decisions:
  - "Intent classifier uses generateObject with workerModel per CONTEXT.md locked decision for structured LLM output"
  - "Graceful degradation on classifier failure: treat as action query (safe default)"
  - "root_cause sourced from structuredDiagnosis.rootCause, not req.body.diagnosis, for semantically distinct embedding input"
  - "Memory filing is non-critical: wrapped in try-catch, never affects execution response (matches cache pattern)"

patterns-established:
  - "Intent classification: classifyIntent(prompt, workerModel) returns structured IntentResult via zod schema"
  - "Memory skill: handleMemoryQuery(params) formats search results by format_hint (list/narrative/combined)"
  - "Auto-filing pattern: WAL append before store mutation, entity extraction after incident filing"
  - "Memory mock pattern: 6 additional modules (wal, entity-extractor, memory-search, embedder, incident-store, entity-store) mocked in all test files importing execute.ts"

requirements-completed: [MEM-01, MEM-05]

# Metrics
duration: 11min
completed: 2026-04-14
---

# Phase 17 Plan 04: Intent Classifier, Memory Skill & Auto-Filing Summary

**LLM-based intent classifier for natural language memory queries, memory skill with list/narrative/combined formatting, and incident auto-filing in execute route with WAL-first entity extraction**

## Performance

- **Duration:** 11 min
- **Started:** 2026-04-14T11:53:50Z
- **Completed:** 2026-04-14T12:04:37Z
- **Tasks:** 2 (Task 1 TDD: RED + GREEN, Task 2 auto)
- **Files modified:** 15

## Accomplishments
- Intent classifier classifies memory/action/combined queries via workerModel with time range extraction and format hints
- Memory skill searches incidents with temporal decay and formats responses in list, narrative, or combined format
- memory.md skill file with German+English triggers (priority 8, below domain experts at 10)
- Execute route auto-files every completed incident with WAL-first mutation pattern
- root_cause and diagnosis are semantically distinct in IncidentRecord for richer embedding vectors
- Entity extraction populates EntityStore with embedded context for knowledge graph
- 14 new tests (9 intent classifier + 5 memory skill), all passing
- Memory mocks added to 8 test files to prevent LanceDB init during tests

## Task Commits

Each task was committed atomically (TDD flow for Task 1):

1. **Task 1 RED: Failing intent classifier + memory skill tests** - `4cb7f19` (test)
2. **Task 1 GREEN: Intent classifier + memory skill + memory.md** - `d4ca089` (feat)
3. **Task 2: Execute route auto-filing + test mocks** - `ca03287` (feat)

## Files Created/Modified
- `src/memory/intent-classifier.ts` - LLM-based intent classification via generateObject with workerModel
- `src/memory/memory-skill.ts` - Memory query handler with list/narrative/combined formatting and time range filtering
- `skills/memory.md` - Memory skill markdown with German+English triggers, priority 8
- `src/api/routes/execute.ts` - Incident auto-filing block after cache write, WAL-first entity extraction
- `tests/memory/intent-classifier.test.ts` - 9 tests for classification accuracy, time range, fallback, system prompt
- `tests/memory/memory-skill.test.ts` - 5 tests for response formatting, time range filtering, empty results
- `tests/skills/loader.test.ts` - Updated to expect 7 skills (added memory.md)
- `tests/api/routes.test.ts` - Added wal, entity-extractor, memory-search, embedder mocks
- `tests/api/resume.test.ts` - Added cache and memory mocks for execute route imports
- `tests/api/rolling-context-routes.test.ts` - Added cache and memory mocks
- `tests/e2e/poc-nginx-502.test.ts` - Added wal, entity-extractor, memory-search, embedder mocks
- `tests/e2e/poc-postgres-connleak.test.ts` - Added wal, entity-extractor, memory-search, embedder mocks
- `tests/e2e/postgres-loop-guard.test.ts` - Added wal, entity-extractor, memory-search, embedder mocks
- `tests/e2e/poc-permission-trap.test.ts` - Added full cache and memory mock suite
- `tests/e2e/poc-docker-storage.test.ts` - Added full cache and memory mock suite

## Decisions Made
- Intent classifier uses generateObject (same pattern as router.ts and planner.ts) with workerModel for cost-effective classification
- Graceful degradation on classifier failure: returns action fallback (`{ type: 'action', search_query: prompt, format_hint: 'combined' }`)
- root_cause sourced from `structuredDiagnosis.rootCause` (one-sentence), falls back to `planResult.data.summary` -- never from `req.body.diagnosis` which is the full free-text diagnosis
- Memory filing wrapped in same try-catch pattern as cache write: non-critical, never affects execution response
- memory.md includes German trigger words (hatten wir, letzte, fruher, wann war) alongside English triggers
- System prompt injects current ISO timestamp for accurate relative-to-absolute time conversion

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Updated skill loader test to expect 7 skills**
- **Found during:** Task 2 (verification)
- **Issue:** Adding memory.md to skills/ directory caused loader.test.ts to fail (expected 6 skills, found 7)
- **Fix:** Updated test to expect 7 skills and include 'memory' in expected name list
- **Files modified:** tests/skills/loader.test.ts
- **Verification:** Skill loader test passes
- **Committed in:** ca03287 (Task 2 commit)

**2. [Rule 3 - Blocking] Added memory mocks to 6 additional test files**
- **Found during:** Task 2 (verification)
- **Issue:** Adding memory imports to execute.ts caused 6 test files (resume, rolling-context, poc-permission-trap, poc-docker-storage, and 3 e2e tests) to fail due to missing memory/cache mocks
- **Fix:** Added appropriate memory mock blocks (wal, entity-extractor, memory-search, embedder) to all affected test files
- **Files modified:** tests/api/resume.test.ts, tests/api/rolling-context-routes.test.ts, tests/e2e/poc-permission-trap.test.ts, tests/e2e/poc-docker-storage.test.ts, tests/e2e/poc-nginx-502.test.ts, tests/e2e/poc-postgres-connleak.test.ts, tests/e2e/postgres-loop-guard.test.ts
- **Verification:** All affected tests pass
- **Committed in:** ca03287 (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (1 bug, 1 blocking)
**Impact on plan:** Both auto-fixes essential for test correctness. No scope creep.

## Issues Encountered
None beyond the test mock issues documented above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 17 (MemPalace Semantic Memory) is now complete -- all 4 plans executed
- Intent classifier ready for integration with skill routing in future phases
- Memory skill ready for Ink terminal formatting in Phase 19
- Auto-filing ensures every completed incident is stored with semantic embeddings
- Entity graph populated for future relationship-based queries
- All memory types, stores, search, wake-up context, and auto-filing are integrated end-to-end
- Phase 18 (Parallel Inference) and Phase 19 (Ink Terminal UI) can proceed

## Self-Check: PASSED

All files verified present, all commits verified in git log.

---
*Phase: 17-mempalace-semantic-memory*
*Completed: 2026-04-14*
