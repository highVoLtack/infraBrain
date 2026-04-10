---
phase: 16
slug: qdrant-fix-caching
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-10
---

# Phase 16 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.0.18 |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run tests/cache/` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run tests/cache/`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 16-01-01 | 01 | 1 | CACHE-01 | unit | `npx vitest run tests/cache/lance-store.test.ts -x` | ❌ W0 | ⬜ pending |
| 16-01-02 | 01 | 1 | CACHE-02 | unit | `npx vitest run tests/cache/embedder.test.ts -x` | ❌ W0 | ⬜ pending |
| 16-01-03 | 01 | 1 | CACHE-06 | unit | `npx vitest run tests/cache/confidence.test.ts -x` | ❌ W0 | ⬜ pending |
| 16-02-01 | 02 | 2 | CACHE-03 | unit+int | `npx vitest run tests/cache/cache-lookup.test.ts -x` | ❌ W0 | ⬜ pending |
| 16-02-02 | 02 | 2 | CACHE-05 | unit | `npx vitest run tests/cache/invalidation.test.ts -x` | ❌ W0 | ⬜ pending |
| 16-02-03 | 02 | 2 | CACHE-07 | unit | `npx vitest run tests/cache/degradation.test.ts -x` | ❌ W0 | ⬜ pending |
| 16-03-01 | 03 | 3 | CACHE-08 | unit | `npx vitest run tests/cache/provenance.test.ts -x` | ❌ W0 | ⬜ pending |
| 16-03-02 | 03 | 3 | CACHE-03 | integration | `npx vitest run tests/cache/pipeline-integration.test.ts -x` | ❌ W0 | ⬜ pending |
| 16-03-03 | 03 | 3 | CACHE-04 | integration | `npx vitest run tests/cache/performance.test.ts -x` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/cache/` directory — all test files listed above
- [ ] Mock LanceDB table for unit tests (in-memory, no disk)
- [ ] Mock embedding function for deterministic test vectors
- [ ] Shared fixtures for cache entry payloads

*Existing vitest infrastructure covers framework setup.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| "Cache Hit" visible in terminal output | CACHE-08 | Terminal formatting requires visual inspection | Run same error twice, verify "Cache Hit" label and provenance display |
| Sub-2s perceived latency on cache hit | CACHE-04 | Wall-clock timing in real pipeline | Time second run of identical error scenario |
| "Use cached fix or re-diagnose?" prompt | CACHE-03 | Interactive prompt requires user | Trigger cache hit, verify prompt appears |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
