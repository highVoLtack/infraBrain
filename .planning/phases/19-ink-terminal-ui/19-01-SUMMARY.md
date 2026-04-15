---
phase: 19-ink-terminal-ui
plan: 01
subsystem: ui
tags: [ink, react, sse, terminal-ui, hooks, typescript-jsx]

# Dependency graph
requires:
  - phase: none
    provides: none (foundation plan)
provides:
  - SSE event protocol types (SSEEventMap, 9 event types)
  - DPEV state machine types (DPEVState, DPEVAction, StepState, ApprovalRequest)
  - Theme system (riskColor, providerBadge, statusIcon, palette)
  - Custom hooks (useSSE, useResponsive, usePanel)
  - TSX compilation support via react-jsx transform
  - Vitest .test.tsx discovery
affects: [19-02, 19-03, 19-04, 19-05, 19-06]

# Tech tracking
tech-stack:
  added: [ink@7, react@19, @inkjs/ui@2, ink-testing-library@4, @types/react@19]
  patterns: [SSE async generator parser, pure breakpoint extraction for testability, mutable state factory for panel management]

key-files:
  created:
    - src/ui/types.ts
    - src/ui/theme.ts
    - src/ui/hooks/useSSE.ts
    - src/ui/hooks/useResponsive.ts
    - src/ui/hooks/usePanel.ts
    - tests/ui/hooks.test.tsx
  modified:
    - package.json
    - tsconfig.json
    - vitest.config.ts

key-decisions:
  - "Extracted getLayoutMode as pure function from useResponsive for testability without React context"
  - "usePanel implemented as mutable state factory (not React useState) for direct testability and later React wrapping"
  - "parseSSEStream persists event/data state across chunk boundaries for split-chunk resilience"
  - "@inkjs/ui@2 installed without peer dependency conflicts with Ink v7"

patterns-established:
  - "Pure function extraction: separate testable logic from React hook wrapper (getLayoutMode pattern)"
  - "SSE async generator: parseSSEStream yields {event, data} from fetch ReadableStream"
  - "State factory pattern: usePanel returns mutable object for both direct and React usage"

requirements-completed: [TERM-05, TERM-07]

# Metrics
duration: 7min
completed: 2026-04-15
---

# Phase 19 Plan 01: Ink Foundation Summary

**Ink v7 + React 19 framework with SSE event protocol types, theme system, and 3 custom hooks (useSSE, useResponsive, usePanel) -- 27 tests passing**

## Performance

- **Duration:** 7 min
- **Started:** 2026-04-15T13:00:34Z
- **Completed:** 2026-04-15T13:08:15Z
- **Tasks:** 2
- **Files modified:** 9

## Accomplishments
- Ink v7 + React 19 + @inkjs/ui v2 installed with zero peer dependency conflicts
- TSX compilation working via react-jsx transform, vitest discovers .test.tsx files
- SSE event protocol fully typed: 9 event types covering all DPEV phases and execution events
- Theme system with risk colors, provider badges, status icons, and color palette
- Three custom hooks: parseSSEStream async generator, responsive breakpoints, panel focus cycling
- 27 tests covering all hooks, theme functions, and type constants

## Task Commits

Each task was committed atomically:

1. **Task 1: Install Ink framework, configure TSX compilation and test discovery** - `10a96e0` (chore)
2. **Task 2 RED: Add failing tests** - `02600ed` (test)
3. **Task 2 GREEN: Implement types, theme, hooks** - `3d129d9` (feat)

## Files Created/Modified
- `src/ui/types.ts` - SSE event protocol types, DPEV state machine interfaces, layout types
- `src/ui/theme.ts` - Risk colors, provider badges, status icons, color palette
- `src/ui/hooks/useSSE.ts` - parseSSEStream async generator + useSSE React hook
- `src/ui/hooks/useResponsive.ts` - Responsive breakpoint hook with getLayoutMode pure function
- `src/ui/hooks/usePanel.ts` - Panel focus management with Tab cycling
- `tests/ui/hooks.test.tsx` - 27 tests covering all hooks, theme, and types
- `package.json` - Added ink@7, react@19, @inkjs/ui@2, ink-testing-library@4, @types/react@19
- `tsconfig.json` - Added jsx: react-jsx, jsxImportSource: react
- `vitest.config.ts` - Added .test.tsx to include pattern

## Decisions Made
- Extracted `getLayoutMode` as a pure function from `useResponsive` for testability without React context
- Implemented `usePanel` as mutable state factory pattern for direct testability (React useState wrapper deferred to component integration)
- Persisted SSE event/data state across chunk boundaries in `parseSSEStream` to handle split-chunk edge cases
- @inkjs/ui@2 installs cleanly with Ink v7 -- no compatibility wrappers needed (resolves RESEARCH.md open question 1)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed parseSSEStream state persistence across chunks**
- **Found during:** Task 2 (GREEN phase)
- **Issue:** `currentEvent` and `currentData` variables were scoped inside the read loop, causing accumulated SSE fields to be lost when data was split across chunks
- **Fix:** Moved `currentEvent` and `currentData` declarations outside the while loop so they persist across read() calls
- **Files modified:** src/ui/hooks/useSSE.ts
- **Verification:** Split-chunk test now passes
- **Committed in:** 3d129d9 (Task 2 GREEN commit)

**2. [Rule 3 - Blocking] Adapted tests for ESM module system**
- **Found during:** Task 2 (GREEN phase)
- **Issue:** Tests used `require()` for usePanel (fails in ESM) and `vi.doMock` with dynamic import for useResponsive (module caching prevents mock re-application)
- **Fix:** Changed usePanel tests to use direct import; extracted `getLayoutMode` pure function from useResponsive and tested that directly
- **Files modified:** tests/ui/hooks.test.tsx, src/ui/hooks/useResponsive.ts
- **Verification:** All 27 tests pass
- **Committed in:** 3d129d9 (Task 2 GREEN commit)

---

**Total deviations:** 2 auto-fixed (1 bug, 1 blocking)
**Impact on plan:** Both auto-fixes necessary for correctness and ESM compatibility. No scope creep.

## Issues Encountered
None beyond the auto-fixed deviations documented above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All types, hooks, and theme system ready for import by subsequent plans
- Plan 19-02 (SSE endpoints) can import SSEEventMap and event constants
- Plan 19-03 (panel layout) can import useResponsive, usePanel, theme
- Plan 19-04 (DPEV panel) can import DPEVState, DPEVAction, useSSE

---
*Phase: 19-ink-terminal-ui*
*Completed: 2026-04-15*
