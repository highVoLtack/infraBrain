---
phase: 16-qdrant-fix-caching
verified: 2026-04-10T22:25:00Z
status: human_needed
score: 10/10 must-haves verified
re_verification: true
  previous_status: gaps_found
  previous_score: 9/10
  gaps_closed:
    - "Confidence scoring accumulates success/failure correctly across repeated cache hits"
  gaps_remaining: []
  regressions: []
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

**Phase Goal:** Semantic fix caching with LanceDB — repeat errors return cached fixes in under 2 seconds with confidence scoring
**Verified:** 2026-04-10T22:25:00Z
**Status:** human_needed
**Re-verification:** Yes — after gap closure (Plan 16-04)

---

## Re-Verification Summary

| Item | Previous | Current |
|------|----------|---------|
| Score | 9/10 | 10/10 |
| Status | gaps_found | human_needed |
| Gap closed | — | `recordFixOutcome` increment fix |
| Regressions | — | None |
| New tests | — | 3 (increment assertions) |
| Total tests | 58 | 61 |

The single gap from the initial verification — `recordFixOutcome` setting `success_count = 1` instead of incrementing — is fully resolved. `lance-store.ts` now exposes `getById`, `cache-lookup.ts` reads current counts before incrementing, and three new tests assert exact count values (`success_count: 1`, `success_count: 2`, `fail_count: 2`). The masking `expect.any(Number)` assertion is gone.

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | LanceDB store initializes in-process with no external service | VERIFIED | `src/cache/lance-store.ts` — `lancedb.connect(dataDir)` in `_doInit()`, singleton per path, seed-row-then-delete table creation. 7 passing tests in `lance-store.test.ts`. |
| 2 | Error context embeds to a 1024-dim BGE-M3 vector | VERIFIED | `src/cache/embedder.ts` — `createOpenAICompatible` + `embed()` with assertion `embedding.length !== 1024`. `formatEmbeddingInput` concatenates `ERROR: {prompt}\n\nCONTEXT:\n{discovery}`. 4 passing tests. |
| 3 | Cache lookup returns fast-path for similarity >= 0.85, speculative for 0.75-0.85, miss below | VERIFIED | `src/cache/cache-lookup.ts` lines 114-133. Three-tier classification implemented and exercised in 12 tests in `cache-lookup.test.ts`. |
| 4 | Pipeline skips LLM diagnosis entirely on fast-path cache hit | VERIFIED | `src/orchestrator/pipeline.ts` lines 276-303. On `cacheResult.type === 'fast-path'` builds DPEVResult from cached data and returns early, bypassing `runDiagnosis()`. |
| 5 | Skill file changes on startup purge only that skill's cache entries | VERIFIED | `src/cache/invalidation.ts` — SHA-256 hash comparison, only purges files where `previousHash && previousHash !== currentHash`. 7 passing tests confirm selective purge. |
| 6 | Successful fix execution stores result in cache | VERIFIED | `src/api/routes/execute.ts` line 203 — `storeFixInCache()` called after execution status `'completed'`, wrapped in try-catch. |
| 7 | Cache hit displays provenance (session ID, date, similarity%, confidence%) | VERIFIED | `src/cache/cache-lookup.ts:35-41` — `formatProvenance()` returns formatted string. `src/cli/commands.ts:215-228` renders it with `chalk.dim`. 5 passing `provenance.test.ts` tests. |
| 8 | CLI 'cache list' and 'cache clear' commands exist and wire to store | VERIFIED | `src/cli/cache-commands.ts` — `registerCacheCommands()` with `list` and `clear` subcommands. Called at `src/cli/commands.ts:680`. Key link confirmed. |
| 9 | All cache operations degrade gracefully when LanceDB/embedding unavailable | VERIFIED | Every operation in `lance-store.ts`, `embedder.ts`, `cache-lookup.ts`, `invalidation.ts` is wrapped in try-catch returning null/empty/false. 7 passing `degradation.test.ts` tests. |
| 10 | Confidence scoring accumulates success/failure correctly across repeated hits | VERIFIED | `src/cache/cache-lookup.ts:188` — `store.getById(entryId)` reads current counts. `updates.success_count = currentSuccess + 1` (line 199). Three new tests confirm: success_count: 1 after first call, success_count: 2 after second call. `expect.any(Number)` removed. |

**Score:** 10/10 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/cache/types.ts` | CacheEntry, CacheHit, CacheResult, CacheConfig, ConfidenceConfig, DEFAULT_* | VERIFIED | All 5 interfaces + 2 default constants exported. 67 lines, substantive. |
| `src/cache/lance-store.ts` | Singleton CacheStore with search/add/delete/list/updateStats/getById | VERIFIED | 227 lines (up from 209). `getById` method added at lines 188-200. All operations gracefully degrade. |
| `src/cache/embedder.ts` | BGE-M3 embedding via Vercel AI SDK, formatEmbeddingInput, isEmbeddingAvailable | VERIFIED | 73 lines. Uses `createOpenAICompatible` + `embed()`. Dimension assertion present. |
| `src/cache/confidence.ts` | computeConfidence with exponential decay | VERIFIED | 36 lines. Formula: `w_sim*similarity + w_rec*exp(-lambda*ageDays) + w_suc*successRate`. |
| `src/cache/cache-lookup.ts` | checkCache, storeFixInCache, recordFixOutcome (increment), formatProvenance | VERIFIED | 209 lines. recordFixOutcome now reads via `store.getById` before incrementing. Gap fully closed. |
| `src/cache/invalidation.ts` | hashSkillFiles, runStartupInvalidation | VERIFIED | 95 lines. SHA-256 per .md file, selective purge on hash mismatch. |
| `src/cli/cache-commands.ts` | registerCacheCommands with list/clear | VERIFIED | 112 lines. Fully implemented with chalk table formatting, formatAge, formatSuccessRate. |
| `src/config/types.ts` | cache: section in InfraBrainConfigSchema | VERIFIED | Lines 67-78 add `cache` zod object with all 5 fields and defaults. |
| `src/orchestrator/pipeline.ts` | Cache check between noise filter and diagnosis | VERIFIED | `checkCache` imported, called before `enforceDPEVSequence('diagnosis')`, fast-path return at line 276, `noCache` flag at line 52. |
| `src/api/routes/execute.ts` | storeFixInCache after successful execution | VERIFIED | Line 203: `storeFixInCache()` with try-catch after `status === 'completed'`. |
| `src/index.ts` | Startup cache init, runStartupInvalidation, isEmbeddingAvailable | VERIFIED | Lines 72-88: `getCacheStore`, `runStartupInvalidation`, `isEmbeddingAvailable` all wired in startup sequence. |
| `tests/cache/` (9 test files) | Full test coverage for all cache subsystems | VERIFIED | 61 tests passing: confidence (5), lance-store (7), embedder (4), cache-lookup (12), invalidation (7), degradation (7), provenance (5), cli-commands (8), integration (6). |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/cache/embedder.ts` | `@ai-sdk/openai-compatible` | `createOpenAICompatible` | WIRED | Line 7 import, line 36 call with `name: 'infrabrain-embed'` |
| `src/cache/lance-store.ts` | `src/cache/types.ts` | `CacheEntry` type | WIRED | Line 9 import, used as schema for table rows |
| `src/cache/cache-lookup.ts` | `src/cache/lance-store.ts` | `store.search()` + `store.getById()` | WIRED | Line 7 import, line 81 call `store.search`, line 188 call `store.getById` |
| `src/cache/cache-lookup.ts` | `src/cache/embedder.ts` | `generateEmbedding` | WIRED | Line 10 import, line 78 call |
| `src/cache/cache-lookup.ts` | `src/cache/confidence.ts` | `computeConfidence` | WIRED | Line 11 import, line 104 call |
| `src/orchestrator/pipeline.ts` | `src/cache/cache-lookup.ts` | `checkCache()` after filterNoise | WIRED | Line 10 import, line 261 call in runDPEV, before `enforceDPEVSequence('diagnosis')` |
| `src/cache/invalidation.ts` | `src/cache/lance-store.ts` | `deleteBySkill` | WIRED | Line 11 import, line 71 call inside runStartupInvalidation |
| `src/cli/cache-commands.ts` | `src/cache/lance-store.ts` | `getCacheStore()` | WIRED | Line 8 import, called in both `list` and `clear` action handlers |
| `src/api/routes/execute.ts` | `src/cache/cache-lookup.ts` | `storeFixInCache` | WIRED | Line 13 import, line 203 call after execution success |
| `src/cli/commands.ts` | `src/cli/cache-commands.ts` | `registerCacheCommands` | WIRED | Line 30 import, line 680 call with `(program, config.config)` |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| CACHE-01 | 16-01 | LanceDB embedded vector store, auto-table management, no external service | SATISFIED | `lance-store.ts` — in-process lancedb.connect(), seed-row table creation. No Docker/daemon required. |
| CACHE-02 | 16-01 | Error signature + discovery context embedded via BGE-M3 | SATISFIED | `embedder.ts:formatEmbeddingInput` + `generateEmbedding`. `embedder.test.ts` confirms format. |
| CACHE-03 | 16-02 | Before LLM diagnosis, similarity search checks cache (threshold > 0.85) | SATISFIED | `pipeline.ts:261` — checkCache called before `enforceDPEVSequence('diagnosis')`. Fast-path returns early. |
| CACHE-04 | 16-02, 16-03 | Cached fix returned in <2s (zero LLM calls on cache hit) | SATISFIED (partial) | Fast-path skips all LLM calls in pipeline. Performance test confirms vector search <500ms for 100 entries. End-to-end <2s requires live embedding server (human verification needed). |
| CACHE-05 | 16-02 | Cache invalidation on skill file updates | SATISFIED | `invalidation.ts:runStartupInvalidation` — SHA-256 per .md, per-skill purge on hash change. 7 tests confirm selective behaviour. |
| CACHE-06 | 16-01, 16-04 | Confidence scoring (recency + success rate + similarity) with correct accumulation | SATISFIED | `confidence.ts` formula correct. `recordFixOutcome` now reads current counts via `store.getById` before incrementing. Two-call increment confirmed by tests: success_count goes 0 → 1 → 2. |
| CACHE-07 | 16-02 | Graceful degradation — works without LanceDB | SATISFIED | All cache operations return null/empty on failure. Pipeline proceeds normally on miss/failure. 7 degradation tests. |
| CACHE-08 | 16-03 | Cache hit explainability — provenance indicator in terminal | SATISFIED | `formatProvenance()` in `cache-lookup.ts`. Rendered with `chalk.dim` in `commands.ts:215-228`. Visual confirmation needs human test. |

**Requirement ID coverage:** All 8 IDs (CACHE-01 through CACHE-08) claimed across plans 01, 02, 03, 04 and matched against REQUIREMENTS.md. All 8 marked `[x] Complete` in REQUIREMENTS.md. No orphaned requirements.

---

### Anti-Patterns Found

None. The two anti-patterns from the initial verification have been resolved:

- `src/cache/cache-lookup.ts` line 193: `updates.success_count = 1` (absolute set) — **Fixed.** Now reads current via `store.getById` and increments.
- `tests/cache/cache-lookup.test.ts` line 222: `expect.any(Number)` — **Removed.** Replaced with exact assertions (`success_count: 1`, `success_count: 2`, `fail_count: 1`, `fail_count: 2`).

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

### Gap Closure Detail

**Gap closed: CACHE-06 confidence accumulation (`recordFixOutcome` increment)**

Previous state: `updates.success_count = 1` — absolute overwrite on every call.

Fixed state in `src/cache/cache-lookup.ts:180-208`:
```typescript
const existing = await store.getById(entryId);
if (!existing) return;
const currentSuccess = Number(existing.success_count ?? 0);
const currentFail = Number(existing.fail_count ?? 0);
// On success: currentSuccess + 1. On failure: currentFail + 1.
```

Supporting change in `src/cache/lance-store.ts:188-200`: `getById(id)` method added — queries table by ID filter, returns `Record<string, unknown> | null`, gracefully degrades on failure.

Test changes in `tests/cache/cache-lookup.test.ts`:
- `makeMockStore` now accepts `getByIdResult` parameter, includes `getById` mock
- Three existing tests updated to assert exact values (`success_count: 1`, `fail_count: 1`)
- Three new tests added: "increments success_count across two calls", "increments fail_count across two calls", "handles missing entry gracefully (getById returns null)"
- Total cache-lookup tests: 12 (was 9)

Test run: 61/61 cache tests pass (was 58). No regressions across any test file.

---

*Verified: 2026-04-10T22:25:00Z*
*Verifier: Claude (gsd-verifier)*
*Re-verification after: Plan 16-04 gap closure*
