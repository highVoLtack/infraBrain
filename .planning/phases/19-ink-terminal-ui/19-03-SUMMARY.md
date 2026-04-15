---
phase: 19-ink-terminal-ui
plan: 03
subsystem: ui
tags: [ink, react, terminal-ui, components, useInput, ink-testing-library]

# Dependency graph
requires:
  - phase: 19-ink-terminal-ui/01
    provides: "Types (DPEVPhaseState, StepState, ApprovalRequest, CacheHitProvenance), theme (riskColor, statusIcon, providerBadge), TSX compilation"
provides:
  - StreamingText component (windowed token text rendering)
  - DPEVPhaseHeader component (phase name, model, live elapsed timer)
  - StepCard component (step number, command, risk badge, status icon, auto-expand)
  - ApprovalWrite component (Y/N approval via useInput)
  - ApprovalDestructive component (typed target confirmation via useInput)
  - CacheHitBanner component (confidence, provenance, Y/N gate)
affects: [19-04, 19-05, 19-06]

# Tech tracking
tech-stack:
  added: []
  patterns: [async test flush for React 19 batched state updates, character-by-character useInput for testable text input, windowed line rendering for terminal overflow prevention]

key-files:
  created:
    - src/ui/components/StreamingText.tsx
    - src/ui/components/DPEVPhaseHeader.tsx
    - src/ui/components/CacheHitBanner.tsx
    - src/ui/components/StepCard.tsx
    - src/ui/components/ApprovalWrite.tsx
    - src/ui/components/ApprovalDestructive.tsx
    - tests/ui/components.test.tsx
  modified: []

key-decisions:
  - "ApprovalDestructive uses useInput character-by-character instead of @inkjs/ui TextInput for reliable ink-testing-library testability"
  - "React 19 batched state updates require setTimeout(50ms) flush in ink-testing-library tests for post-input re-render verification"
  - "StepCard uses @inkjs/ui Spinner for running status, static icons for other states"

patterns-established:
  - "Async test flush: await setTimeout(50ms) after stdin.write() before checking lastFrame() for state-dependent renders"
  - "Windowed display: split text by newlines, take last N lines -- prevents terminal overflow (RESEARCH.md Pitfall 3)"
  - "Character-by-character input: useInput building string state for typed confirmation -- avoids TextInput testing complexity"

requirements-completed: [TERM-01, TERM-03, TERM-06]

# Metrics
duration: 5min
completed: 2026-04-15
---

# Phase 19 Plan 03: Core Components Summary

**Six Ink UI components -- streaming text with windowed display, DPEV phase header with live timer, step cards with risk badges, two-tier approval gates (Y/N and typed-target), cache hit banner with provenance -- 18 tests passing**

## Performance

- **Duration:** 5 min
- **Started:** 2026-04-15T13:11:13Z
- **Completed:** 2026-04-15T13:16:30Z
- **Tasks:** 2 (TDD: RED-GREEN each)
- **Files modified:** 7

## Accomplishments
- 6 Ink React components built and independently tested via ink-testing-library
- StreamingText uses windowed rendering (last N lines) per RESEARCH.md Pitfall 3
- DPEVPhaseHeader shows live elapsed timer with 1-second interval for active phases
- StepCard auto-expands stdout/stderr on failure with truncated output
- ApprovalWrite/ApprovalDestructive use Ink useInput (NOT readline) per TERM-03
- CacheHitBanner shows confidence percentage, truncated session ID, provider/resourceType

## Task Commits

Each task was committed atomically (TDD RED then GREEN):

1. **Task 1 RED: Failing tests for StreamingText, DPEVPhaseHeader, CacheHitBanner** - `4af6ee3` (test)
2. **Task 1 GREEN: Implement StreamingText, DPEVPhaseHeader, CacheHitBanner** - `623b230` (feat)
3. **Task 2 RED: Failing tests for StepCard, ApprovalWrite, ApprovalDestructive** - `2007ffe` (test)
4. **Task 2 GREEN: Implement StepCard, ApprovalWrite, ApprovalDestructive** - `5d298d7` (feat)

## Files Created/Modified
- `src/ui/components/StreamingText.tsx` - Token-by-token text with windowed display (last N lines)
- `src/ui/components/DPEVPhaseHeader.tsx` - Phase header with statusIcon, model name, live elapsed timer
- `src/ui/components/CacheHitBanner.tsx` - Cache hit callout with confidence %, provenance, Y/N gate
- `src/ui/components/StepCard.tsx` - Execution step with risk badge, status icon, Spinner for running
- `src/ui/components/ApprovalWrite.tsx` - Y/N approval via useInput with Approved/Rejected feedback
- `src/ui/components/ApprovalDestructive.tsx` - Typed-target confirmation via useInput with mismatch error
- `tests/ui/components.test.tsx` - 18 tests covering all 6 components

## Decisions Made
- Used `useInput` with character-by-character string building for ApprovalDestructive instead of `@inkjs/ui TextInput` -- TextInput's internal state machine doesn't integrate reliably with ink-testing-library's `stdin.write()` for automated testing
- Added `setTimeout(50ms)` flush pattern for tests that verify post-input re-renders -- React 19 batches `useState` updates and ink-testing-library's `lastFrame()` reads before the flush completes without this
- StepCard uses `@inkjs/ui Spinner` component for running status and static Unicode icons for all other states

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Replaced TextInput with useInput in ApprovalDestructive**
- **Found during:** Task 2 (GREEN phase)
- **Issue:** `@inkjs/ui TextInput` component's `onSubmit` callback did not fire reliably when `stdin.write()` was used from ink-testing-library -- the TextInput internal state machine uses a separate reducer that doesn't sync with stdin event timing
- **Fix:** Rewrote ApprovalDestructive to use Ink's `useInput` hook directly with character-by-character string accumulation (same pattern as ApprovalWrite but building a typed string instead of single-key response)
- **Files modified:** src/ui/components/ApprovalDestructive.tsx
- **Verification:** All 18 tests pass including target match and mismatch scenarios
- **Committed in:** 5d298d7 (Task 2 GREEN commit)

**2. [Rule 1 - Bug] Added async flush for React 19 batched state updates in tests**
- **Found during:** Task 2 (GREEN phase)
- **Issue:** `lastFrame()` after `stdin.write()` returned stale frame because React 19 batches `useState` updates and re-render hadn't completed
- **Fix:** Added `await new Promise(resolve => setTimeout(resolve, 50))` between stdin.write() and lastFrame() for tests that verify post-input state changes
- **Files modified:** tests/ui/components.test.tsx
- **Verification:** ApprovalWrite "shows Approved" test and ApprovalDestructive interaction tests all pass
- **Committed in:** 5d298d7 (Task 2 GREEN commit)

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 bug)
**Impact on plan:** Both auto-fixes necessary for test reliability. Component behavior unchanged -- only the input mechanism and test timing adapted.

## Issues Encountered
None beyond the auto-fixed deviations documented above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All 6 components exported and ready for composition by panel plans
- Plan 19-04 (DPEV Panel) can import DPEVPhaseHeader, StreamingText, StepCard, CacheHitBanner
- Plan 19-05 (Session Panel) can import StepCard, ApprovalWrite, ApprovalDestructive
- Established test patterns (async flush, ink-testing-library render) reusable in future UI tests

## Self-Check: PASSED

All 7 files found. All 4 commits verified.

---
*Phase: 19-ink-terminal-ui*
*Completed: 2026-04-15*
