---
phase: 15
slug: auto-compact-context
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-10
---

# Phase 15 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.x |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run tests/context/` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run tests/context/`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 15-01-01 | 01 | 1 | CTXT-01 | unit | `npx vitest run tests/context/token-counter.test.ts -t "countTokens"` | ❌ W0 | ⬜ pending |
| 15-01-02 | 01 | 1 | CTXT-01 | unit | `npx vitest run tests/context/context-manager.test.ts -t "tracks tokens"` | ❌ W0 | ⬜ pending |
| 15-01-03 | 01 | 1 | CTXT-02 | unit | `npx vitest run tests/context/context-manager.test.ts -t "compaction threshold"` | ❌ W0 | ⬜ pending |
| 15-01-04 | 01 | 1 | CTXT-02 | unit | `npx vitest run tests/context/compactor.test.ts -t "target 60"` | ❌ W0 | ⬜ pending |
| 15-01-05 | 01 | 1 | CTXT-02 | unit | `npx vitest run tests/context/context-manager.test.ts -t "fires once"` | ❌ W0 | ⬜ pending |
| 15-02-01 | 02 | 1 | CTXT-03 | unit | `npx vitest run tests/context/ground-truth.test.ts -t "auto-detect"` | ❌ W0 | ⬜ pending |
| 15-02-02 | 02 | 1 | CTXT-03 | unit | `npx vitest run tests/context/ground-truth.test.ts -t "PIN markers"` | ❌ W0 | ⬜ pending |
| 15-02-03 | 02 | 1 | CTXT-03 | unit | `npx vitest run tests/context/ground-truth.test.ts -t "20% cap"` | ❌ W0 | ⬜ pending |
| 15-03-01 | 03 | 2 | CTXT-04 | unit | `npx vitest run tests/context/compactor.test.ts -t "stale masking"` | ❌ W0 | ⬜ pending |
| 15-03-02 | 03 | 2 | CTXT-05 | unit | `npx vitest run tests/context/noise-filter.test.ts -t "healthcheck"` | ❌ W0 | ⬜ pending |
| 15-03-03 | 03 | 2 | CTXT-05 | unit | `npx vitest run tests/context/noise-filter.test.ts -t "systemd"` | ❌ W0 | ⬜ pending |
| 15-03-04 | 03 | 2 | CTXT-05 | unit | `npx vitest run tests/context/noise-filter.test.ts -t "skill patterns"` | ❌ W0 | ⬜ pending |
| 15-03-05 | 03 | 2 | CTXT-06 | unit | `npx vitest run tests/context/noise-filter.test.ts -t "worker model"` | ❌ W0 | ⬜ pending |
| 15-03-06 | 03 | 2 | CTXT-06 | unit | `npx vitest run tests/context/noise-filter.test.ts -t "below threshold"` | ❌ W0 | ⬜ pending |
| 15-E2E | 03 | 2 | E2E | integration | `npx vitest run tests/context/integration.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/context/token-counter.test.ts` — stubs for CTXT-01
- [ ] `tests/context/context-manager.test.ts` — stubs for CTXT-01, CTXT-02
- [ ] `tests/context/ground-truth.test.ts` — stubs for CTXT-03
- [ ] `tests/context/compactor.test.ts` — stubs for CTXT-02, CTXT-04
- [ ] `tests/context/noise-filter.test.ts` — stubs for CTXT-05, CTXT-06
- [ ] `tests/context/integration.test.ts` — E2E pipeline with compaction

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Admin can see token count during diagnosis | CTXT-01 (SC-1) | Dev-mode logging output requires visual inspection | Run diagnosis session, check console for token count/percentage display |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
