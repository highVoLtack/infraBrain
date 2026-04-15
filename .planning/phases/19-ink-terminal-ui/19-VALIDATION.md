---
phase: 19
slug: ink-terminal-ui
status: draft
nyquist_compliant: false
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
| **Quick run command** | `npx vitest run tests/ui --reporter=verbose` |
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

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 19-01-01 | 01 | 1 | TERM-01 | unit | `npx vitest run tests/ui/dpev-panel.test.tsx -t "phase header" -x` | Wave 0 | ⬜ pending |
| 19-02-01 | 02 | 1 | TERM-02 | unit | `npx vitest run tests/ui/streaming-text.test.tsx -x` | Wave 0 | ⬜ pending |
| 19-03-01 | 03 | 1 | TERM-03 | unit | `npx vitest run tests/ui/approval.test.tsx -x` | Wave 0 | ⬜ pending |
| 19-04-01 | 04 | 2 | TERM-04 | unit | `npx vitest run tests/ui/status-dashboard.test.tsx -x` | Wave 0 | ⬜ pending |
| 19-05-01 | 05 | 2 | TERM-05 | unit | `npx vitest run tests/ui/responsive-layout.test.tsx -x` | Wave 0 | ⬜ pending |
| 19-06-01 | 06 | 2 | TERM-06 | unit | `npx vitest run tests/ui/step-card.test.tsx -x` | Wave 0 | ⬜ pending |
| 19-07-01 | 07 | 1 | TERM-07 | integration | `npx vitest run tests/api/stream-debug.test.ts -x` | Wave 0 | ⬜ pending |
| 19-08-01 | 08 | 3 | TERM-08 | integration | `npx vitest run tests/cli/commands.test.ts -x` | Exists | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/ui/dpev-panel.test.tsx` — stubs for TERM-01 (DPEV phase header display)
- [ ] `tests/ui/streaming-text.test.tsx` — stubs for TERM-02 (token-by-token streaming render)
- [ ] `tests/ui/approval.test.tsx` — stubs for TERM-03 (all 3 approval tiers: READ/WRITE/DESTRUCTIVE)
- [ ] `tests/ui/status-dashboard.test.tsx` — stubs for TERM-04 (header bar + overlay)
- [ ] `tests/ui/responsive-layout.test.tsx` — stubs for TERM-05 (3 breakpoints: <80, 80-119, >=120)
- [ ] `tests/ui/step-card.test.tsx` — stubs for TERM-06 (step cards with risk colors)
- [ ] `tests/api/stream-debug.test.ts` — stubs for TERM-07 (SSE endpoint streaming)
- [ ] TSConfig JSX configuration: `"jsx": "react-jsx"` in tsconfig.json
- [ ] Vitest config update: include `tests/ui/**/*.test.tsx` pattern
- [ ] Framework install: `npm install ink@7 react@19 @inkjs/ui@2 ink-testing-library@4 @types/react@19`

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

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
