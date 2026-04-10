---
phase: 14
slug: pipeline-parallel-discovery
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-10
---

# Phase 14 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.0.18 |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run tests/orchestrator/discovery.test.ts` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run tests/orchestrator/ tests/api/`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 14-01-01 | 01 | 0 | EXEC-01 | unit | `npx vitest run tests/orchestrator/discovery.test.ts -t "parallel"` | ❌ W0 | ⬜ pending |
| 14-01-02 | 01 | 0 | EXEC-02 | unit | `npx vitest run tests/orchestrator/discovery.test.ts -t "mutex"` | ❌ W0 | ⬜ pending |
| 14-01-03 | 01 | 0 | EXEC-04 | unit | `npx vitest run tests/orchestrator/discovery.test.ts -t "merge"` | ❌ W0 | ⬜ pending |
| 14-01-04 | 01 | 0 | EXEC-03 | unit | `npx vitest run tests/execution/executor.test.ts` | ✅ | ⬜ pending |
| 14-02-01 | 02 | 1 | — | integration | `npx vitest run tests/orchestrator/pipeline.test.ts` | ❌ W0 | ⬜ pending |
| 14-03-01 | 03 | 1 | — | integration | `npx vitest run tests/api/debug-extraction.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/orchestrator/discovery.test.ts` — stubs for EXEC-01, EXEC-02, EXEC-04 (parallel, mutex, merge)
- [ ] `tests/orchestrator/pipeline.test.ts` — covers pipeline extraction, DPEV sequence preservation
- [ ] `tests/api/debug-extraction.test.ts` — covers debug.ts < 200 lines, response shape unchanged
- [ ] `npm install p-queue` — required dependency

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Wall-clock speedup observable | EXEC-01 | Timing depends on I/O latency | Run discovery against 3+ containers, compare sequential vs parallel elapsed time |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
