---
phase: 15-auto-compact-context
verified: 2026-04-10T16:05:00Z
status: passed
score: 16/16 must-haves verified
re_verification: false
gaps: []
human_verification:
  - test: "Real Qwen3 tokenizer latency on cold start"
    expected: "First call to countTokens() completes within ~500ms on target hardware"
    why_human: "Singleton init time depends on vocabulary file loading — cannot measure without real runtime"
  - test: "DEV_MODE logging visible in live DPEV run"
    expected: "[NOISE] and [CONTEXT] log lines appear during a real diagnosis session"
    why_human: "DEV_MODE is a runtime environment flag — cannot assert console output in unit tests"
  - test: "Pre-compaction snapshot written to correct path on disk"
    expected: "sessionDir/snapshots/{sessionId}-{timestamp}.json exists after compaction fires"
    why_human: "Snapshot writes are mocked in all tests — real file system write needs manual verification"
---

# Phase 15: Auto-Compact Context Verification Report

**Phase Goal:** Automatic context window management — token counting, noise filtering, tiered compaction, ground truth pinning
**Verified:** 2026-04-10T16:05:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| #  | Truth | Status | Evidence |
|----|-------|--------|----------|
| 1  | Token counting returns accurate Qwen3 BPE token counts (not heuristic) | VERIFIED | `src/context/token-counter.ts` uses `fromPreTrained()` singleton from `@lenml/tokenizer-qwen3@^3.7.2`; `countTokens()` calls `.encode(text).length`; 7 unit tests pass |
| 2  | Healthcheck spam and systemd journal noise removed from discovery output | VERIFIED | `src/context/noise-filter.ts` exports `NOISE_PATTERNS` with 10 hardcoded patterns covering Docker healthcheck, systemd, journal metadata, whitespace; 13 noise filter tests pass |
| 3  | Skill-declared noise patterns applied alongside hardcoded patterns | VERIFIED | `filterNoise()` compiles `skillPatterns: string[]` to `RegExp[]` at call time; merged with `NOISE_PATTERNS`; `SkillFrontmatterSchema.noise_patterns` field present in `src/skills/types.ts:43`; pipeline reads `selection.skill.frontmatter.noise_patterns` |
| 4  | Worker model invoked only when discovery key has 10+ unrecognized lines | VERIFIED | `WORKER_MODEL_THRESHOLD = 10` in `noise-filter.ts:29`; `unrecognized.length >= WORKER_MODEL_THRESHOLD` guard at line 73; 2 dedicated threshold tests pass (9 lines = no call, 10 lines = call) |
| 5  | Ground truth auto-detects container names, ports, IPs, and error codes | VERIFIED | `src/context/ground-truth.ts` uses `extractContainerNames()`, `PORT_RE`, `IP_RE`, `ERROR_CODE_RE`; deduplicates by value; 17 ground truth tests pass |
| 6  | Explicit [PIN]...[/PIN] markers create pinned facts | VERIFIED | `parseExplicitPins()` with `PIN_RE = /\[PIN\](.*?)\[\/PIN\]/gs` in `ground-truth.ts:18`; `ContextManager.ingestDiscovery()` calls `parseExplicitPins(JSON.stringify(filteredRaw))` |
| 7  | Ground truth section never exceeds 20% of context window (FIFO eviction) | VERIFIED | `GroundTruthManager.enforceCapacity()` in `ground-truth.ts:197`; eviction priority: ip=0, port=1, container=2, custom=3, error_code=4 (diagnosis-relevant survives longest); 20% cap test in ground-truth tests |
| 8  | Compaction fires exactly once at 83% threshold (no recursive loop) | VERIFIED | `compactionFired` boolean flag in `context-manager.ts:25`; `if (this.compactionFired) return null` at line 90; `if (usage.percentage < this.config.threshold) return null` at line 93; integration test "once-per-threshold" passes |
| 9  | Compaction targets 60% of context window | VERIFIED | `target: 0.60` passed to `ContextManager` in `pipeline.ts:174`; `tieredEviction()` receives `targetRatio: this.config.target`; `isUnderBudget()` checks `<= windowSize * targetRatio` |
| 10 | Tiered eviction: noise discard -> old observation compression -> worker model summarization | VERIFIED | `src/context/compactor.ts`: Tier 1 filters `isNoise===true`; Tier 2 compresses oldest to 2 lines with `...(compressed)` marker; Tier 3 calls worker model with `generateObject` or falls back to aggressive 1-line compression; 7 compactor tests pass |
| 11 | Pre-compaction snapshot saved to disk before evicting | VERIFIED | `saveSnapshot()` called in `context-manager.ts:99` before `tieredEviction()` at line 109; `snapshot.ts` writes `sessionDir/snapshots/{sessionId}-{Date.now()}.json` synchronously via `writeFileSync` |
| 12 | Stale/redundant observations masked before summarization | VERIFIED | Tier 2 compression truncates oldest observations before Tier 3 summarization; `compressor.ts` uses timestamp-sorted (ascending) order for compression — oldest compressed first |
| 13 | Discovery output is noise-filtered before reaching the LLM | VERIFIED | `pipeline.ts:162` calls `filterNoise(discoveryRaw, skillNoisePatterns, workerModel)` before `contextManager.ingestDiscovery(filteredRaw)` at line 180 |
| 14 | Context window usage tracked and logged during a diagnosis session | VERIFIED | `contextManager.getUsage()` returns `{ tokens, percentage, groundTruthTokens }`; DEV_MODE log at `pipeline.ts:184`; `countTokens()` called per observation in `ingestDiscovery()` |
| 15 | Critical data (container names, ports, error codes) survives compaction intact | VERIFIED | Ground truth pinned before eviction; `buildContext()` outputs `groundTruthManager.buildSection()` first; integration test "ground truth survives compaction" passes with nginx-frontend, api-backend, OOM, ECONNREFUSED verified present post-compaction |
| 16 | Existing pipeline behavior unchanged when context stays below threshold | VERIFIED | `maybeCompact()` returns `null` if `percentage < threshold`; integration test "does not fire compaction when context is below 83%" passes; all 701 existing unit tests pass (5 e2e failures are pre-existing Docker-dependency failures) |

**Score:** 16/16 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/context/types.ts` | Shared types: Observation, PinnedFact, ContextSection, ContextManagerConfig, CompactionResult, EvictionResult | VERIFIED | All 6 interfaces present; plain TypeScript (not zod) as intended |
| `src/context/token-counter.ts` | Qwen3 tokenizer singleton with countTokens, getTokenizer | VERIFIED | `fromPreTrained` singleton; lazy-init on first call; exports both functions |
| `src/context/noise-filter.ts` | Regex pre-processor with NOISE_PATTERNS, filterNoise, worker model fallback | VERIFIED | 10 patterns in `NOISE_PATTERNS`; async `filterNoise` with 3 params; `generateObject` fallback at 10+ lines |
| `src/context/ground-truth.ts` | extractGroundTruth, parseExplicitPins, GroundTruthManager | VERIFIED | All 3 exports present; EVICTION_PRIORITY map with 5 types; `buildSection()` groups by type |
| `src/context/compactor.ts` | tieredEviction with 3-tier logic | VERIFIED | 3 tiers with early-exit checks; aggressive fallback if no worker model |
| `src/context/snapshot.ts` | saveSnapshot writes JSON to sessionDir/snapshots/ | VERIFIED | `mkdirSync` + `writeFileSync`; returns absolute path |
| `src/context/context-manager.ts` | ContextManager class with all methods | VERIFIED | `ingestDiscovery`, `getUsage`, `maybeCompact`, `buildContext`, `reset`; `compactionFired` once-only guard |
| `src/orchestrator/pipeline.ts` | ContextManager + filterNoise integration | VERIFIED | Imported at lines 20-21; wired at lines 162-207; `contextManager.buildContext()` replaces ad-hoc GROUND TRUTH block |
| `src/config/types.ts` | contextWindow field (default 32768) | VERIFIED | `contextWindow: z.number().default(32768)` at line 66 |
| `src/llm/token-budget.ts` | Re-exports countTokens; checkBudget uses accurate counter | VERIFIED | Import at line 2; re-export at line 5; `checkBudget` uses `countTokensAccurate` at line 48 |
| `src/skills/types.ts` | noise_patterns field in SkillFrontmatterSchema | VERIFIED | `noise_patterns: z.array(z.string()).default([])` at line 43 |
| `tests/context/token-counter.test.ts` | 7 token counter unit tests | VERIFIED | 7 tests pass: accuracy, empty string, heuristic difference, singleton |
| `tests/context/noise-filter.test.ts` | 13 noise filter unit tests | VERIFIED | 13 tests pass: all pattern categories, skill patterns, threshold, return shape |
| `tests/context/ground-truth.test.ts` | 17 ground truth unit tests | VERIFIED | 17 tests pass: all extraction types, dedup, cap enforcement, priority eviction |
| `tests/context/compactor.test.ts` | 7 compactor unit tests | VERIFIED | 7 tests pass: each tier, early-exit, worker model fallback |
| `tests/context/context-manager.test.ts` | 11 context manager unit tests | VERIFIED | 11 tests pass: ingest, usage, compaction, once-only guard, snapshot, buildContext, reset |
| `tests/context/integration.test.ts` | 7 end-to-end integration tests | VERIFIED | 7 tests pass: compaction at threshold, ground truth survival, noise removal, skill patterns, once-per-threshold, token tracking |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/context/token-counter.ts` | `@lenml/tokenizer-qwen3` | `fromPreTrained()` singleton | WIRED | Import at line 6; singleton at line 10; `getTokenizer()` lazy-inits |
| `src/context/noise-filter.ts` | `src/skills/types.ts` | `noise_patterns` field in SkillFrontmatterSchema | WIRED | `noise_patterns: z.array(z.string()).default([])` at `types.ts:43`; consumed as `skillPatterns` param |
| `src/context/context-manager.ts` | `src/context/token-counter.ts` | `countTokens` in `ingestDiscovery` and `recalculateTokens` | WIRED | Import at line 14; used in `ingestDiscovery()` per observation |
| `src/context/context-manager.ts` | `src/context/compactor.ts` | `tieredEviction` in `maybeCompact()` | WIRED | Import at line 16; called at `context-manager.ts:109` |
| `src/context/context-manager.ts` | `src/context/ground-truth.ts` | `extractGroundTruth` in `ingestDiscovery()` | WIRED | Import at line 15; called at `context-manager.ts:44` |
| `src/context/compactor.ts` | `src/context/snapshot.ts` | `saveSnapshot` before eviction | WIRED | Called in `context-manager.ts:99` before `tieredEviction()` at line 109 |
| `src/orchestrator/pipeline.ts` | `src/context/context-manager.ts` | `contextManager.ingestDiscovery` after noise filter | WIRED | Import at line 20; `ingestDiscovery(filteredRaw)` at `pipeline.ts:180` |
| `src/orchestrator/pipeline.ts` | `src/context/noise-filter.ts` | `filterNoise` on discovery output | WIRED | Import at line 21; called at `pipeline.ts:162` before context ingestion |
| `src/orchestrator/pipeline.ts` | `src/context/context-manager.ts` | `buildContext` replaces ad-hoc GROUND TRUTH string | WIRED | `contextManager.buildContext()` at `pipeline.ts:204`; result used in `enrichedPrompt` |
| `src/config/types.ts` | `src/context/context-manager.ts` | `contextWindow` feeds `ContextManagerConfig.windowSize` | WIRED | `input.config?.contextWindow ?? 32768` at `pipeline.ts:171`; passed as `windowSize` |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| CTXT-01 | 15-01, 15-03 | Token counting via `@lenml/tokenizer-qwen3` tracks context window usage in real-time | SATISFIED | `token-counter.ts` with `fromPreTrained`; `ContextManager.getUsage()` returns real-time percentage; REQUIREMENTS.md marked complete |
| CTXT-02 | 15-02, 15-03 | Auto-compact triggers at 83% context window threshold | SATISFIED | `threshold: 0.83` in pipeline; `compactionFired` guard; integration test confirms trigger at 83% |
| CTXT-03 | 15-02, 15-03 | Ground truth pinning protects critical data from compaction (container names, ports, error codes, discovery facts) | SATISFIED | `GroundTruthManager` with type-priority eviction; ground truth section preserved in `buildContext()` output even after compaction |
| CTXT-04 | 15-02, 15-03 | Observation masking removes stale/redundant observations before LLM summarization | SATISFIED | Tier 2 compresses oldest first; Tier 3 summarizes with worker model; `isNoise` flag for Tier 1 discard |
| CTXT-05 | 15-01, 15-03 | Regex pre-processor filters known noise patterns (healthcheck spam, systemd journal noise) | SATISFIED | `NOISE_PATTERNS` with 10 patterns; runs in `filterNoise()` before context ingestion |
| CTXT-06 | 15-01, 15-03 | 9B worker model pre-filters unknown log formats for relevance scoring | SATISFIED | `generateObject` call in `filterNoise()` at 10+ unrecognized lines; `workerModel` passed from pipeline registry |

All 6 requirements satisfied. No orphaned requirements found.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None | — | No TODO/FIXME/placeholder comments found | — | — |
| None | — | No empty implementations (return null / return {}) found in production code | — | — |
| None | — | No stub handlers or unimplemented methods | — | — |

Anti-pattern scan: clean. All implementations are substantive.

### Human Verification Required

#### 1. Real Qwen3 Tokenizer Cold-Start Latency

**Test:** Start a fresh DPEV diagnosis run (no warm JIT), observe time from process start to first `countTokens()` result
**Expected:** Initialization completes within ~500ms; subsequent calls are instant
**Why human:** Cold-start vocabulary file loading depends on disk speed and process state — cannot reliably measure in unit tests

#### 2. DEV_MODE Context Logging in Live Run

**Test:** Set `DEV_MODE=true`, run a real diagnosis with discovery output containing healthcheck spam
**Expected:** `[NOISE] Filtered N noise lines` and `[CONTEXT] X.X% used (N tokens)` visible in console output
**Why human:** DEV_MODE is a runtime environment variable; unit tests do not assert `console.log` output from the pipeline

#### 3. Pre-Compaction Snapshot on Real File System

**Test:** Run a diagnosis that pushes past the 83% threshold with a small `contextWindow` config value
**Expected:** A JSON file appears at `{sessionDir}/snapshots/{sessionId}-{timestamp}.json` with ground truth and observations
**Why human:** Snapshot writes are mocked (`writeFileSync = vi.fn()`) in all tests — real file system write path is untested

### Summary

Phase 15 achieves its stated goal in full. All 7 source files and 6 test files are present, substantive, and correctly wired. The complete context management pipeline is operational:

- `filterNoise()` removes healthcheck spam, systemd boilerplate, and journal metadata before any LLM context injection
- `ContextManager` tracks real-time Qwen3 BPE token counts and fires tiered compaction exactly once at 83%
- Ground truth (containers, ports, IPs, error codes, and `[PIN]` markers) is pinned separately with a 20% budget cap and type-priority eviction
- Tiered eviction (noise discard -> oldest compression -> worker model summarization) consistently targets 60%
- Pre-compaction JSON snapshots provide an audit trail before any data is discarded
- Pipeline integration replaces the ad-hoc GROUND TRUTH string with `ContextManager.buildContext()`
- 62 context module tests pass; 701 total unit tests pass; 5 pre-existing e2e failures are unrelated Docker infrastructure unavailability

All 6 CTXT requirements are satisfied and marked complete in REQUIREMENTS.md.

---

_Verified: 2026-04-10T16:05:00Z_
_Verifier: Claude (gsd-verifier)_
