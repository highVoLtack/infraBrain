---
phase: 18
slug: parallel-inference
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-14
---

# Phase 18 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.0.18 |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run tests/orchestrator/inference-scheduler.test.ts tests/orchestrator/pipeline.test.ts` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run tests/orchestrator/inference-scheduler.test.ts tests/orchestrator/pipeline.test.ts`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 18-01-01 | 01 | 1 | INFER-01 | unit | `npx vitest run tests/orchestrator/inference-scheduler.test.ts -t "concurrent"` | ❌ W0 | ⬜ pending |
| 18-01-02 | 01 | 1 | INFER-02 | unit | `npx vitest run tests/orchestrator/inference-scheduler.test.ts -t "pipeline stages"` | ❌ W0 | ⬜ pending |
| 18-01-03 | 01 | 1 | INFER-05 | unit + integration | `npx vitest run tests/orchestrator/inference-scheduler.test.ts -t "fallback"` | ❌ W0 | ⬜ pending |
| 18-02-01 | 02 | 2 | INFER-03 | integration | `npx vitest run tests/orchestrator/pipeline.test.ts -t "parallel inference"` | ❌ W0 | ⬜ pending |
| 18-02-02 | 02 | 2 | INFER-04 | unit | `npx vitest run tests/api/health.test.ts -t "multiple backends"` | ✅ (partial) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/orchestrator/inference-scheduler.test.ts` — stubs for INFER-01, INFER-02, INFER-05
- [ ] `tests/orchestrator/pipeline.test.ts` — parallel inference stubs for INFER-03
- [ ] Extend `tests/api/health.test.ts` — multi-backend stubs for INFER-04

*Existing infrastructure covers framework and config — no new installs needed.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| VRAM contention absence on real GPU | INFER-04 | Requires actual GPU hardware with two vLLM instances | Start both vLLM instances with documented --gpu-memory-utilization splits, run diagnosis, confirm nvidia-smi shows no OOM |
| <200ms warm-cache intent classification | INFER-02 | Latency depends on hardware and vLLM warmup state | After vLLM warm, time 5 consecutive intent classifications, confirm p95 <200ms |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
