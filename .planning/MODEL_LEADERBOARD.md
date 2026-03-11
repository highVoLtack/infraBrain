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

### Qwen 2.5 Coder 32B
- **Strengths**: Structured output, shell command precision, JSON parsing, concise reasoning
- **Weaknesses**: Can hallucinate container names without discovery context (fixed by Step 0)
- **VRAM**: ~18-20 GB (Q4_K_M), fits natively in 32GB with 32k context
- **Best for**: IT-Ops diagnostics, CLI/infrastructure tasks, structured fix plans

### Models to Benchmark (Phase 6+)
- **Llama 3.3 70B**: General reasoning, complex multi-system correlation (requires 2x GPU or API)
- **DeepSeek-R1 32B**: Deep reasoning chains for complex root cause analysis
- **Codestral 22B**: Code generation, config file analysis (smaller, faster)
- **Qwen 2.5 72B**: Networking specialist candidate (requires JIT provisioning)

---
*Created: 2026-03-11 — First entry from Phase 5 Nginx 502 POC*
