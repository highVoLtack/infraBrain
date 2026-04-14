---
phase: 17-mempalace-semantic-memory
plan: 02
subsystem: memory
tags: [lancedb, vector-search, entity-extraction, temporal-decay, knowledge-graph, semantic-memory]

# Dependency graph
requires:
  - phase: 17-01
    provides: MemPalace type contracts (IncidentRecord, EntityRecord, Wing, MemoryConfig), WAL, config schema
  - phase: 16-qdrant-fix-caching
    provides: CacheStore singleton pattern, LanceDB seed-row-then-delete, embedder, confidence scoring formula
provides:
  - IncidentStore with vector search, wing filtering, getRecent, getStats
  - EntityStore with type-based queries, temporal validity, incident relationships
  - Entity extractor detecting containers, services, hostnames, IPs, ports, error codes from diagnostic text
  - Memory scoring with exponential decay (lambda=0.02, w_sim=0.6, w_rec=0.4)
affects: [17-03-PLAN, 17-04-PLAN]

# Tech tracking
tech-stack:
  added: []
  patterns: [IncidentStore singleton with LanceDB, EntityStore with temporal validity filtering, regex-based multi-type entity extraction, word-boundary service detection]

key-files:
  created:
    - src/memory/incident-store.ts
    - src/memory/entity-store.ts
    - src/memory/entity-extractor.ts
    - src/memory/memory-scoring.ts
    - tests/memory/incident-store.test.ts
    - tests/memory/entity-store.test.ts
    - tests/memory/entity-extractor.test.ts
    - tests/memory/memory-scoring.test.ts
  modified: []

key-decisions:
  - "EntityStore getActive() filters expired entities in application layer (LanceDB SQL lacks temporal operators)"
  - "Entity extractor uses word-boundary regex for 20+ known service names to prevent false positives"
  - "Container name regex requires at least one hyphen/underscore to distinguish from plain English words"
  - "searchByEntities uses in-app filtering (not SQL IN) due to LanceDB query limitations"

patterns-established:
  - "IncidentStore singleton: getIncidentStore(dir) with clearIncidentStoreCache() for testing"
  - "EntityStore singleton: getEntityStore(dir) with clearEntityStoreCache() for testing"
  - "Temporal validity: valid_to='' means active, non-empty ISO date means expired"
  - "Entity extraction pipeline: regex detect -> deduplicate -> EntityRecord creation"

requirements-completed: [MEM-01, MEM-03, MEM-06, MEM-07, MEM-08]

# Metrics
duration: 7min
completed: 2026-04-14
---

# Phase 17 Plan 02: Stores, Entity Extraction & Scoring Summary

**LanceDB incident and entity stores with vector search and wing filtering, regex entity extractor for 6 entity types, and exponential decay memory scoring with lambda=0.02**

## Performance

- **Duration:** 7 min
- **Started:** 2026-04-14T11:23:27Z
- **Completed:** 2026-04-14T11:30:27Z
- **Tasks:** 2 (both TDD: RED + GREEN)
- **Files modified:** 8

## Accomplishments
- IncidentStore with add, search (wing filter), getRecent (sorted desc), getStats (totalIncidents, topDomains, successRate) -- all with graceful degradation
- EntityStore with add, searchByType, searchByEntities, searchByIncidentId, getActive (temporal validity) -- all with graceful degradation
- Entity extractor detecting containers, services (20 known names), hostnames (.internal/.local/.lan/.corp/.cluster), IPs, ports, error codes with word-boundary false-positive prevention
- Memory scoring producing correct exponential decay: 7-day ~0.87, 30-day ~0.55, 90-day ~0.17 recency
- 29 new tests (14 store + 15 extractor/scoring), 38 total memory tests all passing

## Task Commits

Each task was committed atomically (TDD flow):

1. **Task 1 RED: Failing store tests** - `1cb3277` (test)
2. **Task 1 GREEN: IncidentStore + EntityStore** - `88a27cb` (feat)
3. **Task 2 RED: Failing extractor/scoring tests** - `462453b` (test)
4. **Task 2 GREEN: Entity extractor + memory scoring** - `f5a7e2e` (feat)

## Files Created/Modified
- `src/memory/incident-store.ts` - LanceDB store for incidents with vector search, wing filtering, getRecent, getStats
- `src/memory/entity-store.ts` - LanceDB store for entities with type queries, temporal validity, incident relationships
- `src/memory/entity-extractor.ts` - Regex-based entity extraction for 6 types (container, service, hostname, ip, port, error_code)
- `src/memory/memory-scoring.ts` - Exponential decay scoring with configurable weights (w_sim, w_rec, decayLambda)
- `tests/memory/incident-store.test.ts` - 7 integration tests with real LanceDB in temp directories
- `tests/memory/entity-store.test.ts` - 7 integration tests with real LanceDB in temp directories
- `tests/memory/entity-extractor.test.ts` - 9 tests for extraction accuracy and false-positive prevention
- `tests/memory/memory-scoring.test.ts` - 6 tests with fake timers for deterministic decay verification

## Decisions Made
- EntityStore getActive() filters expired entities in application layer because LanceDB SQL lacks temporal comparison operators -- simpler than encoding timestamps as numbers
- Entity extractor uses word-boundary regex (`\bredis\b`) for 20+ known infrastructure service names, preventing false positives like "redistribution" matching "redis"
- Container name regex requires at least one hyphen or underscore to distinguish from plain English words (e.g., "backend-api" matches, "backend" alone does not)
- searchByEntities queries all rows and filters in-app rather than building dynamic SQL IN clauses, keeping LanceDB query surface simple and predictable

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- IncidentStore and EntityStore ready for Plan 03 (wake-up context, L0-L3 layers)
- Entity extractor ready for knowledge graph population during incident auto-filing
- Memory scoring ready for search result ranking with temporal decay
- All types imported from src/memory/types.ts (single source of truth per Plan 01)
- No blockers for downstream plans

## Self-Check: PASSED

All files verified present, all commits verified in git log.

---
*Phase: 17-mempalace-semantic-memory*
*Completed: 2026-04-14*
