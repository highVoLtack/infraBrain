# Model Leaderboard

InfraBrain's Domain-Expertise routing engine. Routes tasks to the optimal model based on domain fit, not model size.

**Core principle**: IT-Ops is a domain of structured syntax — CLI commands, log formats, config files, JSON APIs. A 32B code specialist running at full GPU speed with maximum context density outperforms a 70B generalist that requires CPU offloading and sacrifices inference speed. InfraBrain routes by **domain expertise**, not parameter count.

## Scoring

| Grade | Meaning |
|-------|---------|
| A+ | Perfect: correct diagnosis, zero hallucination, surgical fix, fast |
| A | Correct diagnosis and fix, minor verbosity or formatting issues |
| B | Correct diagnosis, fix plan needed manual adjustment |
| C | Partial diagnosis, significant manual intervention needed |
| F | Wrong diagnosis or hallucinated commands |

## Results

| # | Scenario | Model | Hardware | Context | Result | Grade | Notes |
|---|----------|-------|----------|---------|--------|-------|-------|
| 1 | Nginx 502 Bad Gateway (Docker Network Isolation) | Qwen 2.5 Coder 32B (`infrabrain:latest`) | 1x RTX 5090 (32GB) | 32k + TOON | Correct diagnosis: network isolation. Fix: `docker network connect`. Verified: HTTP 200. | A+ | Zero hallucination with discovery step. TOON-encoded Docker network JSON. Full DPEV loop completed autonomously. |

## Model Notes

## Strategic Hierarchy

```
┌─────────────────────────────────────────────────────────────┐
│  TASK INTAKE                                                 │
│                                                              │
│  Is this CLI, Docker, Nginx, logs, configs, structured I/O? │
│  ├─ YES ──► Technical Lead (Qwen 32B)         [DEFAULT]     │
│  │          Full GPU speed, max context density              │
│  │                                                           │
│  │  Root cause hidden in complex logic?                      │
│  │  ├─ YES ──► Forensic Specialist (DeepSeek-R1)            │
│  │  │          Deep chain-of-thought, self-reflection        │
│  │                                                           │
│  └─ NO ───► Strategic Fallback (Llama 3.3 70B)              │
│             Broad cross-domain, non-technical reasoning      │
└─────────────────────────────────────────────────────────────┘
```

The Intelligence Catalog routes by **domain expertise**:
- **Structured syntax domains** (CLI, logs, configs, Docker, networking) → Technical Lead
- **Hidden causality** (multi-step deduction, buried root causes, timing-dependent bugs) → Forensic Specialist
- **Broad reasoning** (cross-domain correlation, non-technical context, vendor-agnostic knowledge) → Strategic Fallback

## Model Notes

### Qwen 2.5 Coder 32B (`infrabrain`) — Technical Lead & Execution Specialist
- **Role**: Primary orchestrator for the entire DPEV loop. Default model for all IT-Ops tasks
- **Why primary**: IT-Ops is a domain of structured syntax — CLI commands, log formats, config files, JSON APIs. This is exactly where code-specialized models dominate. The 32B size is a deliberate choice: fits natively in RTX 5090 VRAM (no CPU offloading), enabling full inference speed and maximum 32k context density with TOON encoding (~50k+ effective tokens)
- **Strengths**: Structured output, shell command precision, JSON parsing, concise reasoning, config file understanding
- **Weaknesses**: Can hallucinate container names without discovery context (fixed by Iterative Discovery / Step 0)
- **VRAM**: ~18-20 GB (Q4_K_M) + ~8-10 GB KV cache = ~28-30 GB total. Fits natively in 32GB
- **Best for**: All CLI, Docker, Nginx, networking, log analysis, config debugging, fix plan generation

### DeepSeek-R1 32B — Forensic Specialist
- **Role**: Deep chain-of-thought debugging when the root cause is hidden in complex logic
- **When activated**: Technical Lead diagnosis is inconclusive, or the problem involves multi-step causal chains, timing-dependent failures, or cross-component interactions that require extended reasoning
- **Strengths**: Extended chain-of-thought with self-reflection, complex multi-step deduction, ability to reason about what it doesn't know
- **VRAM**: ~18-20 GB, loaded via model swap when Technical Lead escalates
- **Best for**: Hidden root causes, race conditions, complex dependency chains, edge cases where structured diagnosis fails

### Llama 3.3 70B — Strategic Fallback
- **Role**: Broad cross-domain knowledge when the problem exceeds technical syntax domains
- **When activated**: Problem requires non-technical reasoning, vendor-agnostic architectural knowledge, or cross-domain correlation that the Technical Lead's code-specialized training doesn't cover
- **Strengths**: Broad knowledge base, strong natural language reasoning, large training corpus spanning non-technical domains
- **VRAM**: Requires CPU offloading on single 32GB GPU (slower inference) or JIT cloud provisioning
- **Best for**: Cross-domain correlation, architectural decisions, vendor documentation interpretation, problems where broad knowledge outweighs structured precision

### Qwen 2.5 Coder 7B — Lightweight Worker
- **Config role**: `worker`
- **Strengths**: Fast inference, low resource usage, good code understanding for its size
- **VRAM**: ~4-5 GB, can run in parallel with primary model
- **Best for**: Parallel sub-agent tasks, simple command generation, quick verification checks

### Llama 3.2 Vision — Visual Specialist
- **Config role**: `vision`
- **Strengths**: Multimodal input, image understanding, diagram interpretation
- **Best for**: Future screenshot analysis, network topology diagrams, monitoring dashboard interpretation

### BGE-M3 — Knowledge/RAG Engine
- **Config role**: N/A (embedding API, not chat API — handled by Phase 6 `KnowledgeProvider`)
- **Strengths**: 1024-dim embeddings, 8192 token context, multilingual, hybrid dense+sparse
- **VRAM**: ~1 GB (float16), ~0.6 GB quantized
- **Best for**: Document ingestion, semantic search, knowledge base indexing
- **Note**: Pre-loaded on persistent volume but not part of the chat `ModelRegistry`. Will be consumed by a dedicated `KnowledgeProvider` in Phase 6 (RAG pipeline) using the Ollama embedding API

## Intelligence Inventory (Provisioned)

All models pre-loaded on a **200GB Persistent Network Volume** in **EU-RO-1 (Romania)**. Zero-download startup guaranteed. Storage path: `/workspace/models` (`OLLAMA_MODELS=/workspace/models`).

| # | Config Role | Model | Size | Purpose | Status |
|---|-------------|-------|------|---------|--------|
| 1 | `default` | `infrabrain` (Qwen 2.5 Coder 32B) | 32B | Technical Lead — core DPEV loop, all structured syntax tasks | Ready |
| 2 | `forensic` | `deepseek-r1:32b` | 32B | Forensic Specialist — deep chain-of-thought debugging | Ready |
| 3 | `strategic` | `llama3.3:70b` | 70B | Strategic Fallback — broad cross-domain reasoning | Ready |
| 4 | `worker` | `qwen2.5-coder:7b` | 7B | Lightweight Worker — fast parallel sub-agent tasks | Ready |
| 5 | `vision` | `llama3.2-vision` | 11B | Visual Specialist — screenshot/diagram analysis | Ready |
| 6 | *(Phase 6)* | `bge-m3` | 568M | RAG Engine — embedding API, not chat (KnowledgeProvider) | Ready |

### Deployment Notes

- **Persistence**: Models survive pod terminations via RunPod Network Volume (EU-RO-1, 200GB)
- **Routing principle**: `IntelligenceCatalog` routes by **domain expertise**, not model size. Structured syntax → Technical Lead, hidden causality → Forensic Specialist, broad reasoning → Strategic Fallback
- **VRAM efficiency**: Using the 32B Technical Lead as primary driver is deliberate — full GPU speed + maximum context density on RTX 5090 while maintaining superior technical accuracy over larger generalist models
- **Escalation path**: `qwen2.5-coder:7b` (parallel workers) → `infrabrain` (Technical Lead, default) → `deepseek-r1:32b` (forensic escalation) → `llama3.3:70b` (strategic fallback)
- **RAG pipeline**: `bge-m3` handles embedding; inference models handle retrieval-augmented generation
- **Vision pipeline**: `llama3.2-vision` reserved for future screenshot/diagram analysis features

### Models to Benchmark (Phase 6+)
- **Codestral 22B**: Code generation, config file analysis (smaller, faster)
- **Qwen 2.5 72B**: Networking specialist candidate (requires JIT provisioning)

---
*Created: 2026-03-11 — First entry from Phase 5 Nginx 502 POC*
*Updated: 2026-03-11 — Full 5-role chat registry (default/strategic/forensic/worker/vision) + bge-m3 reserved for Phase 6 KnowledgeProvider*
