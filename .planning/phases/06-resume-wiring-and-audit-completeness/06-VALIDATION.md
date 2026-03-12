---
phase: 6
slug: resume-wiring-and-audit-completeness
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-12
---

# Phase 6 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.0.18 |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run --reporter=verbose` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --reporter=verbose`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 06-01-01 | 01 | 1 | INTF-07a | integration | `npx vitest run tests/execution/executor.test.ts -x` | ❌ W0 | ⬜ pending |
| 06-01-02 | 01 | 1 | INTF-07b | unit | `npx vitest run tests/api/resume.test.ts -x` | ✅ needs update | ⬜ pending |
| 06-01-03 | 01 | 1 | INTF-07c | unit | `npx vitest run tests/cli/commands.test.ts -x` | ❌ W0 | ⬜ pending |
| 06-02-01 | 02 | 1 | SAFE-09 | unit | `npx vitest run tests/execution/executor.test.ts -x` | ❌ W0 | ⬜ pending |
| 06-01-04 | 01 | 1 | SC-5 | unit | `npx vitest run tests/cli/commands.test.ts -x` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] New test cases in `tests/execution/executor.test.ts` — lock audit events emitted on acquire/release
- [ ] New test cases in `tests/execution/executor.test.ts` or execute route tests — halt persists resumeMetadata
- [ ] Update `tests/api/resume.test.ts` — verify real runner wired (not stub)
- [ ] Test for formatResumeSummary integration in CLI resume flow

*Existing infrastructure covers framework install — vitest already configured.*

---

## Manual-Only Verifications

*All phase behaviors have automated verification.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
