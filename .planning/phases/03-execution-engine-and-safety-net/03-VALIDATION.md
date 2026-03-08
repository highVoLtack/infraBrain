---
phase: 3
slug: execution-engine-and-safety-net
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-08
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.x |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run --reporter=verbose` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~20 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --reporter=verbose`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 20 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 03-01-01 | 01 | 0 | CORE-08 | unit | `npx vitest run tests/execution/runner.test.ts` | ❌ W0 | ⬜ pending |
| 03-01-02 | 01 | 0 | SAFE-04 | unit | `npx vitest run tests/execution/circuit-breaker.test.ts` | ❌ W0 | ⬜ pending |
| 03-01-03 | 01 | 0 | SAFE-05, SAFE-06 | unit | `npx vitest run tests/execution/damage-budget.test.ts` | ❌ W0 | ⬜ pending |
| 03-01-04 | 01 | 0 | SAFE-07 | unit | `npx vitest run tests/execution/snapshot.test.ts` | ❌ W0 | ⬜ pending |
| 03-01-05 | 01 | 0 | SAFE-08 | integration | `npx vitest run tests/execution/rollback.test.ts` | ❌ W0 | ⬜ pending |
| 03-02-01 | 02 | 0 | INTF-08, INTF-09, INTF-10 | unit | `npx vitest run tests/locks/manager.test.ts` | ❌ W0 | ⬜ pending |
| 03-03-01 | 03 | 0 | CORE-07 | unit | `npx vitest run tests/execution/context-builder.test.ts` | ❌ W0 | ⬜ pending |
| 03-03-02 | 03 | 0 | CORE-06, SAFE-12 | integration | `npx vitest run tests/execution/executor.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/execution/runner.test.ts` — stubs for CORE-08 (command execution via execFile)
- [ ] `tests/execution/circuit-breaker.test.ts` — stubs for SAFE-04 (halt after retries)
- [ ] `tests/execution/damage-budget.test.ts` — stubs for SAFE-05, SAFE-06 (budget tracking, double cost)
- [ ] `tests/execution/snapshot.test.ts` — stubs for SAFE-07 (pre-execution capture)
- [ ] `tests/execution/rollback.test.ts` — stubs for SAFE-08 (automatic rollback)
- [ ] `tests/execution/context-builder.test.ts` — stubs for CORE-07 (isolated LLM context)
- [ ] `tests/execution/executor.test.ts` — stubs for CORE-06, SAFE-12 (end-to-end loop, alerts)
- [ ] `tests/locks/manager.test.ts` — stubs for INTF-08, INTF-09, INTF-10 (locking system)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Rolling context with live LLM | CORE-07 | Requires live LLM to verify context carries between steps | Run a multi-step fix plan and verify step 2 references step 1 results |
| Admin alert CLI formatting | SAFE-12 | Visual formatting verification | Trigger circuit breaker and verify bold red warning displays correctly |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 20s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
