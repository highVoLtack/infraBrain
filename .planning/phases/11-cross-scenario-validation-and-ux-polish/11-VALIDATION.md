---
phase: 11
slug: cross-scenario-validation-and-ux-polish
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-13
---

# Phase 11 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest ^4.0.18 |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run tests/e2e/ --reporter=verbose` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~20 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run tests/e2e/ --reporter=verbose`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 20 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 11-01-01 | 01 | 1 | E2E-03 | e2e | `npx vitest run tests/e2e/poc-postgres-connleak.test.ts -t "DPEV"` | Partial (refactor) | ⬜ pending |
| 11-01-02 | 01 | 1 | E2E-03 | e2e | `npx vitest run tests/e2e/poc-docker-storage.test.ts -t "DPEV"` | Partial (refactor) | ⬜ pending |
| 11-02-01 | 02 | 1 | UX-01 | unit | `npx vitest run tests/api/history.test.ts -t "default"` | ❌ W0 | ⬜ pending |
| 11-02-02 | 02 | 1 | UX-02 | unit | `npx vitest run tests/api/history.test.ts -t "alias"` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/e2e/helpers/assert-dpev-sequence.ts` — shared DPEV sequence validator (E2E-03)
- [ ] `tests/e2e/helpers/create-mock-provider.ts` — shared mock LLM factory
- [ ] `tests/e2e/helpers/index.ts` — barrel export
- [ ] `tests/api/history.test.ts` — unit tests for default-to-latest and alias resolution (UX-01, UX-02)

---

## Manual-Only Verifications

*All phase behaviors have automated verification.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 20s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
