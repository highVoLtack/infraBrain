# Requirements: InfraBrain v1.3

**Defined:** 2026-04-10
**Core Value:** The AI diagnoses, plans, and fixes infrastructure problems autonomously while the human admin retains full control -- every critical action requires approval, every decision is auditable, and the system can be taught any IT system through simple Markdown files.

## v1.3 Requirements

Requirements for v1.3 The Intelligence Layer. Each maps to roadmap phases.

### Terminal UI (Ink/React)

- [x] **TERM-01**: Admin sees live DPEV phase tracking during diagnosis (which phase, which model, elapsed time)
- [x] **TERM-02**: Admin sees streaming LLM output in real-time (not buffered until complete)
- [x] **TERM-03**: Approval prompts work as Ink React components with `useInput` (replacing readline)
- [x] **TERM-04**: Admin sees rich status dashboard with panels (active sessions, backend health, recent incidents)
- [x] **TERM-05**: Terminal output adapts to terminal width (no hardcoded column widths)
- [x] **TERM-06**: Admin sees step-by-step execution progress with per-step status icons
- [x] **TERM-07**: Express REST API serves SSE endpoints for live streaming to Ink renderer
- [x] **TERM-08**: All existing CLI commands work through Ink renderer (backwards compatible)

### Terminal UI Polish (Phase 19.1)

- [x] **TERM-P01**: SSE streaming sessions persist target name (prompt) and DPEV events to session store, appear in Sessions panel on restart
- [x] **TERM-P02**: Session replay loads full DPEV phase timeline (Discovery, Diagnosis, Plan with models and timing) from persisted audit events
- [x] **TERM-P03**: Entity panel renders entities from completed execute cycles (extracted from MemPalace entity store, grouped by provider)
- [x] **TERM-P04**: Session items show prompt excerpt and outcome (completed/failed/in-progress) instead of "unknown [-]"

### End-to-End Debug Flow (Phase 19.2)

- [ ] **TERM-E01**: Discovery phase shows spinner/progress indicator in DPEV panel while commands run
- [x] **TERM-E02**: After diagnosis+plan, Ink UI shows structured approval prompt (numbered steps with risk badges, Y/N input)
- [ ] **TERM-E03**: On approval, SSE streams execution step progress (command, running/success/failed status, stdout/stderr per step)
- [ ] **TERM-E04**: After execution, verification step result renders in panel (fix worked / still failing)
- [x] **TERM-E05**: Plan rendering shows structured steps (numbered list with risk badges) not raw Markdown text
- [ ] **TERM-E06**: Session status updates to completed/failed based on actual execution outcome (not just "diagnosis done")

### DPEV Panel Observability (Phase 19.3)

- [ ] **TERM-UX01**: Diagnosis + plan narrative render with terminal-styled headings, code blocks, inline code, bold/italic, lists (not raw `##` / triple-backtick / `**` chars). Single `MarkdownView` component shared across DPEVPanel + replay.
- [x] **TERM-UX02**: Every executed step shows the actual command string, exit code, and stdout preview (first N lines, configurable). Stderr shown when exit ≠ 0. No more `[1/0] ✓ []` with empty brackets.
- [x] **TERM-UX03**: Active phases show a live spinner + sub-status label (e.g. "Calling gemini-2.5-pro", "Parsing response") from second zero. Phase elapsed-time counter ticks visibly every second with Cyan (LLM) / Yellow (Execution) / dim (complete) coloring.
- [x] **TERM-UX04**: Keyboard navigation (↑/↓ + j/k + Enter / Esc) moves a selection cursor through phase headers. Enter on a completed phase expands its full stream; Esc collapses. The DIAGNOSIS Markdown text stays accessible after PLAN begins.
- [x] **TERM-UX05**: `s` / Esc dashboard shows non-zero values after ≥1 session: Cache hit-rate, total entries, memory incident count, context-window % of the live session, latest call usage. Polls every 2-3s while overlay open.
- [x] **TERM-UX06**: Each completed phase shows `in: X · out: Y · total: Z · $W · Ns` under its header. When the backend reports undefined (Gemini stream), show `–` instead of "undefined". Session footer shows cumulative tokens + cost with `Saved via Memory: $0.00 (v2.0)` placeholder.
- [ ] **TERM-UX07**: Panels use key-stable Ink components; no artefact lines remain from prior renders during live SSE streaming.
- [ ] **TERM-UX08**: Selecting an older session from the Sessions list shows the complete D→P→E→V stream including every step's command + output, not just the phase headers. Initial state = all phases collapsed.

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
- [x] **CACHE-08**: Cache hit explainability -- Ink terminal shows provenance indicator when using cached fix ("Based on incident #42 (2026-03-12) -- Cache Hit")

### Semantic Memory (MemPalace Native TypeScript)

- [x] **MEM-01**: Incident auto-filing after every completed DPEV cycle (diagnosis + fix steps + verification + outcome)
- [x] **MEM-02**: Cross-session semantic search over all past incidents via Qdrant
- [x] **MEM-03**: Temporal Knowledge Graph in Qdrant payload metadata (entity, relationship, valid_from, valid_to)
- [x] **MEM-04**: 4-layer wake-up context: L0 identity (~100 tokens) + L1 recent incidents (~500 tokens) + L2 filtered search + L3 deep semantic
- [x] **MEM-05**: Memory skill (`skills/memory.md`) routes "what did we decide" / "when did this happen" queries
- [x] **MEM-06**: Infrastructure entity detection from diagnostic text (hostnames, service names, container IDs, IPs)
- [x] **MEM-07**: Temporal decay weighting -- recent incidents score higher than old ones at equal similarity
- [x] **MEM-08**: Wings/Rooms organizational hierarchy: wing_incidents, wing_config, wing_runbooks, wing_user
- [x] **MEM-09**: Write-ahead log for all memory mutations (audit trail for memory changes)

### Parallel Inference

- [x] **INFER-01**: Concurrent model calls to different vLLM backends via `Promise.allSettled()`
- [x] **INFER-02**: Pipeline stages: 9B intent classification (<200ms) -> 122B deep reasoning
- [x] **INFER-03**: 9B pre-processes logs and extracts error patterns while 122B reasons about diagnosis
- [x] **INFER-04**: Separate vLLM instances per model size (no VRAM contention on single GPU)
- [x] **INFER-05**: Fallback to sequential inference when only single backend available

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
| CACHE-08 | Phase 16 | Complete |
| MEM-01 | Phase 17 | Complete |
| MEM-02 | Phase 17 | Complete |
| MEM-03 | Phase 17 | Complete |
| MEM-04 | Phase 17 | Complete |
| MEM-05 | Phase 17 | Complete |
| MEM-06 | Phase 17 | Complete |
| MEM-07 | Phase 17 | Complete |
| MEM-08 | Phase 17 | Complete |
| MEM-09 | Phase 17 | Complete |
| INFER-01 | Phase 18 | Complete |
| INFER-02 | Phase 18 | Complete |
| INFER-03 | Phase 18 | Complete |
| INFER-04 | Phase 18 | Complete |
| INFER-05 | Phase 18 | Complete |
| TERM-01 | Phase 19 | Complete |
| TERM-02 | Phase 19 | Complete |
| TERM-03 | Phase 19 | Complete |
| TERM-04 | Phase 19 | Complete |
| TERM-05 | Phase 19 | Complete |
| TERM-06 | Phase 19 | Complete |
| TERM-07 | Phase 19 | Complete |
| TERM-08 | Phase 19 | Complete |
| TERM-P01 | Phase 19.1 | Complete |
| TERM-P02 | Phase 19.1 | Complete |
| TERM-P03 | Phase 19.1 | Complete |
| TERM-P04 | Phase 19.1 | Complete |
| TERM-E01 | Phase 19.2 | Planned |
| TERM-E02 | Phase 19.2 | Complete |
| TERM-E03 | Phase 19.2 | Planned |
| TERM-E04 | Phase 19.2 | Planned |
| TERM-E05 | Phase 19.2 | Complete |
| TERM-E06 | Phase 19.2 | Planned |
| TERM-UX01 | Phase 19.3 | Planned |
| TERM-UX02 | Phase 19.3 | Planned |
| TERM-UX03 | Phase 19.3 | Planned |
| TERM-UX04 | Phase 19.3 | Planned |
| TERM-UX05 | Phase 19.3 | Planned |
| TERM-UX06 | Phase 19.3 | Planned |
| TERM-UX07 | Phase 19.3 | Planned |
| TERM-UX08 | Phase 19.3 | Planned |

**Coverage:**

- v1.3 requirements: 40 total (complete)
- v1.3 polish: 4 total (Phase 19.1 complete)
- v1.3 E2E flow: 6 total (Phase 19.2 planned)
- v1.3 UX observability: 8 total (Phase 19.3 planned)
- Mapped to phases: 58

---
*Requirements defined: 2026-04-10*
*Last updated: 2026-03-31 -- All 40 requirements mapped to phases 14-19*
