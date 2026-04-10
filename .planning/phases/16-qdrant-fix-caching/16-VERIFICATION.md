---
phase: 16-qdrant-fix-caching
verified: 2026-04-10T21:10:00Z
status: gaps_found
score: 9/10 must-haves verified
re_verification: false
gaps:
  - truth: "Confidence scoring accumulates success/failure correctly across repeated cache hits"
    status: partial
    reason: "recordFixOutcome sets success_count = 1 (absolute) instead of incrementing the existing count. After N successful cache hits, success_count stays at 1. Confidence scoring formula (w_suc * successRate) receives stale data. Test uses expect.any(Number) which masks the defect."
    artifacts:
      - path: "src/cache/cache-lookup.ts"
        issue: "Line 193: updates.success_count = 1 and updates.fail_count = 1 set absolute values. The correct implementation must first read current counts from the entry and increment them."
      - path: "tests/cache/cache-lookup.test.ts"
        issue: "Line 222: expect.objectContaining({ success_count: expect.any(Number) }) does not assert the increment amount, masking the bug."
    missing:
      - "recordFixOutcome must fetch current entry stats via store.listAll() or expose a getEntry() method, then call store.updateStats with incremented values"
      - "Test must assert that calling recordFixOutcome twice on success results in success_count = 2"
human_verification:
  - test: "Visual provenance display in terminal"
    expected: "Second run of identical error shows '[CACHE HIT] Based on session {id} ({date}) -- Cache Hit (similarity: XX%, confidence: XX%)' in dim chalk before the diagnosis"
    why_human: "Terminal formatting and chalk.dim rendering cannot be verified programmatically"
  - test: "Sub-2s wall-clock latency on cache hit path"
    expected: "Second run of identical error returns in under 2 seconds total (embedding generation + vector search + response)"
    why_human: "Embedding generation latency depends on the Ollama/vLLM server; cannot be tested without a live embedding endpoint"
  - test: "--no-cache flag bypasses cache on debug command"
    expected: "Running 'infrabrain debug --no-cache ...' proceeds through full LLM diagnosis without cache check"
    why_human: "Requires live CLI invocation against a running server instance"
---

# Phase 16: Qdrant Fix-Caching Verification Report

**Phase Goal:** Semantic fix caching with LanceDB — repeat errors return cached fixes in under 2 seconds
**Verified:** 2026-04-10T21:10:00Z
**Status:** gaps_found
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | LanceDB store initializes in-process with no external service | ✓ VERIFIED | `src/cache/lance-store.ts` — `lancedb.connect(dataDir)` in `_doInit()`, singleton per path, seed-row-then-delete table creation. 7 passing tests in `lance-store.test.ts`. |
| 2 | Error context embeds to a 1024-dim BGE-M3 vector | ✓ VERIFIED | `src/cache/embedder.ts` — `createOpenAICompatible` + `embed()` with assertion `embedding.length !== 1024`. `formatEmbeddingInput` concatenates `ERROR: {prompt}\n\nCONTEXT:\n{discovery}`. 4 passing tests. |
| 3 | Cache lookup returns fast-path for similarity >= 0.85, speculative for 0.75–0.85, miss below | ✓ VERIFIED | `src/cache/cache-lookup.ts` lines 114–133. Three-tier classification implemented and exercised in 9 tests in `cache-lookup.test.ts`. |
| 4 | Pipeline skips LLM diagnosis entirely on fast-path cache hit | ✓ VERIFIED | `src/orchestrator/pipeline.ts` lines 276–303. On `cacheResult.type === 'fast-path'` builds DPEVResult from cached data and returns early, bypassing `runDiagnosis()`. |
| 5 | Skill file changes on startup purge only that skill's cache entries | ✓ VERIFIED | `src/cache/invalidation.ts` — SHA-256 hash comparison, only purges files where `previousHash && previousHash !== currentHash`. 7 passing tests confirm selective purge. |
| 6 | Successful fix execution stores result in cache | ✓ VERIFIED | `src/api/routes/execute.ts` line 203 — `storeFixInCache()` called after execution status `'completed'`, wrapped in try-catch. |
| 7 | Cache hit displays provenance (session ID, date, similarity%, confidence%) | ✓ VERIFIED | `src/cache/cache-lookup.ts:35-41` — `formatProvenance()` returns formatted string. `src/cli/commands.ts:215-228` renders it with `chalk.dim`. 5 passing `provenance.test.ts` tests. |
| 8 | CLI 'cache list' and 'cache clear' commands exist and wire to store | ✓ VERIFIED | `src/cli/cache-commands.ts` — `registerCacheCommands()` with `list` and `clear` subcommands. Called at `src/cli/commands.ts:680`. Key link confirmed. |
| 9 | All cache operations degrade gracefully when LanceDB/embedding unavailable | ✓ VERIFIED | Every operation in `lance-store.ts`, `embedder.ts`, `cache-lookup.ts`, `invalidation.ts` is wrapped in try-catch returning null/empty/false. 7 passing `degradation.test.ts` tests. |
| 10 | Confidence scoring accumulates success/failure correctly across repeated hits | ✗ FAILED | `src/cache/cache-lookup.ts:193` — `updates.success_count = 1` (absolute set, not increment). After 2 successful uses of the same cached entry, `success_count` remains 1. CACHE-06 confidence formula receives stale success rate data. |

**Score:** 9/10 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/cache/types.ts` | CacheEntry, CacheHit, CacheResult, CacheConfig, ConfidenceConfig, DEFAULT_* | ✓ VERIFIED | All 5 interfaces + 2 default constants exported. 67 lines, substantive. |
| `src/cache/lance-store.ts` | Singleton CacheStore with search/add/delete/list/updateStats | ✓ VERIFIED | 209 lines. Singleton via `Map<string, CacheStore>`. All 6 methods with graceful degradation. |
| `src/cache/embedder.ts` | BGE-M3 embedding via Vercel AI SDK, formatEmbeddingInput, isEmbeddingAvailable | ✓ VERIFIED | 73 lines. Uses `createOpenAICompatible` + `embed()`. Dimension assertion present. |
| `src/cache/confidence.ts` | computeConfidence with exponential decay | ✓ VERIFIED | 36 lines. Formula: `w_sim*similarity + w_rec*exp(-lambda*ageDays) + w_suc*successRate`. |
| `src/cache/cache-lookup.ts` | checkCache, storeFixInCache, recordFixOutcome, formatProvenance | ✓ VERIFIED (partial) | 203 lines. checkCache/storeFixInCache/formatProvenance fully correct. recordFixOutcome has absolute-set defect (see gaps). |
| `src/cache/invalidation.ts` | hashSkillFiles, runStartupInvalidation | ✓ VERIFIED | 95 lines. SHA-256 per .md file, selective purge on hash mismatch. |
| `src/cli/cache-commands.ts` | registerCacheCommands with list/clear | ✓ VERIFIED | 112 lines. Fully implemented with chalk table formatting, formatAge, formatSuccessRate. |
| `src/config/types.ts` | cache: section in InfraBrainConfigSchema | ✓ VERIFIED | Lines 67–78 add `cache` zod object with all 5 fields and defaults. |
| `src/orchestrator/pipeline.ts` | Cache check between noise filter and diagnosis | ✓ VERIFIED | `checkCache` imported at line 10, called at line 261, fast-path return at line 276, `noCache` flag at line 52. |
| `src/api/routes/execute.ts` | storeFixInCache after successful execution | ✓ VERIFIED | Line 203: `storeFixInCache()` with try-catch after `status === 'completed'`. |
| `src/index.ts` | Startup cache init, runStartupInvalidation, isEmbeddingAvailable | ✓ VERIFIED | Lines 72–88: `getCacheStore`, `runStartupInvalidation`, `isEmbeddingAvailable` all wired in startup sequence. |
| `tests/cache/` (9 test files) | Full test coverage for all cache subsystems | ✓ VERIFIED | 58 tests passing: confidence (5), lance-store (7), embedder (4), cache-lookup (9), invalidation (7), degradation (7), provenance (5), cli-commands (8), integration (6). |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/cache/embedder.ts` | `@ai-sdk/openai-compatible` | `createOpenAICompatible` | ✓ WIRED | Line 7 import, line 36 call with `name: 'infrabrain-embed'` |
| `src/cache/lance-store.ts` | `src/cache/types.ts` | `CacheEntry` type | ✓ WIRED | Line 9 import, used as schema for table rows |
| `src/cache/cache-lookup.ts` | `src/cache/lance-store.ts` | `store.search()` | ✓ WIRED | Line 7 import, line 81 call `store.search(embedding, 1)` |
| `src/cache/cache-lookup.ts` | `src/cache/embedder.ts` | `generateEmbedding` | ✓ WIRED | Line 10 import, line 78 call |
| `src/cache/cache-lookup.ts` | `src/cache/confidence.ts` | `computeConfidence` | ✓ WIRED | Line 11 import, line 104 call |
| `src/orchestrator/pipeline.ts` | `src/cache/cache-lookup.ts` | `checkCache()` after filterNoise | ✓ WIRED | Line 10 import, line 261 call in runDPEV, before `enforceDPEVSequence('diagnosis')` |
| `src/cache/invalidation.ts` | `src/cache/lance-store.ts` | `deleteBySkill` | ✓ WIRED | Line 11 import, line 71 call inside runStartupInvalidation |
| `src/cli/cache-commands.ts` | `src/cache/lance-store.ts` | `getCacheStore()` | ✓ WIRED | Line 8 import, called in both `list` and `clear` action handlers |
| `src/api/routes/execute.ts` | `src/cache/cache-lookup.ts` | `storeFixInCache` | ✓ WIRED | Line 13 import, line 203 call after execution success |
| `src/cli/commands.ts` | `src/cli/cache-commands.ts` | `registerCacheCommands` | ✓ WIRED | Line 30 import, line 680 call with `(program, config.config)` |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| CACHE-01 | 16-01 | LanceDB embedded vector store, auto-table management, no external service | ✓ SATISFIED | `lance-store.ts` — in-process lancedb.connect(), seed-row table creation. No Docker/daemon required. |
| CACHE-02 | 16-01 | Error signature + discovery context embedded via BGE-M3 | ✓ SATISFIED | `embedder.ts:formatEmbeddingInput` + `generateEmbedding`. `embedder.test.ts` confirms format. |
| CACHE-03 | 16-02 | Before LLM diagnosis, similarity search checks cache (threshold > 0.85) | ✓ SATISFIED | `pipeline.ts:261` — checkCache called before `enforceDPEVSequence('diagnosis')`. Fast-path returns early. |
| CACHE-04 | 16-02, 16-03 | Cached fix returned in <2s (zero LLM calls on cache hit) | ✓ SATISFIED (partial) | Fast-path skips all LLM calls in pipeline. Performance test confirms vector search <500ms for 100 entries. End-to-end <2s requires live embedding server (human verification needed). |
| CACHE-05 | 16-02 | Cache invalidation on skill file updates | ✓ SATISFIED | `invalidation.ts:runStartupInvalidation` — SHA-256 per .md, per-skill purge on hash change. 7 tests confirm selective behaviour. |
| CACHE-06 | 16-01 | Confidence scoring (recency + success rate + similarity) | ✓ SATISFIED (partial) | `confidence.ts` formula correct. `recordFixOutcome` defect means success_count does not accumulate across multiple uses — confidence degrades in accuracy after first recorded outcome. |
| CACHE-07 | 16-02 | Graceful degradation — works without LanceDB | ✓ SATISFIED | All cache operations return null/empty on failure. Pipeline proceeds normally on miss/failure. 7 degradation tests. |
| CACHE-08 | 16-03 | Cache hit explainability — provenance indicator in terminal | ✓ SATISFIED | `formatProvenance()` in `cache-lookup.ts`. Rendered with `chalk.dim` in `commands.ts:215-228`. Visual confirmation needs human test. |

**Requirement ID coverage:** All 8 IDs (CACHE-01 through CACHE-08) claimed across plans 01, 02, 03 and matched against REQUIREMENTS.md. No orphaned requirements.

**REQUIREMENTS.md traceability table:** All 8 CACHE-* requirements marked `[x] Complete` for Phase 16. Status in REQUIREMENTS.md is consistent with implementation — with the caveat that CACHE-06 has a partial defect.

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/cache/cache-lookup.ts` | 193–195 | `updates.success_count = 1` (absolute set, not increment) | ⚠️ Warning | CACHE-06 confidence scoring uses `successRate = successCount / totalUses`. After two successful hits, `success_count` stays at 1 while `hit_count` is 2, producing 50% success rate instead of 100%. Accuracy degrades silently after the first recorded outcome. |
| `tests/cache/cache-lookup.test.ts` | 222 | `expect.any(Number)` for success_count assertion | ⚠️ Warning | Masks the absolute-set bug above. Test passes for any numeric value, hiding the missing increment logic. |

---

### Human Verification Required

#### 1. Visual Provenance Display

**Test:** Trigger two identical error scenarios via the CLI. On the second run, observe terminal output.
**Expected:** A dim line appears before the diagnosis text: `[CACHE HIT] Based on session {8-char id} ({relative date}) -- Cache Hit (similarity: XX%, confidence: XX%)`
**Why human:** `chalk.dim` terminal rendering and the formatted provenance line cannot be verified programmatically.

#### 2. Sub-2s Wall-Clock Latency on Cache Hit Path

**Test:** Submit the same error prompt twice via `infrabrain debug`. Time the second invocation with a live embedding server (Ollama/vLLM serving bge-m3).
**Expected:** Second run completes in under 2 seconds total (embedding generation + vector search + response assembly, no LLM diagnosis calls).
**Why human:** Embedding generation latency is Ollama-dependent. The vector search itself is <500ms (verified by performance test), but the BGE-M3 embedding call dominates and requires a live server.

#### 3. --no-cache Flag on Debug Command

**Test:** Run `infrabrain debug --no-cache "nginx 502"` against a scenario that has a cached fix.
**Expected:** Pipeline proceeds through full LLM diagnosis without logging `[CACHE] Fast-path hit` and without returning `cacheHit` provenance in the result.
**Why human:** Requires a running server instance and a populated cache store.

---

### Gaps Summary

One gap blocks full goal achievement:

**`recordFixOutcome` does not increment — it overwrites.** The function sets `success_count = 1` rather than reading the current entry count and adding 1. The comment in the code explicitly acknowledges this: `// Will be incremented relative in a real scenario; for now set to signal intent`. This means:

1. After a second successful hit on the same cached entry, `success_count` stays at 1 instead of 2.
2. CACHE-06 confidence scoring uses `successRate = successCount / totalUses` — with `hit_count` being the denominator proxy and `success_count` frozen at 1, the success rate produces incorrect results after the first recorded outcome.
3. The test is written with `expect.any(Number)` which accepts `1` without checking for an increment, so the defect is untested.

The fix is to read the current `success_count` or `fail_count` from the store before calling `updateStats`, then pass the incremented value. Alternatively, `updateStats` could be extended to support SQL `SET success_count = success_count + 1` style updates natively in LanceDB.

This does not prevent the cache from returning hits — fast-path classification, skip-LLM, and provenance display all work correctly. The defect affects confidence score accuracy over time (CACHE-06) rather than core functionality.

---

*Verified: 2026-04-10T21:10:00Z*
*Verifier: Claude (gsd-verifier)*
