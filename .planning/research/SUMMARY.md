# Project Research Summary

**Project:** InfraBrain v1.3 Intelligence Layer
**Domain:** AI IT Operations Platform -- Terminal UI, Vector Caching, Semantic Memory, Context Management, Parallel Execution
**Researched:** 2026-03-31
**Confidence:** MEDIUM-HIGH

## Executive Summary

InfraBrain v1.3 adds six capabilities to the existing DPEV engine: an Ink/React terminal UI, Qdrant-backed fix-caching, native TypeScript semantic memory (MemPalace patterns), auto-compact context management, parallel tool execution, and parallel inference. The existing architecture -- Express API, Commander CLI, AI SDK with 7-role model routing, safety pipeline -- is sound and unchanged. All six features integrate as new modules around the existing DPEV pipeline in `debug.ts`, which becomes the primary integration nexus. The recommended approach is to build foundational performance wins first (parallel discovery, auto-compact), then vector infrastructure (Qdrant fix-cache), then semantic memory, then parallel inference, and finally the Ink UI last once all backend APIs are stable.

Three user decisions override portions of the original research: (1) MemPalace will be implemented natively in TypeScript -- no Python sidecar, no MCP client, no ChromaDB dependency. The Wings/Rooms/Halls data model and temporal knowledge graph will be built directly against SQLite (structured hierarchy) and Qdrant (semantic search). (2) Qdrant is the single vector store for both fix-caching and semantic memory, using separate collections on one Docker instance. (3) The entire system must be air-gapped with zero external API calls, reinforcing the existing local-only vLLM/Ollama architecture.

The primary risks are: `debug.ts` becoming an unmaintainable 1000+ line integration nexus (mitigate by extracting a pipeline orchestrator early), auto-compact summarization recursion (mitigate with an `isCompacting` guard), and Qdrant Docker lifecycle races on first boot (mitigate with health-check polling and graceful degradation). The MemPalace-in-TypeScript decision eliminates the riskiest pitfalls from the original research (Python dependency, ChromaDB locking, MCP stdout pollution, first-run model downloads) but introduces a new risk: building a temporal knowledge graph from scratch requires careful data model design.

## Key Findings

### Recommended Stack

The v1.3 stack adds 7 npm production dependencies on top of the validated existing stack. No Python dependencies. No external API calls. See [STACK.md](./STACK.md) for full details.

**Core technologies:**
- **Ink 7 + React 19:** Terminal renderer replacing readline/chalk. Flexbox layout, incremental rendering, component-based UI. Requires Node 22+ (InfraBrain already on 25.2.1).
- **@qdrant/js-client-rest ^1.17:** REST client for Qdrant vector DB. Single Qdrant Docker instance serves both fix-cache and MemPalace collections. Graceful degradation if unavailable.
- **@lenml/tokenizer-qwen3 ^3.4.2:** Qwen-native token counting for accurate 32K context budgeting. GPT tokenizers diverge 15-40% on code -- unacceptable for compaction decisions.
- **p-queue ^9.1.2 + p-limit ^7.3.0:** Concurrency control for parallel discovery (p-limit, simple fan-out) and inference pipeline scheduling (p-queue, priority queue).
- **AI SDK built-ins (prepareStep, embed, generateText):** Auto-compact via prepareStep hook, embeddings via embed(), parallel inference via Promise.allSettled on generateText. No new LLM framework needed.

**Removed from original research (user decisions):**
- ~~MemPalace Python package~~ -- replaced by native TypeScript implementation
- ~~ChromaDB~~ -- replaced by Qdrant
- ~~@modelcontextprotocol/sdk~~ -- no MCP sidecar needed
- ~~Python 3.9+~~ -- no Python dependency at all

### Expected Features

See [FEATURES.md](./FEATURES.md) for complete feature landscape with complexity ratings.

**Must have (table stakes):**
- DPEV phase indicator with live transitions (Ink)
- Streaming LLM output panel (Ink + SSE)
- Fix-caching with vector similarity search (Qdrant, 2s vs 113s for repeat errors)
- Token counting and auto-compact at 80% context budget
- Parallel discovery commands (2-5x speedup)
- Persistent memory of past incidents and resolutions (MemPalace patterns in TypeScript)

**Should have (differentiators):**
- Split-panel dashboard layout (DPEV status + live output + model info)
- Self-healing retry visualization with attempt count and LLM correction display
- Context-aware cache keys (host + error + service fingerprint)
- DPEV-phase-aware compaction (retain current phase in full, compress older phases)
- Speculative pre-processing pipeline (9B worker + 32B reasoning in parallel)
- MemPalace hierarchy: Wings (infra domains) / Rooms (service clusters) / Halls (incident timelines)

**Defer to v2+:**
- Incident pattern recognition (need accumulated data first)
- Multi-GPU load balancing (single RTX 5090 is reference hardware)
- Fix evolution tracking (need cache volume first)
- Collapsible detail panels (high complexity, low immediate value)

### Architecture Approach

The v1.3 architecture adds four new `src/` directories (`ui/`, `cache/`, `memory/`, `context/`) around the unchanged DPEV core. The CLI-calls-API pattern is preserved -- Ink renders in the terminal while Express serves REST/SSE. Qdrant runs as a Docker sidecar with auto-lifecycle management. The MemPalace semantic memory is a native TypeScript module (not a sidecar process) using SQLite for the hierarchical structure and Qdrant for vector search. See [ARCHITECTURE.md](./ARCHITECTURE.md) for component-level integration details.

**Major components:**
1. **src/ui/** -- Ink/React terminal renderer. Replaces repl.ts + formatter.ts. Subscribes to Express SSE endpoints for live DPEV progress.
2. **src/cache/** -- Qdrant fix-caching. Intercepts DPEV pipeline: cache check before diagnosis, cache write after successful execution.
3. **src/memory/** -- Native TypeScript MemPalace. SQLite tables for Wings/Rooms/Halls hierarchy. Qdrant collection for semantic search over incident summaries. Recall before diagnosis, store after execution.
4. **src/context/** -- Auto-compact context management. Extends existing RollingContext + token-budget with LLM-based compaction via worker model.
5. **src/llm/parallel.ts** -- Parallel inference orchestration. Promise.allSettled wrapper with p-queue priority scheduling.

**Critical architecture decision:** Extract `debug.ts` DPEV pipeline into `src/orchestrator/pipeline.ts` early. Six features modify debug.ts -- leaving it as-is guarantees merge conflicts and an unmaintainable 1000+ line file.

### Critical Pitfalls

See [PITFALLS.md](./PITFALLS.md) for all 15 pitfalls with detection strategies.

1. **Ink + readline conflict** -- Ink takes over stdout/stdin; any surviving readline usage causes garbled output. Must remove ALL readline references (7 files) before enabling Ink. No partial migration.
2. **Auto-compact summarization recursion** -- prepareStep fires on every generateText call including the summarization call itself. Guard with `isCompacting` flag from day 1. Test with oversized context to verify exactly one compaction fires.
3. **Qdrant Docker lifecycle race** -- Container takes 2-5s to initialize after `docker run`. Implement health-check polling (`GET /healthz`, 5 retries, 1s interval). Degrade gracefully if unavailable.
4. **Fix cache poisoning** -- A coincidental fix gets cached and fails on future use. Track success rate in Qdrant metadata. Require 2+ successful applications before considering a fix "proven."
5. **debug.ts contention** -- Six features all modify the same 686-line file. Extract pipeline orchestrator before starting feature work to avoid merge hell.

## Implications for Roadmap

Based on dependency analysis, architecture boundaries, and risk ordering, the recommended phase structure is:

### Phase 1: Pipeline Extraction + Parallel Discovery
**Rationale:** Lowest risk, highest immediate payoff. Parallel discovery is a ~20-line change but delivers 2-5x speedup. Pipeline extraction from debug.ts is prerequisite housekeeping that prevents merge conflicts in all subsequent phases.
**Delivers:** `src/orchestrator/pipeline.ts` extracted from debug.ts. Discovery commands run via Promise.all. Configurable concurrency limit.
**Addresses:** Parallel tool execution (table stakes), debug.ts contention risk
**Avoids:** Pitfall 5 (debug.ts contention) by extracting early

### Phase 2: Auto-Compact Context Management
**Rationale:** Foundation for everything that adds context (MemPalace recall, parallel inference results, fix-cache metadata). Without auto-compact, 32K context windows overflow during self-healing loops and memory-enriched diagnoses.
**Delivers:** `src/context/` module. Token counting via @lenml/tokenizer-qwen3. Three-tier compaction (observation masking, TOON encoding, LLM summarization as last resort). DPEV-phase-aware retention.
**Uses:** @lenml/tokenizers, @lenml/tokenizer-qwen3, AI SDK prepareStep hook
**Avoids:** Pitfall 3 (summarization recursion) with isCompacting guard

### Phase 3: Qdrant Fix-Caching
**Rationale:** Proves vector infrastructure before MemPalace depends on it. Immediate user-visible impact (2s vs 113s for repeat errors). Single new external dependency (Qdrant Docker).
**Delivers:** `src/cache/` module. Qdrant Docker auto-lifecycle. BGE-M3 embedding integration. Cache lookup before diagnosis, cache write after successful fix. Graceful degradation.
**Uses:** @qdrant/js-client-rest, Qdrant Docker, AI SDK embed()
**Avoids:** Pitfall 2 (Docker races) with health-check polling, Pitfall 7 (dimension mismatch) with model metadata validation, Pitfall 9 (cache poisoning) with success rate tracking

### Phase 4: MemPalace Semantic Memory (Native TypeScript)
**Rationale:** Depends on Qdrant (from Phase 3) and auto-compact (from Phase 2, since memory recall injects context). Most complex new feature -- needs careful data model design. Building in TypeScript eliminates Python/ChromaDB/MCP risks entirely.
**Delivers:** `src/memory/` module. SQLite tables for Wings/Rooms/Halls hierarchy. Qdrant `memory` collection for semantic search. Entity extraction from DPEV output. Recall before diagnosis, auto-file after execution. Bi-temporal model (event time + ingestion time).
**Uses:** @qdrant/js-client-rest (shared instance, separate collection), better-sqlite3 (already in stack), AI SDK generateText for entity extraction
**Avoids:** Pitfall 4 (SQLite locking -- eliminated, no ChromaDB), Pitfall 10 (stdout pollution -- eliminated, no Python process), Pitfall 11 (model download -- eliminated, no Sentence Transformers)

### Phase 5: Parallel Inference Pipeline
**Rationale:** Benefits from auto-compact (Phase 2) and fix-cache (Phase 3) being in place. Requires vLLM backend for true parallelism (Ollama serializes). Optimization layer, not foundational.
**Delivers:** `src/llm/parallel.ts`. Promise.allSettled orchestration of 9B pre-processing + 32B reasoning. p-queue priority scheduling. Backend-aware degradation (parallel on vLLM, serial on Ollama).
**Uses:** p-queue, AI SDK generateText, existing UnifiedProvider with per-role baseUrl
**Avoids:** Pitfall 6 (priority starvation) by using separate queues per model tier

### Phase 6: Ink/React Terminal UI
**Rationale:** Build UI last so all backend features and SSE endpoints are stable. Largest surface area change (new src/ui/, delete repl.ts + formatter.ts). Rendering layer swap -- no business logic changes.
**Delivers:** `src/ui/` directory. DPEVTracker, ApprovalPrompt, ExecutionStream, HealthDashboard components. SSE subscription for live progress. CI/JSON fallback mode. Incremental migration (component by component).
**Uses:** ink, react, @inkjs/ui
**Avoids:** Pitfall 1 (readline conflict) by removing all readline before enabling Ink, Pitfall 8 (re-render performance) with virtualized step lists, Pitfall 14 (chalk inside Ink) by using Ink native color API

### Phase Ordering Rationale

- **Dependencies flow downward:** Each phase builds on the previous. Auto-compact protects context before features that expand it. Qdrant proves vector infra before MemPalace depends on it.
- **Risk front-loaded:** Pipeline extraction and auto-compact are lowest-risk, highest-leverage changes. Complex features (MemPalace, parallel inference) come after foundations are proven.
- **Backend before frontend:** All backend features stabilize before the UI wraps them. Building UI over shifting APIs causes rework.
- **Quick wins build momentum:** Phase 1 delivers measurable 2-5x discovery speedup with ~20 lines of code.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 4 (MemPalace):** Novel data model. No off-the-shelf TypeScript library for temporal knowledge graphs with the Wings/Rooms/Halls hierarchy. Needs schema design research, bi-temporal query patterns, and entity extraction prompt engineering. This is the highest-risk phase.
- **Phase 5 (Parallel Inference):** vLLM concurrent request behavior with mixed model sizes (7B + 32B on single GPU) needs benchmarking. VRAM partitioning strategy is hardware-dependent.

Phases with standard patterns (skip research-phase):
- **Phase 1 (Pipeline Extraction + Parallel Discovery):** Well-understood refactoring + Promise.all on independent commands. Trivial.
- **Phase 2 (Auto-Compact):** JetBrains NeurIPS 2025 research provides validated approach. Claude Code uses identical 83% threshold pattern.
- **Phase 3 (Qdrant Fix-Caching):** Standard vector similarity search. Qdrant JS SDK well-documented. BGE-M3 already deployed.
- **Phase 6 (Ink UI):** Ink is production-proven (Gatsby CLI, Shopify CLI, Yarn). Migration is incremental.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All npm packages verified on registry with exact versions. Qdrant Docker is production-grade. Ink 7 is the active release. |
| Features | MEDIUM-HIGH | Most features follow established patterns. MemPalace-in-TypeScript is novel integration with no reference implementation. |
| Architecture | HIGH | CLI-calls-API pattern is proven. New modules are additive. Safety pipeline untouched. Integration points well-defined. |
| Pitfalls | HIGH | Verified against InfraBrain source code, official docs, and community issue trackers. User decisions eliminated 3 of the riskiest pitfalls (Python/ChromaDB/MCP). |

**Overall confidence:** MEDIUM-HIGH

### Gaps to Address

- **MemPalace TypeScript data model:** No reference implementation exists for Wings/Rooms/Halls in TypeScript. Phase 4 planning needs schema design from first principles, informed by Graphiti/Zep temporal graph patterns but not copying them.
- **Knowledge decay function:** Research says "decay over time" but provides no specific function. Needs experimentation with real incident data during Phase 4.
- **vLLM concurrent model loading:** Can vLLM serve 7B + 32B models simultaneously on single RTX 5090 (32GB VRAM)? The 32B model alone uses ~20GB. May need time-slicing instead of true parallelism. Benchmark during Phase 5.
- **SSE endpoint design:** Architecture calls for SSE streaming from Express, but exact event schema for DPEV phase transitions needs definition during Phase 6 planning.
- **Qdrant collection strategy:** Fix-cache and MemPalace use separate Qdrant collections on same instance. Verify BGE-M3 embeddings work well for both error pattern matching and incident summary search. May need different embedding strategies per collection.

## Sources

### Primary (HIGH confidence)
- [Ink GitHub / npm](https://github.com/vadimdemedes/ink) -- v7.0.0, React 19.2+ peer dep, Node 22+
- [@qdrant/js-client-rest npm](https://www.npmjs.com/package/@qdrant/js-client-rest) -- v1.17.0
- [Qdrant installation docs](https://qdrant.tech/documentation/guides/installation/) -- Docker setup, no JS embedded mode
- [@lenml/tokenizer-qwen3 npm](https://www.npmjs.com/package/@lenml/tokenizer-qwen3) -- v3.4.2, Qwen-native
- [AI SDK reference](https://ai-sdk.dev/docs/reference/ai-sdk-core/generate-text) -- prepareStep, embed, parallel calls
- [JetBrains: The Complexity Trap (NeurIPS 2025)](https://blog.jetbrains.com/research/2025/12/efficient-context-management/) -- observation masking vs summarization

### Secondary (MEDIUM confidence)
- [Zep: Temporal Knowledge Graph Architecture (arXiv)](https://arxiv.org/abs/2501.13956) -- bi-temporal model inspiration for MemPalace
- [Graphiti: Open Source Temporal KG](https://github.com/getzep/graphiti) -- three-tier subgraph pattern
- [P-EAGLE speculative decoding](https://aws.amazon.com/blogs/machine-learning/p-eagle-faster-llm-inference-with-parallel-speculative-decoding-in-vllm/) -- vLLM v0.16+ integration
- [Claude Code auto-compact architecture](https://platform.claude.com/docs/en/build-with-claude/compaction) -- 83% threshold pattern

### Tertiary (LOW confidence)
- [GraphZep TypeScript port](https://github.com/aexy-io/graphzep) -- early-stage, Neo4j-coupled. Informational only.
- vLLM concurrent multi-model serving on single GPU -- no authoritative benchmarks for 7B+32B simultaneous loading on 32GB VRAM

---
*Research completed: 2026-03-31*
*Ready for roadmap: yes*
