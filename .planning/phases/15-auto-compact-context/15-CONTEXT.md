# Phase 15: Auto-Compact Context Management - Context

**Gathered:** 2026-04-10
**Status:** Ready for planning

<domain>
## Phase Boundary

Real-time token counting and automatic context compaction at 83% threshold. Preserves ground truth (container names, ports, error codes, discovery facts) while discarding noise. Integrates into the pipeline orchestrator (Phase 14 output). Does NOT include fix caching (Phase 16) or semantic memory (Phase 17).

</domain>

<decisions>
## Implementation Decisions

### Compaction Strategy
- Tiered eviction: first discard noise, then compress old observations, then summarize — multiple passes until under budget
- Summarization handled by the same worker model used for relevance scoring (model-agnostic naming, NOT "9B" — use `workerModel` or `relevanceScorer` so it's easy to swap for more capable models later)
- Target: compact down to 60% of context window (gives ~23% headroom before re-trigger)
- Save a snapshot of pre-compaction context to disk before evicting — user can inspect later but it never re-enters the LLM window
- Compaction fires exactly once per threshold crossing (no recursive loop) — success criterion #5

### Noise Filtering
- Regex pre-processor runs before discovery results enter context (at the point where `runParallelDiscovery` returns, before LLM prompt assembly)
- Core noise patterns hardcoded (healthcheck spam, systemd boilerplate) + skills can declare additional noise patterns in their YAML
- Worker model is a fallback for unknown formats only — if a discovery result has 10+ unrecognized lines, batch them and send for relevance scoring. Below 10 lines, include them all (latency overhead not worth it)
- CRITICAL: All naming must be model-agnostic — call it `workerModel` or `relevanceScorer`, never "9B". The underlying model will change as more powerful models become available

### Ground Truth Pinning
- Hybrid approach: auto-detect common types (container names, port numbers, error codes, IPs via existing extractors like `extractContainerNames`) + allow explicit `[PIN]...[/PIN]` markers for edge cases
- Pinned data collected into a dedicated `## Ground Truth` section at the top of the context — always included, never compacted
- This is the "unantastbare Zone" — tiered eviction only operates on the observations below it
- Hard cap at 20% of context window for ground truth. If exceeded, oldest pinned facts evicted with a warning log
- Session-only: ground truth lives in memory for the current diagnosis session. Fresh session = fresh discovery

### Claude's Discretion
- Observability: how token usage is surfaced (dev-mode logging, status output format)
- Exact regex patterns for known noise
- Snapshot file format and location
- Compaction ordering within each eviction tier

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `RollingContext` in `src/execution/context-builder.ts`: Already does step-level compression (keep last 2 full, compress rest). Pattern can be extended for pipeline-level compaction
- `estimateTokens()` in `src/llm/token-budget.ts`: Char-based heuristic (4 chars/token ASCII, 2 chars/token non-ASCII). CTXT-01 replaces this with `@lenml/tokenizer-qwen3` for real token counting
- `preFilterLogs()` in `src/log-analysis/filter.ts`: Level-based filtering + truncation to 200 lines. Noise filtering extends this concept
- `extractContainerNames()` in `src/orchestrator/diagnosis.ts`: Already extracts container names from discovery output — reusable for auto-pinning

### Established Patterns
- Token budget tracking: `checkBudget()` and `trackUsage()` in token-budget.ts — 80% threshold warning already exists
- TOON encoding: `encodeToon()` in toon-encoder.ts — compact encoding for LLM consumption
- Model routing: existing `ModelRole` type in config/types.ts — worker model role should follow this pattern

### Integration Points
- `pipeline.ts` (Phase 14): Main integration point — context management hooks into the DPEV pipeline between discovery and diagnosis
- `buildMessages()` in `src/orchestrator/context.ts`: Where LLM prompts are assembled — Ground Truth section injected here
- `runParallelDiscovery()` in `src/orchestrator/discovery.ts`: Noise filtering runs on its output before context assembly

</code_context>

<specifics>
## Specific Ideas

- Ground Truth section should feel like a stable reference block at the top — "harte Fakten" separated cleanly from "temporäre Fehlersuche"
- Worker model naming must be future-proof: the 9B model is a starting point, will be replaced by more capable models that need fewer parameters
- Pre-compaction snapshots are for post-mortem inspection, not for re-injection into the LLM

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 15-auto-compact-context*
*Context gathered: 2026-04-10*
