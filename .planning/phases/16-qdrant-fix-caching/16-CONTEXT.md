# Phase 16: Qdrant Fix-Caching - Context

**Gathered:** 2026-04-10
**Updated:** 2026-04-10 (LanceDB pivot — no Docker dependency)
**Status:** Ready for planning

<domain>
## Phase Boundary

Repeat errors resolved in under 2 seconds via vector similarity cache lookup, with zero LLM calls for cache hits. Uses **LanceDB** as embedded vector store (in-process, no external service). Cache is an optimization layer -- InfraBrain works normally without it (graceful degradation). Does NOT include semantic memory (Phase 17) or terminal UI (Phase 19).

**Key constraint:** InfraBrain is a universal standalone tool. No Docker, no external services required. LanceDB runs fully in-process via NAPI Rust bindings.

</domain>

<decisions>
## Implementation Decisions

### Cache Lookup Flow
- Cache check happens **before diagnosis** in the DPEV pipeline -- after discovery + noise filter, before LLM diagnosis
- On cache hit (similarity > 0.85): skip diagnosis and planning entirely, show abbreviated diagnosis block with cached fix plan + provenance
- The abbreviated block is styled differently from live LLM output (dimmed/prefixed) to make it obvious this is a cached result
- User is prompted "Use cached fix or re-diagnose?" before proceeding to execution -- gives explicit control over cache bypass
- `--no-cache` flag also available to force fresh LLM diagnosis without prompt

### Soft Zone (Speculative Execution)
- Similarity 0.85+: Fast Path -- auto-suggest cached fix, prompt user
- Similarity 0.75-0.85: Speculative Execution -- show cached fix as "Possible Match" while running LLM diagnosis in parallel in the background. If LLM returns before user decides, present both options
- Similarity below 0.75: Cache miss -- full LLM diagnosis
- This leverages the parallel inference strategy (Phase 18) when available, falls back to sequential

### Success Feedback Loop
- Each cache entry tracks: hit_count, success_count, last_used timestamp
- When a cached fix is used and succeeds (execution completes without circuit breaker), increment success_count
- When a cached fix is rejected or fails, record that too
- Success rate feeds into confidence scoring

### Confidence Scoring
- Formula: `confidence = w_sim * similarity + w_rec * recency_score + w_suc * success_rate`
- Default weights: w_sim=0.5, w_rec=0.3, w_suc=0.2
- Weights configurable in config.json so power users can tune
- recency_score uses exponential decay -- very old fixes lose confidence faster than medium-age ones
- Similarity dominates, recency prevents stale fixes, success rate learns from outcomes

### Embedding Strategy
- Embed error signature + filtered discovery context (post-noise-filter output from Phase 15)
- This means "same error in same infrastructure state" matches, but "same error with different root cause" does not
- Use BGE-M3 model (already in modelMap as `embedding` role)

### Cache Invalidation
- Per-skill purge: each cache entry stores which skill produced the fix
- When a skill file changes, only entries tagged with that skill are purged
- Detection is **eager on startup**: hash all skill files on boot, compare against stored hashes, purge stale entries immediately
- No TTL -- exponential decay in confidence scoring naturally deprioritizes old entries without hard expiry
- Entries stay in Qdrant indefinitely but lose to fresh LLM diagnosis via low recency score

### Manual Cache Management
- `infrabrain cache clear` -- full purge of all cached fixes
- `infrabrain cache list` -- show entries with stats (similarity, hit count, success rate, age, skill)
- Useful for debugging and maintenance

### Vector Store: LanceDB (User Decision 2026-04-10)
- **LanceDB replaces Qdrant** — embedded, in-process, no subprocess, no Docker
- Package: `@lancedb/lancedb` (NAPI Rust bindings, platform-specific)
- Storage: local directory (Lance columnar format), portable
- No server process, no port management, no lifecycle management needed
- Zero startup overhead beyond module import

### Claude's Discretion
- LanceDB table schema and index configuration
- Exact embedding input formatting (how error signature + discovery context are concatenated)
- Cache entry payload structure beyond the required fields
- Abbreviated diagnosis block exact formatting

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `ModelRole` in `src/config/types.ts`: Already has `embedding: 'bge-m3'` role defined -- use this for BGE-M3 embedding calls
- `ContextManager` in `src/context/context-manager.ts`: Handles noise filtering and ground truth -- cache check uses the same post-filter discovery context
- `filterNoise()` in `src/context/noise-filter.ts`: Cache embedding input should use noise-filtered output (same as what goes to LLM)
- `pipeline.ts` in `src/orchestrator/pipeline.ts`: Main integration point -- cache check inserts between noise filter and diagnosis stages

### Established Patterns
- OpenAI-compatible API calls via `src/llm/openai-compat.ts` -- BGE-M3 embedding calls should follow the same pattern
- Config schema extension via zod in `src/config/types.ts` -- cache config (weights, thresholds) added here

### Integration Points
- `runDPEV()` in `pipeline.ts`: Cache check inserts after `filterNoise()` call, before `runDiagnosis()` call
- `buildMessages()` in `src/orchestrator/context.ts`: Cached diagnosis bypasses this entirely
- `SkillRegistry` in `src/skills/registry.ts`: Skill file hashing for invalidation hooks into registry lifecycle

</code_context>

<specifics>
## Specific Ideas

- The "Speculative Execution" soft zone (0.75-0.85) is a key differentiator -- it turns the cache into a smart system that hedges its bets rather than a binary hit/miss
- Provenance display should include the original incident date and similarity score so the admin understands WHY this fix was suggested
- Cache is explicitly an optimization, never a requirement -- "Cache Hit" is a nice-to-have speedup, not a dependency

</specifics>

<deferred>
## Deferred Ideas

None -- discussion stayed within phase scope

</deferred>

---

*Phase: 16-qdrant-fix-caching*
*Context gathered: 2026-04-10*
