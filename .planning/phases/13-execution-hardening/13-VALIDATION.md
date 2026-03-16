---
phase: 13
slug: execution-hardening
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-16
---

# Phase 13 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (existing) |
| **Config file** | vitest.config.ts (existing) |
| **Quick run command** | `npx vitest run tests/api/sanity-checker.test.ts tests/execution/self-healer.test.ts tests/execution/persistence-verification.test.ts --reporter=verbose` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run tests/api/sanity-checker.test.ts tests/execution/self-healer.test.ts tests/execution/persistence-verification.test.ts --reporter=verbose`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 13-01-01 | 01 | 1 | ENGN-09a | unit | `npx vitest run tests/execution/persistence-verification.test.ts -x` | ❌ W0 | ⬜ pending |
| 13-01-02 | 01 | 1 | ENGN-09d | unit | `npx vitest run tests/execution/persistence-verification.test.ts -x` | ❌ W0 | ⬜ pending |
| 13-01-03 | 01 | 1 | ENGN-09e | unit | `npx vitest run tests/execution/persistence-verification.test.ts -x` | ❌ W0 | ⬜ pending |
| 13-02-01 | 02 | 1 | ENGN-09b | unit | `npx vitest run tests/api/sanity-checker.test.ts -x` | ✅ (needs update) | ⬜ pending |
| 13-02-02 | 02 | 1 | ENGN-09c | unit | `npx vitest run tests/api/sanity-checker.test.ts -x` | ✅ (needs new test) | ⬜ pending |
| 13-02-03 | 02 | 1 | ENGN-09f | integration | `npx vitest run tests/api/debug-dpev.test.ts -x` | ✅ (may need update) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/execution/persistence-verification.test.ts` — stubs for ENGN-09a, ENGN-09d, ENGN-09e
- [ ] Update `tests/api/sanity-checker.test.ts` — add structured diagnosis exemption test (ENGN-09c)

*Existing infrastructure covers remaining phase requirements.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| 7-role model routing with different model sizes | ENGN-09 (routing) | Requires multi-GPU hardware + multiple models loaded | Run multi-fault demo on RunPod with SSH tunnel, verify triage <3s with 7B model |
| Multi-fault demo 5/5 zero manual intervention | ENGN-09 | Requires live Docker environment + LLM inference | Run full multi-fault demo, observe all 5 faults fixed autonomously |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
