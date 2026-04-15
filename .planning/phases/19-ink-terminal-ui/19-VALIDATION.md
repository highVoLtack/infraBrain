---
phase: 19
slug: ink-terminal-ui
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-04-15
---

# Phase 19 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.0.18 |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run tests/ui tests/api/stream-*.test.ts --reporter=verbose` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run tests/ui --reporter=verbose`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | Test File | Status |
|---------|------|------|-------------|-----------|-------------------|-----------|--------|
| 19-01-T1 | 01 | 1 | TERM-05, TERM-07 | build | `npx tsc --noEmit 2>&1 \| tail -5` | N/A (compilation check) | pending |
| 19-01-T2 | 01 | 1 | TERM-05, TERM-07 | unit | `npx vitest run tests/ui/hooks.test.tsx --reporter=verbose` | tests/ui/hooks.test.tsx | pending |
| 19-02-T1 | 02 | 2 | TERM-02, TERM-07 | integration | `npx vitest run tests/api/stream-debug.test.ts --reporter=verbose` | tests/api/stream-debug.test.ts | pending |
| 19-02-T2 | 02 | 2 | TERM-02, TERM-07 | integration | `npx vitest run tests/api/stream-execute.test.ts --reporter=verbose` | tests/api/stream-execute.test.ts | pending |
| 19-03-T1 | 03 | 2 | TERM-01, TERM-03, TERM-06 | unit | `npx vitest run tests/ui/components.test.tsx --reporter=verbose` | tests/ui/components.test.tsx | pending |
| 19-03-T2 | 03 | 2 | TERM-03, TERM-06 | unit | `npx vitest run tests/ui/components.test.tsx --reporter=verbose` | tests/ui/components.test.tsx | pending |
| 19-04-T1 | 04 | 3 | TERM-01, TERM-02 | unit | `npx vitest run tests/ui/dpev-panel.test.tsx --reporter=verbose` | tests/ui/dpev-panel.test.tsx | pending |
| 19-04-T2 | 04 | 3 | TERM-01, TERM-02 | unit | `npx vitest run tests/ui/dpev-panel.test.tsx --reporter=verbose` | tests/ui/dpev-panel.test.tsx | pending |
| 19-05-T1 | 05 | 2 | TERM-04, TERM-05 | unit | `npx vitest run tests/ui/layout.test.tsx --reporter=verbose` | tests/ui/layout.test.tsx | pending |
| 19-05-T2 | 05 | 2 | TERM-04, TERM-05 | unit | `npx vitest run tests/ui/layout.test.tsx --reporter=verbose` | tests/ui/layout.test.tsx | pending |
| 19-06-T1 | 06 | 4 | TERM-04, TERM-08 | unit | `npx vitest run tests/ui/app.test.tsx --reporter=verbose` | tests/ui/app.test.tsx | pending |
| 19-06-T2 | 06 | 4 | TERM-08 | integration | `npx vitest run tests/cli/ tests/ui/app.test.tsx --reporter=verbose` | tests/cli/commands.test.ts, tests/ui/app.test.tsx | pending |
| 19-06-T3 | 06 | 4 | ALL | checkpoint | `npm test` | Full suite | pending |

*Status: pending / green / red / flaky*

---

## Test File to Plan Mapping

| Test File | Created By | Requirements Covered |
|-----------|------------|---------------------|
| `tests/ui/hooks.test.tsx` | Plan 01 Task 2 | TERM-05, TERM-07 (SSE types, responsive breakpoints, panel cycling) |
| `tests/api/stream-debug.test.ts` | Plan 02 Task 1 | TERM-02, TERM-07 (SSE streaming, cache hit approval) |
| `tests/api/stream-execute.test.ts` | Plan 02 Task 2 | TERM-02, TERM-07 (execution streaming, step approval) |
| `tests/ui/components.test.tsx` | Plan 03 Tasks 1+2 | TERM-01, TERM-03, TERM-06 (streaming text, approval components, step cards) |
| `tests/ui/dpev-panel.test.tsx` | Plan 04 Tasks 1+2 | TERM-01, TERM-02 (DPEV state machine, panel integration) |
| `tests/ui/layout.test.tsx` | Plan 05 Tasks 1+2 | TERM-04, TERM-05 (responsive layout, header bar, session/entity panels) |
| `tests/ui/app.test.tsx` | Plan 06 Task 1 | TERM-04, TERM-08 (root app, status overlay, keyboard routing) |
| `tests/cli/commands.test.ts` | Plan 06 Task 2 (existing + extended) | TERM-08 (backward CLI compatibility) |

---

## Requirement Coverage

| Requirement | Test Files | Plans |
|-------------|------------|-------|
| TERM-01 | components.test.tsx, dpev-panel.test.tsx | 03, 04 |
| TERM-02 | stream-debug.test.ts, dpev-panel.test.tsx | 02, 04 |
| TERM-03 | components.test.tsx | 03 |
| TERM-04 | layout.test.tsx, app.test.tsx | 05, 06 |
| TERM-05 | hooks.test.tsx, layout.test.tsx | 01, 05 |
| TERM-06 | components.test.tsx | 03 |
| TERM-07 | hooks.test.tsx, stream-debug.test.ts, stream-execute.test.ts | 01, 02 |
| TERM-08 | app.test.tsx, commands.test.ts | 06 |

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Token-by-token visual streaming | TERM-02 | Perceptual timing of token render rate cannot be unit-tested | Run `/infra:debug` on live fault, visually confirm tokens appear incrementally (not batched) |
| Terminal width responsiveness | TERM-05 | Real terminal resize events differ from mocked width | Resize terminal during active session, confirm layout transitions at 80 and 120 col breakpoints |
| Keyboard navigation fluency | TERM-03, TERM-05 | Input focus cycling and vim aliases require real stdin | Tab between panels, use j/k in entity graph, type `/` for search, confirm no stuck focus |
| Live entity graph updates | TERM-01 | Real-time entity appearance during DPEV requires full pipeline | Run discovery on multi-container stack, confirm entities appear in right panel as discovered |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify commands
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Test file to plan mapping is complete and accurate
- [x] No watch-mode flags
- [x] Feedback latency < 30s
- [x] `nyquist_compliant: true` set in frontmatter
- [x] No references to non-existent plans

**Approval:** pending
