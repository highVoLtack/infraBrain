# Requirements: InfraBrain v1.3

**Defined:** 2026-04-10
**Core Value:** The AI diagnoses, plans, and fixes infrastructure problems autonomously while the human admin retains full control -- every critical action requires approval, every decision is auditable, and the system can be taught any IT system through simple Markdown files.

## v1.3 Requirements

Requirements for v1.3 The Intelligence Layer. Each maps to roadmap phases.

### Terminal UI (Ink/React)

- [ ] **TERM-01**: Admin sees live DPEV phase tracking during diagnosis (which phase, which model, elapsed time)
- [ ] **TERM-02**: Admin sees streaming LLM output in real-time (not buffered until complete)
- [ ] **TERM-03**: Approval prompts work as Ink React components with `useInput` (replacing readline)
- [ ] **TERM-04**: Admin sees rich status dashboard with panels (active sessions, backend health, recent incidents)
- [ ] **TERM-05**: Terminal output adapts to terminal width (no hardcoded column widths)
- [ ] **TERM-06**: Admin sees step-by-step execution progress with per-step status icons
- [ ] **TERM-07**: Express REST API serves SSE endpoints for live streaming to Ink renderer
- [ ] **TERM-08**: All existing CLI commands work through Ink renderer (backwards compatible)

### Parallel Execution

- [x] **EXEC-01**: Discovery commands run in parallel via `Promise.all()` (2-5x speedup)
- [x] **EXEC-02**: Per-container mutex (`Map<string, PQueue>`) prevents concurrent docker exec on same container
- [x] **EXEC-03**: Execution steps remain serial with existing safety gates (circuit breaker, damage budget)
- [x] **EXEC-04**: Parallel discovery results merge into single discovery context for LLM

### Context Management (Auto-Compact)

- [x] **CTXT-01**: Token counting via `@lenml/tokenizer-qwen3` tracks context window usage in real-time
- [x] **CTXT-02**: Auto-compact triggers at 83% context window threshold
- [x] **CTXT-03**: Ground truth pinning (`is_pinned: true`) protects critical data from compaction (container names, ports, error codes, discovery facts)
- [x] **CTXT-04**: Observation masking removes stale/redundant observations before LLM summarization
- [x] **CTXT-05**: Regex pre-processor filters known noise patterns (healthcheck spam, systemd journal noise) before context injection
- [x] **CTXT-06**: 9B worker model pre-filters unknown log formats for relevance scoring

### Fix-Caching (LanceDB Embedded)

- [x] **CACHE-01**: LanceDB embedded vector store initializes automatically in-process with auto-table management (no external service or Docker required)
- [x] **CACHE-02**: Error signature + discovery context embedded via BGE-M3 into LanceDB table
- [x] **CACHE-03**: Before LLM diagnosis, similarity search checks for cached fix (threshold > 0.85)
- [x] **CACHE-04**: Cached fix returned in <2s vs 113s for LLM reasoning (zero LLM calls for cache hits)
- [x] **CACHE-05**: Cache invalidation on skill file updates (stale fixes purged)
- [x] **CACHE-06**: Confidence scoring on cached fixes (recency + success rate + similarity score)
- [x] **CACHE-07**: Graceful degradation -- InfraBrain works without LanceDB (cache is optimization, not requirement)
- [ ] **CACHE-08**: Cache hit explainability -- Ink terminal shows provenance indicator when using cached fix ("Based on incident #42 (2026-03-12) -- Cache Hit")

### Semantic Memory (MemPalace Native TypeScript)

- [ ] **MEM-01**: Incident auto-filing after every completed DPEV cycle (diagnosis + fix steps + verification + outcome)
- [ ] **MEM-02**: Cross-session semantic search over all past incidents via Qdrant
- [ ] **MEM-03**: Temporal Knowledge Graph in Qdrant payload metadata (entity, relationship, valid_from, valid_to)
- [ ] **MEM-04**: 4-layer wake-up context: L0 identity (~100 tokens) + L1 recent incidents (~500 tokens) + L2 filtered search + L3 deep semantic
- [ ] **MEM-05**: Memory skill (`skills/memory.md`) routes "what did we decide" / "when did this happen" queries
- [ ] **MEM-06**: Infrastructure entity detection from diagnostic text (hostnames, service names, container IDs, IPs)
- [ ] **MEM-07**: Temporal decay weighting -- recent incidents score higher than old ones at equal similarity
- [ ] **MEM-08**: Wings/Rooms organizational hierarchy: wing_incidents, wing_config, wing_runbooks, wing_user
- [ ] **MEM-09**: Write-ahead log for all memory mutations (audit trail for memory changes)

### Parallel Inference

- [ ] **INFER-01**: Concurrent model calls to different vLLM backends via `Promise.allSettled()`
- [ ] **INFER-02**: Pipeline stages: 9B intent classification (<200ms) -> 122B deep reasoning
- [ ] **INFER-03**: 9B pre-processes logs and extracts error patterns while 122B reasons about diagnosis
- [ ] **INFER-04**: Separate vLLM instances per model size (no VRAM contention on single GPU)
- [ ] **INFER-05**: Fallback to sequential inference when only single backend available

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Advanced Memory

- **MEM-A01**: GraphRAG traversal across entity relationships (multi-hop queries)
- **MEM-A02**: Memory consolidation ("dream" background agent that merges similar incidents)
- **MEM-A03**: LoRA domain Expert Packs generated from memory patterns

### Advanced UI

- **TERM-A01**: Web UI layer on top of REST API (browser-based dashboard)
- **TERM-A02**: Mobile push notifications for critical incidents

### Advanced Inference

- **INFER-A01**: Speculative decoding (P-EAGLE) for 2-3x inference speedup
- **INFER-A02**: Model benchmarking framework per role (quality + latency scoring)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Python sidecar for MemPalace | Adds runtime dependency, IPC overhead, breaks air-gap simplicity -- native TypeScript instead |
| ChromaDB | Qdrant is single vector store for both fix-caching and semantic memory |
| Neo4j / GraphRAG | Overkill for v1.3 -- SQLite-in-Qdrant-payload handles temporal KG |
| Cloud-hosted Qdrant | 100% local, air-gapped -- Docker container only |
| AAAK Dialect (MemPalace) | Lossy compression destroys infra diagnostic signal (error messages, configs) |
| Real-time collaborative UI | Single-admin CLI tool for v1.3 |
| OAuth/multi-tenant | Single-instance, single-team for v1.3 |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| EXEC-01 | Phase 14 | Complete |
| EXEC-02 | Phase 14 | Complete |
| EXEC-03 | Phase 14 | Complete |
| EXEC-04 | Phase 14 | Complete |
| CTXT-01 | Phase 15 | Complete |
| CTXT-02 | Phase 15 | Complete |
| CTXT-03 | Phase 15 | Complete |
| CTXT-04 | Phase 15 | Complete |
| CTXT-05 | Phase 15 | Complete |
| CTXT-06 | Phase 15 | Complete |
| CACHE-01 | Phase 16 | Complete |
| CACHE-02 | Phase 16 | Complete |
| CACHE-03 | Phase 16 | Complete |
| CACHE-04 | Phase 16 | Complete |
| CACHE-05 | Phase 16 | Complete |
| CACHE-06 | Phase 16 | Complete |
| CACHE-07 | Phase 16 | Complete |
| CACHE-08 | Phase 16 | Pending |
| MEM-01 | Phase 17 | Pending |
| MEM-02 | Phase 17 | Pending |
| MEM-03 | Phase 17 | Pending |
| MEM-04 | Phase 17 | Pending |
| MEM-05 | Phase 17 | Pending |
| MEM-06 | Phase 17 | Pending |
| MEM-07 | Phase 17 | Pending |
| MEM-08 | Phase 17 | Pending |
| MEM-09 | Phase 17 | Pending |
| INFER-01 | Phase 18 | Pending |
| INFER-02 | Phase 18 | Pending |
| INFER-03 | Phase 18 | Pending |
| INFER-04 | Phase 18 | Pending |
| INFER-05 | Phase 18 | Pending |
| TERM-01 | Phase 19 | Pending |
| TERM-02 | Phase 19 | Pending |
| TERM-03 | Phase 19 | Pending |
| TERM-04 | Phase 19 | Pending |
| TERM-05 | Phase 19 | Pending |
| TERM-06 | Phase 19 | Pending |
| TERM-07 | Phase 19 | Pending |
| TERM-08 | Phase 19 | Pending |

**Coverage:**
- v1.3 requirements: 40 total
- Mapped to phases: 40
- Unmapped: 0

---
*Requirements defined: 2026-04-10*
*Last updated: 2026-03-31 -- All 40 requirements mapped to phases 14-19*
