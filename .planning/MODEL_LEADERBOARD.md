# Model Leaderboard

InfraBrain's Model-to-Problem matching engine. Tracks which models perform best for specific infrastructure scenarios.

The goal: match the right model to the right problem. A specialist 32B model at full GPU speed beats a generalist 70B with CPU offloading.

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

### Qwen 2.5 Coder 32B (`infrabrain`)
- **Role**: Primary orchestrator
- **Strengths**: Structured output, shell command precision, JSON parsing, concise reasoning
- **Weaknesses**: Can hallucinate container names without discovery context (fixed by Step 0)
- **VRAM**: ~18-20 GB (Q4_K_M), fits natively in 32GB with 32k context
- **Best for**: IT-Ops diagnostics, CLI/infrastructure tasks, structured fix plans

### DeepSeek-R1 32B
- **Role**: Reasoning hammer
- **Strengths**: Extended chain-of-thought, complex multi-step deduction, self-reflection
- **VRAM**: ~18-20 GB, fits alongside orchestrator via model swapping
- **Best for**: Complex root cause analysis, multi-system correlation, edge cases where standard diagnosis fails

### Llama 3.3 70B
- **Role**: Generalist heavyweight
- **Strengths**: Broad knowledge base, strong natural language reasoning, large training corpus
- **VRAM**: Requires CPU offloading on single 32GB GPU (or JIT cloud provisioning)
- **Best for**: Complex multi-domain problems, broad infrastructure knowledge, fallback when specialists lack domain coverage

### BGE-M3
- **Role**: Knowledge/RAG engine
- **Strengths**: 1024-dim embeddings, 8192 token context, multilingual, hybrid dense+sparse
- **VRAM**: ~1 GB (float16), ~0.6 GB quantized
- **Best for**: Document ingestion, semantic search, knowledge base indexing

### Llama 3.2 Vision
- **Role**: Visual specialist
- **Strengths**: Multimodal input, image understanding, diagram interpretation
- **Best for**: Future screenshot analysis, network topology diagrams, monitoring dashboard interpretation

### Qwen 2.5 Coder 7B
- **Role**: Lightweight worker
- **Strengths**: Fast inference, low resource usage, good code understanding for its size
- **VRAM**: ~4-5 GB, can run in parallel with primary model
- **Best for**: Parallel sub-agent tasks, simple command generation, quick verification checks

## Intelligence Inventory (Provisioned)

All models pre-loaded on a **200GB Persistent Network Volume** in **EU-RO-1 (Romania)**. Zero-download startup guaranteed. Storage path: `/workspace/models` (`OLLAMA_MODELS=/workspace/models`).

| # | Role | Model | Size Class | Purpose | Status |
|---|------|-------|------------|---------|--------|
| 1 | Orchestrator (Primary) | `infrabrain` (Qwen 2.5 Coder 32B custom) | 32B | Core DPEV loop, 32k context, temp 0.1 | Ready |
| 2 | Reasoning Hammer | `deepseek-r1:32b` | 32B | Complex logic, chain-of-thought debugging | Ready |
| 3 | Generalist Heavyweight | `llama3.3:70b` | 70B | Broad infrastructure knowledge, multi-system correlation | Ready |
| 4 | Knowledge/RAG Engine | `bge-m3` | 568M | Embedding model for local vector DB ingestion | Ready |
| 5 | Visual Specialist | `llama3.2-vision` | 11B | Screenshot analysis, network diagram interpretation | Ready |
| 6 | Lightweight Worker | `qwen2.5-coder:7b` | 7B | Fast sub-agent tasks, low-resource parallel execution | Ready |

### Deployment Notes

- **Persistence**: Models survive pod terminations via RunPod Network Volume (EU-RO-1, 200GB)
- **Model routing**: `IntelligenceCatalog` (Phase 6+) will map `{domain, complexity}` to optimal model from this inventory
- **Escalation tiers**: `qwen2.5-coder:7b` (fast/cheap) → `infrabrain` (balanced) → `deepseek-r1:32b` (deep reasoning) → `llama3.3:70b` (heavyweight)
- **RAG pipeline**: `bge-m3` handles embedding; inference models handle retrieval-augmented generation
- **Vision pipeline**: `llama3.2-vision` reserved for future screenshot/diagram analysis features

### Models to Benchmark (Phase 6+)
- **Codestral 22B**: Code generation, config file analysis (smaller, faster)
- **Qwen 2.5 72B**: Networking specialist candidate (requires JIT provisioning)

---
*Created: 2026-03-11 — First entry from Phase 5 Nginx 502 POC*
*Updated: 2026-03-11 — Intelligence Inventory provisioned on EU-RO-1 persistent volume*
