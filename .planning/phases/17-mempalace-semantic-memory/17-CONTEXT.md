# Phase 17: MemPalace Semantic Memory - Context

**Gathered:** 2026-04-10
**Status:** Ready for planning

<domain>
## Phase Boundary

InfraBrain remembers every incident it has worked on and uses past experience to improve future diagnoses. Native TypeScript implementation with temporal knowledge graph, semantic search, and 4-layer wake-up context. Uses LanceDB as embedded vector store (same as Phase 16 fix-caching). Does NOT include parallel inference (Phase 18) or terminal UI (Phase 19).

**Key constraint:** All memory operations are non-blocking — memory enriches diagnosis but never gates it. Graceful degradation if LanceDB is unavailable.

</domain>

<decisions>
## Implementation Decisions

### Wake-up Context Layers
- **L0 Identity (~100 tokens):** Dynamically generated from LanceDB metadata on session start — incident count, last activity, top expertise domains, success rate. Gives the reasoning model (Gemini 1.5 Pro) immediate awareness of its own history
- **L1 Recent Incidents (~500 tokens):** Last 3-5 incidents as one-liners: date, service, root cause, outcome. Always present in every session
- **L2 Filtered Search:** Runs every session — vector search using current error signature, returns top 3 similar past incidents. Cheap, always-on enrichment
- **L3 Deep Semantic:** Only fires on cache miss (Phase 16) AND weak L2 results (similarity < 0.7). Broader entity-based search across all memory. Avoids wasting tokens when cache or L2 already covers it
- **Injection:** Dedicated `[MEMORY]` block in LLM prompt, placed between `[GROUND TRUTH]` and `[DISCOVERY]`. L0+L1 pinned (survive context compaction), L2+L3 evictable under pressure
- **Token budgets:** L0 ~100, L1 ~500, L2+L3 dynamic based on available context window headroom

### Knowledge Graph Design
- **Entity storage:** Separate LanceDB table for entities with relationships (entity → incident, entity → entity). Not just metadata on incident vectors — full queryable entity table for "all incidents involving redis" style queries
- **Temporal validity:** Explicit `valid_from` / `valid_to` timestamps on every entity relationship. Full temporal tracking — can answer "what port did redis use last month?" queries
- **Entity types:** Reuse ground truth extractor categories: container, port, IP, error_code, plus service, hostname
- **Temporal decay:** Same exponential decay formula as Phase 16 cache confidence: `score = w_sim * similarity + w_rec * recency_score` where `recency_score = exp(-lambda * days_ago)`
- **Separate lambda in config.json:** Memory decay lambda configured independently from cache decay. Memory should have a much lower lambda (slower decay) because architectural knowledge stays relevant for months. Cache fixes decay faster
- **Wings/Rooms (MEM-08):** Single LanceDB table with `wing` discriminator column. Filter by wing in queries: wing_incidents, wing_config, wing_runbooks, wing_user. One table, one search endpoint, partition by column value

### Memory Skill Routing
- **Intent classification via workerModel:** Gemini 1.5 Flash classifies incoming user prompts — is this a memory query, an action query, or a combination? No keyword triggers needed. Natural language routing makes InfraBrain intuitive for non-technical users (Sachbearbeiter)
- **Classification output:** Structured JSON with fields: `{type: "memory"|"action"|"combined", search_query: string, time_range: {from, to}, format_hint: "list"|"narrative"|"combined"}`
- **Time parsing:** LLM extracts absolute date ranges from natural language ("letzte Woche", "im März", "gestern"). Current date/time injected as ISO format in classifier system prompt for accurate relative-to-absolute conversion
- **Response format:** Flexible — Gemini 1.5 Pro decides based on query type. List queries get structured tables, analysis queries get narratives, complex queries get both. Output optimized for Ink terminal (Chalk colors, Box components)
- **Memory skill file:** Standard skill markdown (memory.md) but routing is LLM-driven, not keyword-triggered. Skill file contains the system prompt template for memory response generation

### Claude's Discretion
- Incident auto-filing structure (what exactly gets stored from DPEVResult)
- Write-ahead log (WAL) implementation details for MEM-09
- LanceDB table schemas and index configuration
- Exact entity extraction patterns beyond ground truth extractor
- L2/L3 result formatting before prompt injection

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `CacheStore` in `src/cache/lance-store.ts`: Singleton LanceDB pattern — replicate for incident memory and entity tables
- `generateEmbedding()` in `src/cache/embedder.ts`: BGE-M3 1024-dim embeddings via OpenAI-compatible API — reuse directly for incident text embedding
- `confidenceScore()` in `src/cache/cache-lookup.ts`: Exponential decay + weighted similarity — adapt formula for memory scoring with separate lambda
- `GroundTruthManager` in `src/context/ground-truth.ts`: Entity extraction (containers, IPs, ports, error codes) — feed extracted entities into knowledge graph
- `SkillRegistry` in `src/skills/registry.ts`: Skill loading/routing pattern — memory.md follows same structure
- `WriteThrough` in `src/state/store.ts`: Dual file+SQLite storage — audit trail pattern for WAL
- `AuditLogger` in `src/audit/logger.ts`: JSONL append-only audit log — pattern for memory mutation logging
- `ContextManager` in `src/context/context-manager.ts`: Token budget tracking and compaction — [MEMORY] block integrates here

### Established Patterns
- Graceful degradation: All LanceDB operations return null/empty on failure, never throw (consistent with cache store)
- Singleton factory: `getCacheStore(dataDir)` keyed by directory — replicate for memory stores
- Config-driven: All thresholds/weights in `InfraBrainConfig` via zod schema — add `.memory` section
- OpenAI-compatible: All model calls through `src/llm/openai-compat.ts` — intent classifier uses same pattern

### Integration Points
- `runDPEV()` in `src/orchestrator/pipeline.ts` line ~240: Memory retrieval hooks between cache check and diagnosis (L2/L3 injection)
- `buildMessages()` in `src/orchestrator/context.ts`: Add [MEMORY] section to prompt assembly
- Execute route in `src/api/routes/execute.ts` lines 181-227: Incident auto-filing after successful execution (same pattern as cache write)
- `DPEVResult` in `src/orchestrator/types.ts`: All incident data available — diagnosis, fix plan, commands, outcome, session ID

</code_context>

<specifics>
## Specific Ideas

- L0 identity must be dynamic (not static template) — InfraBrain should be "aware" of its own history from boot. Generated from LanceDB metadata counts
- Separate decay lambda is critical — cache fixes expire fast, but architectural knowledge (which port redis uses, which server hosts what) stays relevant for months
- Intent classification makes InfraBrain accessible to non-technical users who don't know trigger keywords. "Hatten wir das schon mal?" should just work
- Current date/time must be injected into classifier prompt for accurate time reference resolution
- Response output should be Ink-terminal ready (Chalk formatting, Box components) in anticipation of Phase 19

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 17-mempalace-semantic-memory*
*Context gathered: 2026-04-10*
