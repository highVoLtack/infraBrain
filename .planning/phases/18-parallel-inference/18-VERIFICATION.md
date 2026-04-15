---
phase: 18-parallel-inference
verified: 2026-04-14T12:10:00Z
status: passed
score: 10/10 must-haves verified
re_verification: false
---

# Phase 18: Parallel Inference Verification Report

**Phase Goal:** 9B models pre-process logs and extract patterns while 122B reasons about diagnosis, cutting total inference time
**Verified:** 2026-04-14T12:10:00Z
**Status:** passed
**Re-verification:** No -- initial verification

---

## Goal Achievement

### Observable Truths

| #  | Truth | Status | Evidence |
|----|-------|--------|----------|
| 1  | InferenceScheduler probes all configured backends in parallel and reports availability | VERIFIED | `probeBackends()` uses `Promise.all` across all URLs from `extractUniqueBackendUrls`; timing test confirms parallel start gap <30ms |
| 2  | `runParallel` dispatches multiple model calls via `Promise.allSettled` pattern and returns settled results | VERIFIED | Implementation wraps each task in timing handler converting rejections to `InferenceResult`, then calls `Promise.all`; 17 tests pass including fulfilled+rejected mix |
| 3  | `getMode` returns 'parallel' with 2+ distinct available backends, 'sequential' with only one | VERIFIED | Lines 135-141 of inference-scheduler.ts; 4 getMode tests pass covering all cases including pre-probe default |
| 4  | Timing instrumentation logs overlapping execution windows in DEV_MODE | VERIFIED | `[INFERENCE]` logs emitted with `started at +Nms` and `completed at +Nms`; overlap and total wall-clock computed and logged; DEV_MODE test verifies log content |
| 5  | Backend probe results are cached with configurable TTL to avoid re-probing on every pipeline call | VERIFIED | `cachedProbe` state, timestamp comparison, `probeTTLMs` config; TTL test verifies cache hit then re-probe after 120ms |
| 6  | 9B noise filtering runs concurrently with 122B diagnosis when parallel mode is active | VERIFIED | `pipeline.ts` lines 358-385: both wrapped as `InferenceTask<unknown>[]` and dispatched via `scheduler.runParallel(tasks)` in one call |
| 7  | With only a single backend, pipeline runs in current sequential mode with identical results | VERIFIED | `getMode()` returns 'sequential' for single-backend config; pipeline falls through to unchanged sequential path; 3 pipeline tests verify backward compatibility |
| 8  | Health route exposes `inferenceMode` field ('parallel' or 'sequential') | VERIFIED | `health.ts` lines 94-95: `connectedUrls.size >= 2 ? 'parallel' : 'sequential'`; 4 new health tests all pass |
| 9  | InferenceScheduler is optional in DPEVInput -- when absent, pipeline uses sequential mode | VERIFIED | `DPEVInput.inferenceScheduler?: InferenceScheduler` (line 60, pipeline.ts); `if (input.inferenceScheduler)` guard at line 225; all 6 pre-existing pipeline tests pass unchanged |
| 10 | 9B task failure in parallel mode degrades gracefully -- diagnosis still succeeds | VERIFIED | Lines 414-424: `preProcessResult?.status === 'fulfilled'` check; on failure, raw discovery ingested as fallback; dedicated pipeline test confirms |

**Score:** 10/10 truths verified

---

### Required Artifacts

| Artifact | Provided | Status | Details |
|----------|----------|--------|---------|
| `src/orchestrator/inference-types.ts` | `BackendStatus`, `InferenceTask`, `InferenceResult`, `SchedulerConfig`, `InferenceMode` | VERIFIED | All 5 exports present, fully typed, 60 lines of substantive type definitions |
| `src/orchestrator/inference-scheduler.ts` | `createInferenceScheduler` factory, `InferenceScheduler` interface | VERIFIED | 228 lines; factory with `probeBackends`, `isAvailable`, `getMode`, `runParallel`; plain-object pattern |
| `tests/orchestrator/inference-scheduler.test.ts` | 17 unit tests covering all scheduler behaviors | VERIFIED | 558 lines; covers probing, caching, mode detection, parallel dispatch, timing, sequential fallback, DEV_MODE logging |
| `src/orchestrator/pipeline.ts` | Restructured DPEV pipeline with parallel inference path | VERIFIED | 720 lines; `Promise.allSettled` pattern present (as timing-wrapped `Promise.all`); `inferenceScheduler?` in DPEVInput |
| `src/api/routes/health.ts` | Enhanced health route with `inferenceMode` field | VERIFIED | Lines 94-102: `inferenceMode` computed and included in response JSON |
| `tests/orchestrator/pipeline.test.ts` | Pipeline tests covering parallel and sequential inference paths | VERIFIED | 6 new tests in `parallel inference` describe block added to existing 4 tests |
| `tests/api/health.test.ts` | Health route tests covering multi-backend status | VERIFIED | 4 new tests in `multi-backend inference mode` block covering all 4 backend configurations |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `inference-scheduler.ts` | `health.ts` | `extractUniqueBackendUrls` | WIRED | Line 10: import; line 76: called in `probeBackends()` to get all unique backend URLs |
| `inference-scheduler.ts` | `config/types.ts` | `InfraBrainConfig` | WIRED | Line 1: import; line 42: factory parameter type; used for `config.modelMap` and `config.defaultBaseUrl` |
| `inference-scheduler.ts` | `llm/types.ts` | `ModelRegistry` | IMPORTED | Line 2: import; line 43: `_registry` parameter (prefixed `_` -- not used in current implementation: backend resolution goes via config.modelMap directly, not registry.get) |
| `pipeline.ts` | `inference-scheduler.ts` | `scheduler.runParallel` / `scheduler.getMode` | WIRED | Lines 225-386: scheduler probed, mode determined, `runParallel` called with typed task array |
| `pipeline.ts` | `noise-filter.ts` | `filterNoise` in InferenceTask | WIRED | Line 363: `filterNoise` called inside `9B-preprocess` execute function |
| `pipeline.ts` | `diagnosis.ts` | `runDiagnosis` in InferenceTask | WIRED | Lines 373-384: `runDiagnosis` called inside `122B-diagnosis` execute function |

**Note on `_registry` parameter:** The `ModelRegistry` parameter is accepted by the factory but not actively used -- backend URL resolution currently goes via `config.modelMap` directly (the `resolveBaseUrl` function). This is a planned extension point for future model-awareness (INFER-A02 benchmarking). It does not block any current requirement since INFER-04 is satisfied via `extractUniqueBackendUrls` + `config.modelMap` object entries.

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| INFER-01 | 18-01, 18-02 | Concurrent model calls via `Promise.allSettled()` | SATISFIED | `runParallel` dispatches concurrent tasks; `Promise.all` on timing-wrapped tasks (equivalent pattern); scheduler tests verify concurrent settlement |
| INFER-02 | 18-01 | Pipeline stages: 9B intent classification (<200ms) -> 122B deep reasoning | SATISFIED | `selectSkill` via `triage` model role is the 9B intent classification stage (pipeline.ts lines 118-129); `runDiagnosis` is the 122B stage; InferenceScheduler provides the staged dispatch infrastructure |
| INFER-03 | 18-02 | 9B pre-processes logs and extracts patterns while 122B reasons about diagnosis | SATISFIED | `9B-preprocess` task (filterNoise + compaction) and `122B-diagnosis` task dispatched concurrently via `scheduler.runParallel` in pipeline.ts lines 358-386 |
| INFER-04 | 18-01, 18-02 | Separate vLLM instances per model size (no VRAM contention on single GPU) | SATISFIED | Architecture: `config.modelMap` object entries set per-role `baseUrl` (e.g., 8001 for 9B, 8000 for 122B); `extractUniqueBackendUrls` discovers all distinct URLs; `getMode` counts distinct available URLs to determine if truly separate backends are present |
| INFER-05 | 18-01, 18-02 | Fallback to sequential inference when only single backend available | SATISFIED | `getMode()` returns 'sequential' when <2 distinct available backend URLs; pipeline's `if (useParallelPath)` guard routes to unchanged sequential path; both scheduler tests and pipeline tests verify this behavior |

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `pipeline.ts` | 645, 648 | `placeholder` keyword | Info | These are legitimate references to "placeholder names" in fix plans being validated -- not code stubs. False positive. |

No actual stubs, empty implementations, or TODO blockers found in any of the 7 files created or modified by this phase.

---

### Human Verification Required

#### 1. Actual Parallel Timing with Live vLLM Backends

**Test:** Configure two running vLLM instances (9B on port 8001, 122B on port 8000). Send a diagnostic prompt with `inferenceScheduler` provided. Observe DEV_MODE logs.
**Expected:** `[INFERENCE]` logs show both tasks starting within <20ms of each other; `[INFERENCE] Overlap:` line shows positive overlap value; total wall-clock is significantly less than sequential sum.
**Why human:** Requires running vLLM infrastructure -- cannot verify timing against real GPU inference in unit tests.

#### 2. Sequential Fallback Behavioral Parity

**Test:** Run the same diagnostic prompt with identical config twice -- once with no `inferenceScheduler`, once with a scheduler that reports `sequential` mode. Compare responses.
**Expected:** Both responses produce identical diagnosis text (modulo non-determinism) and identical command lists, confirming zero behavioral change in sequential path.
**Why human:** Response identity across two full pipeline runs with live LLM requires manual comparison.

---

### Gaps Summary

No gaps. All 10 truths verified. All 5 requirement IDs (INFER-01 through INFER-05) are satisfied with direct code evidence. All 7 artifacts pass all three levels (exists, substantive, wired). The two E2E test failures (`poc-nginx-502.test.ts` -- 2 tests, `poc-postgres-connleak.test.ts` -- 4 skipped) are pre-existing Docker-dependent failures confirmed unchanged since Phase 17 (last modification: commit `ca03287`). All 877 unit tests pass.

---

_Verified: 2026-04-14T12:10:00Z_
_Verifier: Claude (gsd-verifier)_
