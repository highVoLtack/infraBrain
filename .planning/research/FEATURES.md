# Feature Landscape: v1.3 Intelligence Layer

**Domain:** AI Operations Platform -- Terminal UI, Vector Caching, Semantic Memory, Context Management, Parallel Execution, Parallel Inference
**Researched:** 2026-03-31
**Confidence:** MEDIUM-HIGH (most components have production-grade libraries; MemPalace pattern is novel integration)

---

## 1. Ink/React Terminal UI with Live DPEV Tracking

### Table Stakes

| Feature | Why Expected | Complexity | InfraBrain Integration |
|---------|--------------|------------|----------------------|
| DPEV phase indicator (D/P/E/V) with live transitions | Users need to know which phase is active; current chalk output scrolls off-screen | Low | Replace `formatter.ts` chalk output with Ink `<Box>` layout |
| Streaming LLM output panel | Diagnosis/planning text arrives token-by-token; must render incrementally | Medium | Hook into AI SDK v6 `streamText` / `streamObject` callbacks |
| Step progress bar with pass/fail indicators | Execution phase has N steps; users need at-a-glance progress | Low | Map `executePlan()` step loop to Ink `<ProgressBar>` component |
| Risk-colored command display | Already exists in `formatCommand()` -- must translate to Ink `<Text>` styling | Low | Direct port from chalk color mapping to Ink `<Text color="">` |
| Static log area (completed output above, live area below) | Prevents re-render from erasing past output; Ink `<Static>` component solves this | Medium | `<Static>` for completed steps; dynamic `<Box>` for current step |
| Keyboard-driven approval (Y/N/typed confirmation) | Already exists via readline; must port to Ink `useInput()` hook | Medium | Replace `approval.ts` readline prompts with Ink input components |

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Split-panel layout: DPEV status + live output + model info | Dashboard-style view showing phase, model routing role, and streaming output simultaneously | Medium | Yoga Flexbox enables `flexDirection: 'row'` for side-by-side panels |
| Self-healing retry visualization | Show attempt count, error, LLM correction in real-time during self-heal loop | Medium | Existing `selfHealStep()` emits events; render as Ink state updates |
| Model routing indicator | Show which model role (triage/forensic/strategic) is active and why | Low | Read from ModelRegistry selection, display in header `<Box>` |
| Braille spinner with model latency | Current braille spinners exist; add p50/p99 inference timing | Low | Wrap existing spinner logic in Ink `<Spinner>` + timing state |
| Collapsible detail panels | Expand/collapse diagnostic details, plan steps, execution output on demand | High | Requires focus management with `useFocus()` + toggle state |

### Anti-Features

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Full TUI with mouse support | Over-engineering; InfraBrain users are CLI-native admins, not GUI users | Keyboard-only interaction via `useInput()` |
| Color themes / customization | Scope creep; enterprise admins want consistent, readable output | Single well-designed color scheme matching existing chalk palette |
| Animated transitions between phases | Terminal rendering is 60fps max, animations waste cycles and distract | Instant phase transitions with clear visual state change |
| Web-based alternative renderer | Out of scope per PROJECT.md ("Mobile or web UI" is deferred) | CLI-first; API-first design enables future web layer |

### Architecture Notes

**Ink v6** is ESM-only, requires React >= 19 and Node >= 20. InfraBrain is already ESM (`"type": "module"` in package.json). Key pattern: Ink replaces the entire `cli/formatter.ts` and `cli/repl.ts` layer. The orchestrator and execution engine remain unchanged -- they emit events/state, and Ink components subscribe.

**Migration path:** Keep chalk as fallback for `--json` mode and piped output. Ink renders only when stdout is a TTY. This preserves the existing `--json` envelope contract.

**Key library:** `ink` v6 + `@inkjs/ui` (spinner, select, text-input components). No additional UI framework needed.

---

## 2. Qdrant Fix-Caching via Vector Similarity Search

### Table Stakes

| Feature | Why Expected | Complexity | InfraBrain Integration |
|---------|--------------|------------|----------------------|
| Embed error signatures using BGE-M3 (already deployed) | Need vector representation of error patterns for similarity search | Low | BGE-M3 is already in the model inventory; call via embedding role |
| Store fix plans as vector-indexed documents | When a fix succeeds, persist the (error embedding, fix plan) pair | Medium | New `fix-cache/` module alongside existing `state/store.ts` |
| Similarity threshold for cache hits (configurable) | Too low = wrong fix applied; too high = cache never hits | Low | Config value (0.85 default), adjustable per-skill |
| Cache invalidation on fix failure | If a cached fix fails on retry, mark it as invalid for this context | Medium | Track success/failure counts per cached fix; auto-invalidate below threshold |
| Qdrant as sidecar (Docker container, default embedded) | Enterprise needs external Qdrant; solo dev needs zero-config embedded | Medium | Docker Compose for Qdrant sidecar; fallback to Qdrant binary spawned by InfraBrain |

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| 2-second cached fix vs 113-second LLM reasoning | The core value prop: seen-before errors resolve in <3s | Medium | Bypass DPEV Diagnose+Plan phases when cache confidence > threshold |
| Context-aware cache keys (host + error + service stack) | Same error on nginx vs postgres needs different fixes | Medium | Composite embedding: error text + service metadata |
| Cache hit rate dashboard | Show admins how much time the cache is saving | Low | Aggregate stats in SQLite audit log, display in Ink status panel |
| Semantic cache with Qdrant's built-in mechanism | Qdrant supports semantic caching natively -- reuse query results | Low | Configure Qdrant collection with payload indexing for fast retrieval |
| Fix evolution tracking | When an LLM improves on a cached fix, update the cache entry | High | Requires comparing fix plan diffs and scoring improvements |

### Anti-Features

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Cache-first without verification | Cached fix might be stale (infra changed since cache entry) | Always run Verify phase even on cache hits |
| Global cache across unrelated systems | Fixes are context-dependent; postgres fix for host A might harm host B | Namespace cache by target host + service fingerprint |
| Automatic cache population from external sources | Supply-chain risk; only locally-validated fixes enter the cache | Cache only from successful InfraBrain DPEV completions |

### Architecture Notes

**Qdrant deployment:** Two modes. (1) Embedded: InfraBrain spawns `qdrant` binary on startup, stores data in `~/.infrabrain/qdrant/`. (2) External: Point to existing Qdrant server via config. The `@qdrant/qdrant-js` SDK (v1.17.0) supports both REST and gRPC with identical TypeScript interfaces.

**Embedding model:** BGE-M3 is already in the model inventory (embedding role). Produces 1024-dim vectors. Collection schema: `{ id, error_embedding, fix_plan_json, target_host, service_fingerprint, success_count, created_at, last_used_at }`.

**Cache lookup flow:** Error text -> BGE-M3 embedding -> Qdrant search (cosine, threshold 0.85) -> if hit: return cached fix plan (skip Diagnose+Plan) -> Execute -> Verify -> if verify fails: invalidate cache entry, fall through to full DPEV.

---

## 3. MemPalace Semantic Memory (Wings/Rooms/Halls)

### Table Stakes

| Feature | Why Expected | Complexity | InfraBrain Integration |
|---------|--------------|------------|----------------------|
| Persistent memory of past incidents and resolutions | Without memory, InfraBrain re-diagnoses the same issue from scratch every time | Medium | New `memory/` module, stores incident graphs |
| Temporal awareness (what was true at time T) | Infrastructure changes over time; a fix valid last week may be wrong today | High | Bi-temporal model (event time + ingestion time) per Zep/Graphiti pattern |
| Entity extraction from diagnostic output | Automatically identify hosts, services, error codes, config files from DPEV output | Medium | LLM extraction (worker role) from diagnosis text into structured entities |
| Semantic search over past incidents | "Have we seen this error before?" queries across all past sessions | Medium | Vector embeddings of incident summaries stored in Qdrant |

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| MemPalace hierarchy: Wings (infrastructure domains) / Rooms (service clusters) / Halls (incident timelines) | Spatial metaphor maps naturally to IT infrastructure topology | High | Novel data model; no off-the-shelf library provides this exact pattern |
| Causal relationship tracking | "Disk full on host A caused DB crash on host B" -- track cross-host causality | High | Entity-relationship graph with typed edges (caused_by, resolved_by, colocated_with) |
| Knowledge decay with confidence scoring | Old facts degrade in confidence unless re-confirmed by new incidents | Medium | Decay function on entity confidence scores, reset on re-observation |
| Incident pattern recognition | Detect recurring patterns: "This postgres OOM happens every Monday at 3am" | High | Temporal pattern analysis over incident timeline data |
| MemPalace as sidecar service | Keep memory layer independent; can be swapped or upgraded without touching core engine | Medium | Separate process, communicates via REST/gRPC, own data store |

### Anti-Features

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Neo4j/graph database dependency | Heavy dependency; InfraBrain targets air-gapped environments where Neo4j is overkill | Use SQLite + Qdrant for graph-like queries; upgrade path to Neo4j for enterprise |
| Full Graphiti/Zep integration | Python-only (Graphiti); adds Python runtime dependency to TypeScript stack | Build MemPalace as native TypeScript module inspired by Graphiti's temporal model |
| Automatic fact overwriting | Old facts might still be valid; temporal model preserves history | Invalidate with validity windows, never delete |
| Memory affecting execution without HITL | "I remember this fix worked before" should suggest, not auto-execute | Memory informs Diagnose phase context, does not bypass approval gates |

### Architecture Notes

**MemPalace data model:**

```
Wing (infrastructure domain)
  e.g., "Networking", "Database", "Container Runtime"
  |
  +-- Room (service cluster / host group)
  |     e.g., "Production Postgres Cluster", "Edge Nginx Fleet"
  |     |
  |     +-- Hall (incident timeline)
  |           e.g., "2026-03-15: OOM on pg-primary"
  |           Contains: entities, relationships, resolution, timestamps
  |
  +-- Room ...
```

**Implementation strategy:** SQLite tables for the hierarchical structure (wings, rooms, halls, entities, relationships). Qdrant for semantic search over entity descriptions and incident summaries. The MemPalace module exposes a TypeScript API that the orchestrator calls during the Diagnose phase to inject relevant historical context.

**Graphiti/Zep inspiration:** Adopt the bi-temporal model (event time T + ingestion time T') and the three-tier subgraph pattern (episode/entity/community), but implement in TypeScript with SQLite+Qdrant instead of Neo4j. The `graphzep` TypeScript port exists but is early-stage and tightly coupled to Neo4j. Building a purpose-built implementation is lower risk.

**Sidecar pattern:** MemPalace runs as a separate process (`infrabrain-memory`) with its own SQLite + Qdrant storage. The main InfraBrain process communicates via local HTTP. This keeps the memory layer independently deployable and upgradeable. For single-machine deployments, it can be spawned as a child process.

---

## 4. Context Window Management (Auto-Compact/Summarization)

### Table Stakes

| Feature | Why Expected | Complexity | InfraBrain Integration |
|---------|--------------|------------|----------------------|
| Token counting before LLM calls | Must know how close to 32K limit before sending context | Low | Extend existing `token-budget.ts` with running token counter |
| Observation masking for stale tool outputs | JetBrains research proves this matches summarization quality at half the cost | Low | Replace old step outputs with `[output omitted, see step N]` placeholders |
| Context budget allocation (system 1.5%, content 62.5%, conversation 23.5%, response 12.5%) | Standard allocation for 32K models prevents response truncation | Low | Configure in `config.json`, enforce in context builder |
| Automatic compaction trigger at threshold | When context exceeds N% of window, compact before next LLM call | Medium | Check token count before each `generateText`/`generateObject` call |

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Hybrid compaction (observation masking + selective summarization) | JetBrains NeurIPS 2025: hybrid approach gives 7-11% cost reduction over either alone | Medium | Mask stale outputs first, then summarize only when masking is insufficient |
| DPEV-phase-aware compaction | Diagnose output is critical during Plan; Plan output is critical during Execute | Medium | Phase-specific retention rules: keep current and previous phase in full, compress older phases |
| TOON-aware compaction | InfraBrain already uses TOON encoding for token compression; compound with compaction | Low | Apply TOON encoding after compaction for maximum context density |
| Proactive context waste reduction | Morph FlashCompact principle: reduce waste at source, not after the fact | Medium | Trim verbose command outputs at capture time; store only relevant lines |
| Rolling context window for self-healing | Self-healer iterates up to 5 times; each attempt adds context; must not overflow | Medium | Existing `RollingContext` class in `execution/context-builder.ts` needs token-aware truncation |

### Anti-Features

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| LLM-only summarization | Expensive (requires extra LLM call), can hallucinate file paths and error messages | Use observation masking as primary; LLM summarization only for multi-phase summaries |
| Aggressive early compaction | Losing context too early degrades diagnostic quality | Compact only when token count exceeds 80% of budget; prefer masking over deletion |
| Token-level pruning (LLMlingua-style) | Can corrupt code syntax, shell commands, and config file content | Work at message/block level, not token level |
| One-size-fits-all compaction | Different DPEV phases have different context needs | Phase-aware retention policies |

### Architecture Notes

**Existing hooks:** `token-budget.ts` and `RollingContext` in `execution/context-builder.ts` already track context. The auto-compact system wraps these with a compaction pipeline:

1. **Measure:** Count tokens for all context blocks before LLM call
2. **Mask:** If over 80% budget, replace stale tool outputs with placeholders (observation masking)
3. **Compress:** If still over budget after masking, apply TOON encoding to remaining verbose blocks
4. **Summarize:** If still over budget, LLM-summarize the oldest DPEV phase(s) -- last resort only
5. **Allocate:** Reserve 12.5% of budget for response generation

**Key research finding:** JetBrains "The Complexity Trap" (NeurIPS 2025 DL4Code workshop) demonstrated that simple observation masking halves cost while matching summarization solve rates on SWE-bench. The hybrid approach (masking + summarization) achieves optimal results. This is the recommended strategy for InfraBrain's 32K context window.

---

## 5. Parallel Tool Execution with Concurrency Safety

### Table Stakes

| Feature | Why Expected | Complexity | InfraBrain Integration |
|---------|--------------|------------|----------------------|
| Read-only tool calls execute in parallel | Discovery commands (docker ps, systemctl status, cat logs) are safe to parallelize | Medium | Extend `classifyCommand()` READ classification to mark concurrency-safe |
| Write/destructive tool calls execute serially | Mutations must be ordered; existing damage budget enforces this | Low | Already serial in `executePlan()`; formalize with concurrency-safe flag |
| Configurable concurrency limit (4-6 default) | Prevent overwhelming target hosts with too many simultaneous SSH sessions | Low | New config value `execution.maxParallelTools` |
| Result ordering preservation | Parallel results must be presented in logical order, not completion order | Medium | Collect results with index, sort before display |

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Discovery phase parallelization (2-5x speedup) | Docker inspect + log fetch + systemctl status all run simultaneously | Medium | Partition discovery commands into parallel batch before diagnosis LLM call |
| Damage budget integration with parallel execution | Parallel writes must collectively respect the damage budget, not just individually | Medium | Shared `DamageBudget` instance with atomic deduction across parallel tasks |
| Per-target concurrency limits | Host A can handle 6 parallel commands; host B (legacy) only 2 | Low | Config per target host in `config.json` |
| Progressive result streaming | Show results as they arrive, not after all complete | Medium | Async generator pattern (Claude Code style) with Ink live rendering |
| Automatic serial fallback on conflict detection | If two parallel commands would touch the same resource, automatically serialize them | High | Resource lock detection heuristics (same file path, same service name) |

### Anti-Features

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Parallel execution of fix steps | Fix steps often have dependencies (stop service -> modify config -> start service) | Keep fix execution serial; only parallelize discovery/read operations |
| Unlimited concurrency | Can overwhelm target hosts, trigger rate limits, exhaust SSH connections | Hard cap at configurable limit (default 6) |
| Parallel execution across different targets without isolation | Cross-target parallel execution risks cascading failures | Parallelize within one target's discovery; serialize across targets |

### Architecture Notes

**Claude Code pattern adoption:** The `partitionToolCalls()` pattern classifies each tool call as concurrency-safe or not. InfraBrain already has `classifyCommand()` in `safety/classifier.ts` with `RiskLevel.READ` classification. Extend this with a `isConcurrencySafe(): boolean` method.

**Implementation:**
```
Discovery phase (parallel):
  Promise.allSettled([
    runCommand("docker ps --format json"),
    runCommand("journalctl -u nginx --since '1h ago'"),
    runCommand("systemctl status postgresql"),
    runCommand("df -h"),
  ]) -> aggregate results -> feed to Diagnose LLM

Execution phase (serial, unchanged):
  for step of plan.steps:
    await executeStep(step)  // existing safety pipeline
```

**Damage budget thread safety:** The existing `DamageBudget` class uses synchronous methods. For parallel execution, wrap budget checks in a mutex (Node.js is single-threaded, so `Promise` sequencing suffices -- no actual mutex needed, just ensure budget check + deduction is atomic within a single microtask).

---

## 6. Parallel Inference Pipeline (Multi-Model)

### Table Stakes

| Feature | Why Expected | Complexity | InfraBrain Integration |
|---------|--------------|------------|----------------------|
| Small model pre-processes while large model reasons | 9B Qwen worker extracts log structure while 32B infrabrain diagnoses | Medium | Orchestrator dispatches parallel LLM calls via different model roles |
| Non-blocking inference queue | LLM calls should not block each other when targeting different models | Medium | Separate request queues per model backend (vLLM slots) |
| Model health monitoring | Detect when a model is overloaded or unresponsive, route around it | Low | Extend existing health check in `/infra:health` command |

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Speculative pre-processing pipeline | 9B model starts log analysis immediately; 32B model starts diagnosis when pre-processing completes | High | Requires pipeline orchestration with dependency tracking between model outputs |
| P-EAGLE speculative decoding (vLLM v0.16+) | 2-3x inference speedup at low concurrency using draft model | Medium | vLLM config: enable P-EAGLE with Qwen3-Coder 30B head; pre-trained heads available on HuggingFace |
| Multi-model routing with load balancing | Distribute inference across multiple GPU instances if available | High | Extend `UnifiedProvider` with round-robin or least-loaded routing |
| Cascading inference (fast model first, escalate if uncertain) | 7B worker attempts diagnosis; if confidence low, escalate to 32B; then to 70B strategic | Medium | Already exists conceptually in self-healing escalation (worker -> strategic -> forensic) |

### Anti-Features

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Speculative decoding at high concurrency (>10 requests) | Performance gains diminish; may hurt throughput at high batch sizes | Enable only for single-user inference; disable for batch workloads |
| Mandatory multi-GPU requirement | InfraBrain targets single RTX 5090 as reference hardware | Design for single GPU with optional multi-GPU; pipeline parallelism only with 2+ GPUs |
| Tight coupling to vLLM-specific features | Provider interface must remain abstracted (Ollama, vLLM, llama.cpp) | Expose parallel inference as optional capability; gracefully degrade to serial on Ollama |

### Architecture Notes

**Existing infrastructure:** The `UnifiedProvider` (OpenAI-compatible) already routes to different models by role. Parallel inference means issuing multiple role-based calls concurrently:

```
Parallel inference pipeline:
  t=0: worker(9B) starts log parsing         | triage(9B) starts error classification
  t=2: worker completes, feeds structured logs to...
  t=2: default(32B) starts diagnosis with structured input
  t=8: default(32B) completes diagnosis
  Total: ~10s (vs ~15s serial)
```

**vLLM parallel capacity:** With 32GB VRAM on RTX 5090, running 32B (main) + 7B (worker) simultaneously requires careful VRAM management. vLLM's continuous batching handles this if both models are loaded. Alternative: time-slice -- worker model runs first, unloads, main model runs.

**Speculative decoding:** P-EAGLE (vLLM v0.16+) uses a small draft head to generate K tokens in one forward pass, verified by the target model in parallel. Pre-trained heads exist for Qwen3-Coder 30B. This is a vLLM config flag, not application code. Enable when using vLLM backend; gracefully unavailable on Ollama.

---

## Feature Dependencies

```
[Ink/React UI] -----> independent, no prerequisites
     |
     +-- enables --> [DPEV phase tracking visualization]
     +-- enables --> [Self-heal retry visualization]
     +-- enables --> [Progressive result streaming from parallel tools]

[Qdrant Fix-Caching] -----> requires BGE-M3 (already deployed)
     |
     +-- enables --> [MemPalace semantic search layer]

[Auto-Compact] -----> requires token-budget.ts extension (already exists)
     |
     +-- required by --> [Self-healing loop (5 attempts generate context)]
     +-- required by --> [MemPalace context injection into Diagnose phase]

[Parallel Tool Execution] -----> requires classifyCommand() extension
     |
     +-- enhanced by --> [Ink/React UI for progressive results]
     +-- requires --> [Damage Budget thread safety]

[Parallel Inference] -----> requires UnifiedProvider concurrent call support
     |
     +-- enhanced by --> [vLLM P-EAGLE speculative decoding]
     +-- optional --> [Multi-GPU load balancing]

[MemPalace] -----> requires Qdrant (from fix-caching)
     |            +-- requires Auto-Compact (memory injection adds context)
     +-- enhanced by --> [Parallel Tool Execution for discovery enrichment]
```

---

## MVP Recommendation

### Phase 1: Foundation (do first, enables everything visual)
1. **Ink/React Terminal UI** -- Replaces chalk/formatter layer. Unlocks live DPEV tracking, streaming output, and progressive results for all subsequent features.
2. **Auto-Compact** -- Critical for 32K context window. Without this, MemPalace context injection and self-healing loops will overflow the context. Low complexity, high leverage.

### Phase 2: Performance (immediate user-visible speedup)
3. **Parallel Tool Execution** -- Discovery phase goes from serial to parallel. 2-5x speedup on diagnosis. Leverages existing `classifyCommand()` READ classification.
4. **Qdrant Fix-Caching** -- Repeat errors resolve in 2s instead of 113s. BGE-M3 already deployed. Qdrant adds one sidecar container.

### Phase 3: Intelligence (long-term learning)
5. **Parallel Inference Pipeline** -- vLLM-specific optimization. 9B pre-processes while 32B reasons. Optional P-EAGLE for 2-3x speedup.
6. **MemPalace Semantic Memory** -- Most complex feature. Depends on Qdrant and Auto-Compact. Novel data model requires careful design. Build last, iterate longest.

### Defer
- **MemPalace incident pattern recognition** (temporal pattern analysis): Defer until enough incident data exists to validate patterns.
- **Multi-GPU load balancing**: Defer until multi-GPU deployments exist in the field.
- **Fix evolution tracking**: Defer until fix cache has enough entries to compare.

---

## Sources

### Ink/React Terminal UI
- [Ink GitHub Repository](https://github.com/vadimdemedes/ink) -- React for interactive CLI apps
- [LogRocket: Ink UI with React](https://blog.logrocket.com/using-ink-ui-react-build-interactive-custom-clis/) -- Patterns and component architecture
- [oclif, Ink, Rust: Framework Decision](https://levelup.gitconnected.com/oclif-ink-rust-and-the-framework-decision-that-shapes-everything-13f2c18539ec) -- Framework comparison 2026

### Qdrant Fix-Caching
- [Qdrant JS SDK](https://github.com/qdrant/qdrant-js) -- TypeScript SDK v1.17.0
- [Qdrant Semantic Caching](https://medium.com/@benitomartin/balancing-accuracy-and-speed-with-qdrant-hyperparameters-hydrid-search-and-semantic-caching-part-84b26037e594) -- Semantic cache implementation patterns
- [Qdrant Edge](https://qdrant.tech/edge/) -- Embedded deployment option

### MemPalace / Temporal Knowledge Graphs
- [Zep: Temporal Knowledge Graph Architecture (arXiv)](https://arxiv.org/abs/2501.13956) -- Three-tier temporal graph model
- [Graphiti: Open Source Temporal KG](https://github.com/getzep/graphiti) -- Python framework for temporal knowledge graphs
- [GraphZep: TypeScript Port](https://github.com/aexy-io/graphzep) -- TypeScript implementation of Graphiti concepts
- [State of AI Agent Memory 2026](https://mem0.ai/blog/state-of-ai-agent-memory-2026) -- Market overview

### Context Window Management
- [JetBrains: The Complexity Trap (NeurIPS 2025)](https://blog.jetbrains.com/research/2025/12/efficient-context-management/) -- Observation masking vs summarization
- [FlashCompact: Compaction Methods Compared](https://www.morphllm.com/flashcompact) -- All 8 compaction methods analyzed
- [Claude Code Auto-Compact](https://www.morphllm.com/claude-code-auto-compact) -- Production auto-compact patterns
- [Anthropic: Automatic Context Compaction](https://platform.claude.com/cookbook/tool-use-automatic-context-compaction) -- Official compaction cookbook

### Parallel Tool Execution
- [Parallel Tool Execution: Agentic Systems Series](https://gerred.github.io/building-an-agentic-system/parallel-tool-execution.html) -- partitionToolCalls pattern
- [Claude Code: Tool Orchestration](https://kenhuangus.substack.com/p/claude-code-pattern-5-tool-orchestration) -- Read-only vs write classification
- [How Claude Code Works](https://code.claude.com/docs/en/how-claude-code-works) -- Official architecture docs

### Parallel Inference
- [P-EAGLE: Parallel Speculative Decoding in vLLM](https://aws.amazon.com/blogs/machine-learning/p-eagle-faster-llm-inference-with-parallel-speculative-decoding-in-vllm/) -- vLLM v0.16+ integration
- [Speculative Decoding: 2-3x Faster Inference](https://blog.premai.io/speculative-decoding-2-3x-faster-llm-inference-2026/) -- Production deployment guide
- [vLLM Documentation](https://docs.vllm.ai/en/latest/) -- Official docs
