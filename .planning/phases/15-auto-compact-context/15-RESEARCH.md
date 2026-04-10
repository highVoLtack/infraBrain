# Phase 15: Auto-Compact Context Management - Research

**Researched:** 2026-04-10
**Domain:** LLM context window management, token counting, tiered eviction, noise filtering
**Confidence:** HIGH

## Summary

Phase 15 implements real-time token counting and automatic context compaction for InfraBrain's DPEV pipeline. The existing codebase already has a heuristic token estimator (`estimateTokens()` in `token-budget.ts`), a `RollingContext` class that compresses execution step history, and a `preFilterIfLogHeavy()` function in diagnosis.ts. This phase replaces the heuristic with accurate Qwen3 tokenization, adds a three-tier eviction system (noise discard -> observation compression -> summarization), and introduces a Ground Truth pinning mechanism that protects critical infrastructure data from compaction.

The primary integration point is `pipeline.ts` (`runDPEV()`), where context hooks insert between discovery output and LLM prompt assembly. The existing `ModelRole` type already includes a `worker` role (defaulting to `qwen2.5-coder:7b`), which provides the model-agnostic naming required by CONTEXT.md decisions. The `@lenml/tokenizer-qwen3` package provides offline, dependency-free token counting that fits the air-gapped requirement.

**Primary recommendation:** Build a `ContextManager` class that wraps the DPEV pipeline's context assembly, tracks token counts in real-time via `@lenml/tokenizer-qwen3`, maintains a pinned Ground Truth section, and fires tiered compaction exactly once when the 83% threshold is crossed.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Tiered eviction: first discard noise, then compress old observations, then summarize -- multiple passes until under budget
- Summarization handled by the same worker model used for relevance scoring (model-agnostic naming, NOT "9B" -- use `workerModel` or `relevanceScorer` so it's easy to swap for more capable models later)
- Target: compact down to 60% of context window (gives ~23% headroom before re-trigger)
- Save a snapshot of pre-compaction context to disk before evicting -- user can inspect later but it never re-enters the LLM window
- Compaction fires exactly once per threshold crossing (no recursive loop) -- success criterion #5
- Regex pre-processor runs before discovery results enter context (at the point where `runParallelDiscovery` returns, before LLM prompt assembly)
- Core noise patterns hardcoded (healthcheck spam, systemd boilerplate) + skills can declare additional noise patterns in their YAML
- Worker model is a fallback for unknown formats only -- if a discovery result has 10+ unrecognized lines, batch them and send for relevance scoring. Below 10 lines, include them all (latency overhead not worth it)
- CRITICAL: All naming must be model-agnostic -- call it `workerModel` or `relevanceScorer`, never "9B"
- Hybrid ground truth approach: auto-detect common types (container names, port numbers, error codes, IPs via existing extractors like `extractContainerNames`) + allow explicit `[PIN]...[/PIN]` markers for edge cases
- Pinned data collected into a dedicated `## Ground Truth` section at top of context -- always included, never compacted
- Hard cap at 20% of context window for ground truth. If exceeded, oldest pinned facts evicted with a warning log
- Session-only: ground truth lives in memory for the current diagnosis session. Fresh session = fresh discovery

### Claude's Discretion
- Observability: how token usage is surfaced (dev-mode logging, status output format)
- Exact regex patterns for known noise
- Snapshot file format and location
- Compaction ordering within each eviction tier

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| CTXT-01 | Token counting via `@lenml/tokenizer-qwen3` tracks context window usage in real-time | `@lenml/tokenizer-qwen3` v3.4.2 provides `fromPreTrained()` -> `encode()` for accurate Qwen3 token counting; replaces `estimateTokens()` heuristic |
| CTXT-02 | Auto-compact triggers at 83% context window threshold | ContextManager class monitors token count after each context mutation; fires tiered eviction targeting 60% once per threshold crossing |
| CTXT-03 | Ground truth pinning protects critical data from compaction | Hybrid auto-detect (reuse `extractContainerNames()`, add port/IP/error-code extractors) + `[PIN]...[/PIN]` markers; 20% cap with FIFO eviction |
| CTXT-04 | Observation masking removes stale/redundant observations before LLM summarization | Tier 2 of eviction: oldest observations compressed first, duplicate findings merged |
| CTXT-05 | Regex pre-processor filters known noise patterns before context injection | Noise filter runs on `runParallelDiscovery()` output; hardcoded patterns + skill-declared `noise_patterns` in YAML frontmatter |
| CTXT-06 | Worker model pre-filters unknown log formats for relevance scoring | Uses existing `worker` ModelRole; only invoked when discovery result has 10+ unrecognized lines; batched call for relevance scoring |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@lenml/tokenizer-qwen3` | 3.4.2 | Accurate Qwen3 token counting | Offline, zero-dependency, uses actual Qwen3 tokenizer vocabulary; replaces heuristic |
| `vitest` | 4.x (existing) | Test framework | Already in project devDependencies |
| `ai` SDK | 6.x (existing) | LLM calls for worker model summarization | Already used throughout project |
| `zod` | 4.x (existing) | Schema validation for context types | Already used throughout project |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `p-queue` | 9.x (existing) | Rate-limit worker model calls | If multiple relevance-scoring batches need throttling |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `@lenml/tokenizer-qwen3` | `tiktoken` (OpenAI) | Wrong vocabulary for Qwen3 models; would give inaccurate counts |
| `@lenml/tokenizer-qwen3` | Keep `estimateTokens()` heuristic | 4-char/token heuristic can be 20-40% off for mixed content; unacceptable for 83% threshold precision |

**Installation:**
```bash
npm install @lenml/tokenizer-qwen3
```

## Architecture Patterns

### Recommended Project Structure
```
src/
  context/                    # NEW module for context management
    context-manager.ts        # ContextManager class (core orchestrator)
    token-counter.ts          # Qwen3 tokenizer wrapper (replaces heuristic)
    ground-truth.ts           # Ground truth pinning + extraction
    noise-filter.ts           # Regex pre-processor for known noise
    compactor.ts              # Tiered eviction logic
    snapshot.ts               # Pre-compaction snapshot writer
    types.ts                  # Shared types (ContextSection, PinnedFact, etc.)
  llm/
    token-budget.ts           # UPDATED: import real counter, keep heuristic as fallback
  orchestrator/
    pipeline.ts               # UPDATED: integrate ContextManager between discovery and diagnosis
```

### Pattern 1: ContextManager as Pipeline Middleware
**What:** A stateful class that sits between discovery output and LLM prompt assembly, tracking token usage and triggering compaction.
**When to use:** Every DPEV pipeline run.
**Example:**
```typescript
// Source: derived from existing RollingContext pattern in context-builder.ts
export class ContextManager {
  private groundTruth: PinnedFact[] = [];
  private observations: Observation[] = [];
  private totalTokens = 0;
  private compactionFired = false;  // once-per-threshold flag
  private readonly windowSize: number;  // e.g., 32768
  private readonly threshold: number;   // 0.83
  private readonly target: number;      // 0.60

  constructor(config: ContextManagerConfig) { ... }

  /** Add discovery output, auto-extracting ground truth and filtering noise */
  ingestDiscovery(raw: Record<string, string>): void { ... }

  /** Check if compaction needed, fire exactly once */
  maybeCompact(): CompactionResult | null { ... }

  /** Build final context string for LLM prompt */
  buildContext(): string { ... }

  /** Get current usage stats for observability */
  getUsage(): { tokens: number; percentage: number; groundTruthTokens: number } { ... }
}
```

### Pattern 2: Token Counter Singleton
**What:** Lazy-initialized tokenizer instance, since `fromPreTrained()` loads vocabulary data.
**When to use:** All token counting operations project-wide.
**Example:**
```typescript
// Source: @lenml/tokenizer-qwen3 README (https://github.com/lenML/tokenizers)
import { fromPreTrained } from '@lenml/tokenizer-qwen3';

let _tokenizer: ReturnType<typeof fromPreTrained> | null = null;

function getTokenizer() {
  if (!_tokenizer) {
    _tokenizer = fromPreTrained();
  }
  return _tokenizer;
}

export function countTokens(text: string): number {
  return getTokenizer().encode(text).length;
}
```

### Pattern 3: Tiered Eviction with Once-Per-Threshold Guard
**What:** Three-tier compaction that runs in order until under budget, with a boolean guard preventing recursive loops.
**When to use:** When `totalTokens / windowSize >= 0.83`.
**Example:**
```typescript
// Tier 1: Discard noise (already partially done by noise filter, this catches stragglers)
// Tier 2: Compress old observations (keep findings, discard raw output)
// Tier 3: Summarize via worker model (batch remaining observations into summary)

export function tieredEviction(
  observations: Observation[],
  groundTruthTokens: number,
  windowSize: number,
  targetRatio: number,  // 0.60
  workerModel: LanguageModel,
): Promise<EvictionResult> {
  const targetTokens = windowSize * targetRatio - groundTruthTokens;
  // Tier 1...
  // Tier 2...
  // Tier 3 (only if still over budget)...
}
```

### Pattern 4: Ground Truth Section at Top of Context
**What:** A dedicated, never-compacted section at the top of the LLM context containing hard facts.
**When to use:** Every LLM prompt assembly in the DPEV pipeline.
**Example:**
```typescript
// The Ground Truth section replaces the current ad-hoc GROUND TRUTH injection in pipeline.ts
// Current code (line 170 of pipeline.ts):
//   `--- GROUND TRUTH - USE ONLY THESE NAMES ---\n${discoveryContext}\n--- END GROUND TRUTH ---`
// New approach: ContextManager.buildContext() outputs:
//   ## Ground Truth
//   Containers: postgres-main, redis-cache, nginx-proxy
//   Ports: 5432, 6379, 80
//   Error codes: OOM, ECONNREFUSED
//   [PIN]Custom pinned fact here[/PIN]
//   ---
//   ## Observations
//   ...remaining context...
```

### Anti-Patterns to Avoid
- **Recursive compaction:** Never trigger compaction from within compaction. The `compactionFired` boolean guard prevents this -- once set, `maybeCompact()` returns null until the context drops back below threshold naturally (new session or manual reset).
- **Token counting on every character:** Do not re-tokenize the entire context on every small mutation. Track token deltas: `addTokens(countTokens(newContent))` and `subtractTokens(countTokens(removedContent))`.
- **Summarizing ground truth:** The Ground Truth section is sacred. Eviction only operates on observations below it.
- **Calling worker model for small batches:** The 10-line threshold is explicit -- below 10 unrecognized lines, include them all. Worker model latency is not worth it for small amounts.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Token counting | Character-based heuristic | `@lenml/tokenizer-qwen3` `encode().length` | Heuristic is 20-40% off for mixed content; critical for precise 83% threshold |
| Container name extraction | New regex parser | Existing `extractContainerNames()` in diagnosis.ts | Already handles both `docker ps` formats |
| TOON encoding for token savings | Custom compact encoding | Existing `encodeToon()` / `encodeForLLM()` | Already proven in project, saves 30-50% tokens on structured data |
| Worker model invocation | Raw HTTP calls | Existing `provider.registry.get('worker')` + `ai` SDK | Model routing already handles base URL resolution |

**Key insight:** The existing codebase has most building blocks -- the phase is about connecting them into a coherent context management pipeline, not building from scratch.

## Common Pitfalls

### Pitfall 1: Tokenizer Initialization Cost
**What goes wrong:** `fromPreTrained()` loads vocabulary data synchronously on first call, causing a startup delay of ~100-500ms.
**Why it happens:** The tokenizer loads a large vocabulary file from the bundled package.
**How to avoid:** Initialize the tokenizer lazily as a singleton (Pattern 2 above). First call pays the cost, subsequent calls are instant. Alternatively, initialize at application startup.
**Warning signs:** Slow first token count, or repeated initialization in hot paths.

### Pitfall 2: Token Count Drift
**What goes wrong:** Tracked token count diverges from actual context size due to accumulated rounding errors or missed additions/removals.
**Why it happens:** Delta-based tracking (`addTokens`/`subtractTokens`) compounds small errors over many mutations.
**How to avoid:** Periodically recount the full context (e.g., before compaction). The compaction threshold check is the natural place to do a full recount.
**Warning signs:** Compaction not firing when context visually looks full, or firing too early.

### Pitfall 3: Compaction Producing Invalid Context
**What goes wrong:** After compaction, the LLM context is syntactically broken (unclosed markers, truncated commands, missing section headers).
**Why it happens:** Naive truncation or removal of observations without respecting structural boundaries.
**How to avoid:** Operate on whole observations as units. Never split an observation mid-text. After compaction, rebuild the context string from the remaining structured data.
**Warning signs:** LLM producing confused or off-topic responses after compaction fires.

### Pitfall 4: Worker Model Latency in Hot Path
**What goes wrong:** Calling the worker model for relevance scoring adds 1-5s to every discovery cycle, even when unnecessary.
**Why it happens:** Over-eager relevance scoring on small or recognizable content.
**How to avoid:** The 10-line threshold from CONTEXT.md is the explicit guard. Only invoke the worker model when discovery results contain 10+ unrecognized lines. Regex noise filter handles the common cases.
**Warning signs:** Diagnosis latency increasing significantly after Phase 15 integration.

### Pitfall 5: Ground Truth Exceeding 20% Cap
**What goes wrong:** A complex multi-container environment produces so many pinned facts that ground truth consumes most of the context window.
**Why it happens:** Auto-detection pins every container name, port, IP, and error code from a large discovery output.
**How to avoid:** Enforce the 20% hard cap with FIFO eviction of oldest pinned facts + warning log. Prioritize: error codes > container names > ports > IPs (error codes are most diagnosis-relevant).
**Warning signs:** Warning logs about ground truth eviction appearing frequently.

## Code Examples

Verified patterns from existing codebase:

### Existing Token Estimation (to be replaced)
```typescript
// Source: src/llm/token-budget.ts
export function estimateTokens(text: string): number {
  // 4-chars-per-token ASCII, 2-chars-per-token non-ASCII
  // CTXT-01 replaces this with @lenml/tokenizer-qwen3
}
```

### Existing Container Name Extraction (reusable for auto-pinning)
```typescript
// Source: src/orchestrator/diagnosis.ts:254
export function extractContainerNames(discoveryRaw: Record<string, string>): string[] {
  const raw = discoveryRaw['Running containers']
    ?? discoveryRaw['All containers with status']
    ?? '';
  return raw.split('\n').map(line => line.trim().split(/\s+/)[0]).filter(Boolean);
}
```

### Existing RollingContext Pattern (extend for pipeline-level)
```typescript
// Source: src/execution/context-builder.ts
// Pattern: keep last N entries full, compress the rest
// This approach extends to pipeline-level: keep recent observations full, compress/summarize older ones
```

### Noise Filter Regex Patterns (Claude's Discretion -- recommended)
```typescript
// Hardcoded core patterns for CTXT-05
const NOISE_PATTERNS: RegExp[] = [
  // Docker healthcheck spam
  /health_status:\s*(healthy|unhealthy)/i,
  /healthcheck.*passed|healthcheck.*failed/i,
  // systemd boilerplate
  /Started\s+.*\.service/,
  /Stopped\s+.*\.service/,
  /systemd\[\d+\]:\s+Starting\s+/,
  /systemd\[\d+\]:\s+Reached target\s+/,
  // Journal metadata noise
  /-- Logs begin at/,
  /-- No entries --/,
  /-- Journal has been rotated/,
  // Empty/whitespace lines in command output
  /^\s*$/,
];
```

### Pipeline Integration Point
```typescript
// Source: src/orchestrator/pipeline.ts:135
// CURRENT: Discovery -> direct to prompt assembly
const { context: discoveryContext, raw: discoveryRaw } = await runParallelDiscovery(discoveryCommands);

// NEW: Discovery -> noise filter -> context manager -> prompt assembly
const { context: discoveryContext, raw: discoveryRaw } = await runParallelDiscovery(discoveryCommands);
const filteredRaw = noiseFilter(discoveryRaw, skill.frontmatter.noise_patterns ?? []);
contextManager.ingestDiscovery(filteredRaw);
if (contextManager.getUsage().percentage >= 0.83) {
  await contextManager.maybeCompact(provider.registry.get('worker'));
}
const enrichedPrompt = contextManager.buildContext() + '\n\n' + prompt;
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| 4-char/token heuristic | `@lenml/tokenizer-qwen3` actual BPE tokenization | Phase 15 | Accurate threshold detection, no more false positives/negatives on 80% warning |
| Ad-hoc GROUND TRUTH string injection | Structured Ground Truth section with pinning | Phase 15 | Survives compaction, hard facts never lost |
| `preFilterIfLogHeavy()` only | Regex noise filter + worker model relevance scoring | Phase 15 | Catches healthcheck spam and systemd noise before LLM ever sees it |

**Deprecated/outdated after this phase:**
- `estimateTokens()` heuristic: kept as fallback but no longer primary counter
- Ad-hoc `--- GROUND TRUTH ---` string block in pipeline.ts: replaced by ContextManager

## Open Questions

1. **Skill YAML `noise_patterns` field schema**
   - What we know: Skills currently have `triggers`, `tools`, `discovery`, `rewrite_rules` in frontmatter
   - What's unclear: Exact YAML schema for `noise_patterns` (array of strings? regex strings?)
   - Recommendation: Add `noise_patterns: z.array(z.string()).default([])` to `SkillFrontmatterSchema` in `src/skills/types.ts`. Each string is compiled to a RegExp at load time.

2. **Snapshot file format and location**
   - What we know: CONTEXT.md says save pre-compaction snapshot to disk for post-mortem
   - What's unclear: JSON? Markdown? Where to store?
   - Recommendation: JSON file in `${config.sessionDir}/snapshots/${sessionId}-${timestamp}.json` containing `{ groundTruth, observations, tokenCount, compactionReason }`. JSON for easy programmatic access. Dev-mode logging prints file path.

3. **Context window size configuration**
   - What we know: Current `tokenBudgets` config has `diagnosis: 4096` and `command: 2048` -- these are per-task budgets, not the model's full context window
   - What's unclear: Where to configure the actual model context window (e.g., 32768 for Qwen3)
   - Recommendation: Add `contextWindow: z.number().default(32768)` to `InfraBrainConfigSchema`. The 83% threshold and 60% target are percentages of this value.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.x |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run tests/context/` |
| Full suite command | `npx vitest run` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CTXT-01 | Accurate Qwen3 token counting replaces heuristic | unit | `npx vitest run tests/context/token-counter.test.ts -t "countTokens"` | Wave 0 |
| CTXT-01 | Real-time token tracking during context mutations | unit | `npx vitest run tests/context/context-manager.test.ts -t "tracks tokens"` | Wave 0 |
| CTXT-02 | Auto-compact fires at 83% threshold | unit | `npx vitest run tests/context/context-manager.test.ts -t "compaction threshold"` | Wave 0 |
| CTXT-02 | Compacts down to 60% target | unit | `npx vitest run tests/context/compactor.test.ts -t "target 60"` | Wave 0 |
| CTXT-02 | Compaction fires exactly once per crossing (no recursive loop) | unit | `npx vitest run tests/context/context-manager.test.ts -t "fires once"` | Wave 0 |
| CTXT-03 | Ground truth pinning auto-detects container names, ports, IPs, error codes | unit | `npx vitest run tests/context/ground-truth.test.ts -t "auto-detect"` | Wave 0 |
| CTXT-03 | `[PIN]...[/PIN]` markers create explicit pins | unit | `npx vitest run tests/context/ground-truth.test.ts -t "PIN markers"` | Wave 0 |
| CTXT-03 | Ground truth 20% cap with FIFO eviction | unit | `npx vitest run tests/context/ground-truth.test.ts -t "20% cap"` | Wave 0 |
| CTXT-04 | Stale observations masked before summarization | unit | `npx vitest run tests/context/compactor.test.ts -t "stale masking"` | Wave 0 |
| CTXT-05 | Regex pre-processor filters healthcheck spam | unit | `npx vitest run tests/context/noise-filter.test.ts -t "healthcheck"` | Wave 0 |
| CTXT-05 | Regex pre-processor filters systemd noise | unit | `npx vitest run tests/context/noise-filter.test.ts -t "systemd"` | Wave 0 |
| CTXT-05 | Skill-declared noise patterns applied | unit | `npx vitest run tests/context/noise-filter.test.ts -t "skill patterns"` | Wave 0 |
| CTXT-06 | Worker model invoked for 10+ unrecognized lines | unit | `npx vitest run tests/context/noise-filter.test.ts -t "worker model"` | Wave 0 |
| CTXT-06 | Lines below 10 threshold included without worker call | unit | `npx vitest run tests/context/noise-filter.test.ts -t "below threshold"` | Wave 0 |
| E2E | Full pipeline with compaction | integration | `npx vitest run tests/context/integration.test.ts` | Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run tests/context/`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/context/token-counter.test.ts` -- covers CTXT-01
- [ ] `tests/context/context-manager.test.ts` -- covers CTXT-01, CTXT-02
- [ ] `tests/context/ground-truth.test.ts` -- covers CTXT-03
- [ ] `tests/context/compactor.test.ts` -- covers CTXT-02, CTXT-04
- [ ] `tests/context/noise-filter.test.ts` -- covers CTXT-05, CTXT-06
- [ ] `tests/context/integration.test.ts` -- covers E2E pipeline with compaction
- [ ] Framework install: `npm install @lenml/tokenizer-qwen3` -- new dependency

## Sources

### Primary (HIGH confidence)
- `src/llm/token-budget.ts` -- existing heuristic token estimation (lines 14-32)
- `src/execution/context-builder.ts` -- RollingContext compression pattern (lines 15-113)
- `src/orchestrator/pipeline.ts` -- DPEV pipeline integration point (lines 131-174)
- `src/orchestrator/diagnosis.ts` -- extractContainerNames, preFilterIfLogHeavy
- `src/orchestrator/discovery.ts` -- runParallelDiscovery output format
- `src/config/types.ts` -- ModelRole includes 'worker', InfraBrainConfig schema
- [lenML/tokenizers GitHub](https://github.com/lenML/tokenizers) -- `fromPreTrained()`, `encode()`, offline operation

### Secondary (MEDIUM confidence)
- [npmjs.com @lenml/tokenizer-qwen3](https://www.npmjs.com/package/@lenml/tokenizer-qwen3) -- version 3.4.2, 306 weekly downloads
- [socket.dev analysis](https://socket.dev/npm/package/@lenml/tokenizer-qwen3) -- security analysis, maintenance status

### Tertiary (LOW confidence)
- Tokenizer initialization performance (~100-500ms) -- estimated from similar tokenizer libraries, not benchmarked for this specific package

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- `@lenml/tokenizer-qwen3` confirmed available, API verified from GitHub README; existing codebase patterns well-understood
- Architecture: HIGH -- integration points clearly identified in pipeline.ts; RollingContext provides proven compression pattern
- Pitfalls: MEDIUM -- tokenizer init cost and token count drift are inferred from general tokenizer library experience, not specific benchmarks
- Noise patterns: MEDIUM -- recommended patterns based on common Docker/systemd noise, but may need tuning for specific environments

**Research date:** 2026-04-10
**Valid until:** 2026-05-10 (stable domain, 30-day validity)
