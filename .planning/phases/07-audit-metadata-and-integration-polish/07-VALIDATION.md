---
phase: 7
slug: audit-metadata-and-integration-polish
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-12
---

# Phase 7 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.x |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run --reporter=verbose` |
| **Full suite command** | `npx vitest run --reporter=verbose` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --reporter=verbose`
- **After every plan wave:** Run `npx vitest run --reporter=verbose`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 07-01-01 | 01 | 1 | SAFE-11, INTF-03 | unit + integration | `npx vitest run tests/state/ tests/api/` | ❌ W0 | ⬜ pending |
| 07-02-01 | 02 | 1 | SKIL-03, SKIL-04 | unit + integration | `npx vitest run tests/api/debug.test.ts tests/log-analysis/` | ❌ W0 | ⬜ pending |
| 07-03-01 | 03 | 1 | CORE-07 | unit | `npx vitest run tests/execution/` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Tests for audit metadata persistence in SQLite
- [ ] Tests for log pre-filter wiring in debug route
- [ ] Tests for rolling context injection in executor

*Existing test infrastructure covers framework setup; new test files needed for new behaviors.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `/infra:history` shows execution summaries | INTF-03 | Visual output formatting | Run history command after execution, verify non-empty summaries |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
