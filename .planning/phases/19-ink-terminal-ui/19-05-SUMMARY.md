---
phase: 19-ink-terminal-ui
plan: 05
subsystem: ui
tags: [ink, react, layout, panels, entity-graph, session-history, express-api]

# Dependency graph
requires:
  - phase: 19-01
    provides: Ink v7 framework, hooks (useResponsive, usePanel), theme system, types
provides:
  - Responsive 3/2/1 panel layout container (PanelLayout)
  - Persistent header bar with live health data (HeaderBar)
  - Date-grouped session history panel (SessionPanel)
  - Provider-grouped entity knowledge graph panel (EntityPanel)
  - Session item formatting with status icons and domain badges
  - Entity tree with live/memory indicators
  - Entity detail pane with provider + resourceType
  - GET /entities API endpoint serving active entities from EntityStore
affects: [19-06]

# Tech tracking
tech-stack:
  added: []
  patterns: [pure-function-extraction for testable layout/formatting logic, provider-grouped entity display, date-grouped session display, graceful-fallback entity API]

key-files:
  created:
    - src/ui/layout/PanelLayout.tsx
    - src/ui/layout/HeaderBar.tsx
    - src/ui/panels/SessionPanel.tsx
    - src/ui/panels/EntityPanel.tsx
    - src/ui/components/SessionItem.tsx
    - src/ui/components/EntityTree.tsx
    - src/ui/components/EntityDetail.tsx
    - src/api/routes/entities.ts
    - tests/ui/layout.test.tsx
  modified:
    - src/api/server.ts

key-decisions:
  - "Pure function extraction pattern (getPanelConfig, parseHealthData, formatSessionItem, groupSessionsByDate, groupEntitiesByProvider, formatEntityDetail) for unit testing without React context"
  - "Text domain badges [D]/[P]/[N] instead of emoji for terminal compatibility"
  - "EntityStoreReader interface for dependency injection in entities route (test-friendly)"
  - "GET /entities queries all 6 entity types and merges/deduplicates (EntityStore.getActive requires entityType param)"
  - "Windowed session rendering (max 20 visible) to prevent performance issues per RESEARCH.md Pitfall 3"

patterns-established:
  - "Pure function extraction: every Ink component exports a pure formatting/config function for test isolation"
  - "Graceful API fallback: /entities returns [] on any error, never 500"
  - "Date grouping: Today (<24h), Yesterday (24-48h), This Week (2-7d), Older (>7d)"
  - "Provider grouping: entities grouped by provider with color-coded badges from theme"

requirements-completed: [TERM-04, TERM-05]

# Metrics
duration: 6min
completed: 2026-04-15
---

# Phase 19 Plan 05: Panel Layout & Side Panels Summary

**Responsive 3/2/1 panel layout with header bar, date-grouped session tree, provider-grouped entity graph with detail pane, and GET /entities API endpoint -- 30 tests passing**

## Performance

- **Duration:** 6 min
- **Started:** 2026-04-15T13:11:03Z
- **Completed:** 2026-04-15T13:17:40Z
- **Tasks:** 2
- **Files modified:** 10

## Accomplishments
- PanelLayout adapts to 3 breakpoints: full (>=120 cols, 3 panels 20/55/25), compact (80-119, 2 panels 25/75), minimal (<80, center only)
- HeaderBar fetches /health every 30s showing inference mode badge, active model, backend health dots with color adaptation
- SessionPanel groups sessions by date (Today/Yesterday/This Week/Older) with fuzzy search and keyboard navigation
- EntityPanel splits into tree (top) and detail (bottom), merges API entities with live entities from DPEV session
- All entity displays include provider and resourceType per user decision
- GET /entities endpoint serves active entities from EntityStore with graceful empty-array fallback
- 30 tests covering all pure functions, layout logic, and API endpoint behavior

## Task Commits

Each task was committed atomically:

1. **Task 1 RED: Failing tests for PanelLayout and HeaderBar** - `559c318` (test)
2. **Task 1 GREEN: Implement PanelLayout and HeaderBar** - `c26b4c3` (feat)
3. **Task 2 RED: Failing tests for SessionPanel, EntityPanel, GET /entities** - `514569b` (test)
4. **Task 2 GREEN: Implement side panels, components, GET /entities** - `7f0caaf` (feat)

## Files Created/Modified
- `src/ui/layout/PanelLayout.tsx` - Responsive 3/2/1 panel layout with getPanelConfig pure function
- `src/ui/layout/HeaderBar.tsx` - Persistent header with parseHealthData pure function, 30s health polling
- `src/ui/panels/SessionPanel.tsx` - Left panel with date grouping, fuzzy search, windowed rendering
- `src/ui/panels/EntityPanel.tsx` - Right panel with entity tree + detail split, API + live entity merge
- `src/ui/components/SessionItem.tsx` - Session entry with status icon, domain badge, timeAgo
- `src/ui/components/EntityTree.tsx` - Provider-grouped entity tree with live/memory indicators
- `src/ui/components/EntityDetail.tsx` - Entity detail pane with provider + resourceType
- `src/api/routes/entities.ts` - GET /entities endpoint with EntityStoreReader interface
- `src/api/server.ts` - Mounted /entities route alongside existing routes
- `tests/ui/layout.test.tsx` - 30 tests covering all components and endpoint

## Decisions Made
- Extracted pure functions from every component (getPanelConfig, parseHealthData, formatSessionItem, groupSessionsByDate, groupEntitiesByProvider, formatEntityDetail) following the getLayoutMode pattern from Plan 01
- Used text domain badges [D]/[P]/[N]/[R]/[M]/[J] instead of emoji since terminal emoji support varies
- Created EntityStoreReader interface for dependency injection in entities route (avoids tight coupling to LanceDB EntityStore class)
- GET /entities queries all 6 entity types (container, port, ip, error_code, service, hostname) and deduplicates since EntityStore.getActive() requires entityType parameter
- Windowed session rendering caps at 20 visible items to prevent terminal performance issues per RESEARCH.md Pitfall 3

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed EntityStore type compatibility in server.ts**
- **Found during:** Task 2 (GET /entities implementation)
- **Issue:** EntityStore.getActive() takes `(entityType: string, wing?: Wing)` but entities route used generic `(...args: unknown[])` signature, causing TypeScript error
- **Fix:** Created EntityStoreReader interface with proper signature `getActive(entityType: string, wing?: string)` for type-safe dependency injection
- **Files modified:** src/api/routes/entities.ts
- **Verification:** `npx tsc --noEmit` shows no errors in our files
- **Committed in:** 7f0caaf (Task 2 GREEN commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Type fix necessary for TypeScript compilation. No scope creep.

## Issues Encountered
None beyond the auto-fixed deviation documented above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All layout components, side panels, and header bar ready for integration
- Plan 19-06 (App shell + integration) can import PanelLayout, HeaderBar, SessionPanel, EntityPanel
- GET /entities endpoint available for entity panel data fetching
- Tab cycling visual indicator works via activePanel prop to PanelLayout

## Self-Check: PASSED

All 10 created/modified files verified on disk. All 4 task commits (559c318, c26b4c3, 514569b, 7f0caaf) verified in git log.

---
*Phase: 19-ink-terminal-ui*
*Completed: 2026-04-15*
