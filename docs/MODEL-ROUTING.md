# Model Routing Guide

InfraBrain uses a 7-role model routing system that assigns different LLM models to different tasks based on their requirements. Each role has a specific purpose, latency target, and minimum model size recommendation.

## Role Definitions

| Role | Purpose | Latency Target | Minimum Size | Recommended |
|------|---------|---------------|--------------|-------------|
| triage | Skill selection and classification | <3s | 7B | qwen2.5:7b or similar fast classifier |
| default | General diagnosis, first-pass analysis | <15s | 32B | qwen3.5:32b-a22b (MoE sweet spot) |
| strategic | Fix planning, command generation, self-heal corrections | <30s | 70B | llama3.3:70b or qwen3.5:72b-a22b |
| forensic | Complex multi-step failure analysis, deep reasoning | <60s | 70B+ (CoT) | deepseek-r1:32b or qwen3.5:72b-a22b |
| worker | Self-heal corrections (first tier before escalation) | <10s | 32B+ | qwen2.5-coder:32b (NOT 7B) |
| vision | Screenshot and visual evidence analysis | <30s | Vision model | llama3.2-vision |
| embedding | Semantic search (future Qdrant integration) | <1s | Embedding model | bge-m3 |

### Why Worker Needs 32B+

The worker role handles self-healing corrections where the LLM must reason about state changes (e.g., "user already exists" means ALTER not CREATE, "permission denied" means add `-u 0`). During the multi-fault demo, GLM-4.7-Flash (9B) failed to reason about state transitions, generating the same failing command repeatedly. Models below 32B lack the reasoning depth for stateful correction.

## Evidence from Multi-Fault Demo (2026-03-15)

The multi-fault demo validated 5/5 faults across 3 debug-execute cycles. Key observations:

| Observation | Impact | Recommendation |
|-------------|--------|----------------|
| Triage with 122B model | 13s per skill selection (target <3s) | Use 7B for triage -- simple classification does not need reasoning |
| GLM-4.7-Flash (9B) as worker | Failed state reasoning ("already exists -> ALTER") | Minimum 32B for worker role |
| 122B for diagnosis + planning | 42s total via SSH tunnel -- good quality | Acceptable for strategic/forensic roles |
| Sanity checker false positive | 47s per retry on legitimate Docker output | Eliminated in Phase 13 via Docker tag whitelist |
| SSH tunnel vs Cloudflare proxy | Eliminated 100s timeout, diagnosis 300s+ -> 42s | SSH tunnel mandatory for large models |
| Ollama model swapping | 60s+ per switch, 1 model in VRAM at a time | Multi-GPU or single-model setup recommended |

### Latency Breakdown (SSH Tunnel, 122B Model)

- Triage (skill selection): 13s (too slow -- should be <3s with 7B)
- Discovery (ground truth): 2-5s (Docker commands, not LLM)
- Diagnosis (structured object): 25-35s
- Planning (fix plan generation): 15-20s
- Self-heal correction (per attempt): 10-15s

## Per-Role Backend Routing

InfraBrain supports routing each role to a different backend server via per-role `baseUrl` configuration. This enables hybrid deployments where fast models run on vLLM while heavy models run on Ollama.

### Config Format

The `modelMap` accepts two entry formats:

| Format | Syntax | Backend |
|--------|--------|---------|
| **String** (legacy) | `"triage": "qwen3.5:9b"` | Uses `defaultBaseUrl` |
| **Object** (per-role) | `"triage": { "model": "qwen3.5:9b", "baseUrl": "http://localhost:8000/v1" }` | Uses own `baseUrl` |

Both formats can be mixed freely within the same `modelMap`.

### defaultBaseUrl

The `defaultBaseUrl` field replaces the legacy `ollamaBaseUrl` field. Existing configs using `ollamaBaseUrl` are automatically migrated at startup (no manual change required).

- String-format modelMap entries resolve against `defaultBaseUrl`
- Object-format entries use their own `baseUrl`, ignoring `defaultBaseUrl`
- Default value: `http://localhost:11434/v1` (local Ollama with OpenAI-compatible endpoint)
- The `/v1` suffix is required -- both Ollama and vLLM serve OpenAI-compatible APIs at this path

### Hybrid Deployment Example

vLLM serves the fast triage model on port 8000, Ollama handles everything else on port 11434:

```json
{
  "defaultBaseUrl": "http://localhost:11434/v1",
  "modelMap": {
    "triage": { "model": "qwen3.5:9b", "baseUrl": "http://localhost:8000/v1" },
    "default": "qwen3.5:35b-a3b",
    "strategic": "qwen3.5:122b-a10b",
    "forensic": "qwen3.5:35b-a3b",
    "worker": "qwen3.5:9b",
    "vision": "qwen3.5:122b-a10b",
    "embedding": "bge-m3"
  }
}
```

In this config:
- `triage` routes to vLLM at `localhost:8000` (sub-3s latency for skill selection)
- All other roles route to Ollama at `localhost:11434` via `defaultBaseUrl`
- The health endpoint (`/health`) probes both backends and reports their status independently

### Full vLLM Deployment

When multiple GPUs are available, all roles can point to dedicated vLLM instances:

```json
{
  "defaultBaseUrl": "http://localhost:8000/v1",
  "modelMap": {
    "triage": { "model": "qwen3.5:9b", "baseUrl": "http://localhost:8000/v1" },
    "default": { "model": "qwen3.5:35b-a3b", "baseUrl": "http://localhost:8001/v1" },
    "strategic": { "model": "qwen3.5:122b-a10b", "baseUrl": "http://localhost:8002/v1" },
    "forensic": { "model": "qwen3.5:35b-a3b", "baseUrl": "http://localhost:8001/v1" },
    "worker": { "model": "qwen3.5:9b", "baseUrl": "http://localhost:8000/v1" },
    "vision": { "model": "qwen3.5:122b-a10b", "baseUrl": "http://localhost:8002/v1" },
    "embedding": { "model": "bge-m3", "baseUrl": "http://localhost:8003/v1" }
  }
}
```

## Configuration

Model assignments are configured in `.infrabrain/config.json` under the `modelMap` section. See `config.example.json` in the project root for a complete reference with all three config formats (legacy, hybrid, full vLLM).

Skills declare their preferred role via `preferred_model` in YAML frontmatter:

```yaml
preferred_model: strategic  # Routes to modelMap.strategic
```

The routing system resolves the role to the configured model at runtime. If the role maps to the same model as default, a warning is logged but execution continues.

## Single-Model Setup

When `modelMap` is not configured (or all roles point to the same model), InfraBrain routes every request to the default model. This works but sub-optimally:

- Triage is slow (large model doing simple classification)
- Worker corrections may time out waiting for a large model
- No parallelism possible (single model in VRAM)

For production use, multi-GPU enables role-specific model assignment where a fast 7B handles triage while a 70B+ handles strategic planning. See `docs/VLLM-SETUP.md` for vLLM deployment instructions.

## Escalation Path

When self-healing exhausts its attempts at one model tier, the system escalates to more capable models:

```
worker (qwen2.5-coder:32b)
  |
  | max attempts exhausted
  v
strategic (llama3.3:70b)
  |
  | max attempts exhausted
  v
forensic (deepseek-r1:32b or 72b-a22b)
```

The escalation logic in `self-healer.ts`:

1. **First attempt**: Worker model generates correction from stderr + step context
2. **On failure**: Worker retries up to `maxAttempts` (default 5, with bonus attempts for forward progress)
3. **Exhaustion**: API response includes `escalationAdvice` with the next model tier
4. **Client retry**: The client can re-submit with the escalated model role

Forward progress detection: If the error type changes between attempts (e.g., "permission denied" becomes "file not found"), the system recognizes this as forward progress and grants bonus attempts rather than escalating prematurely.

### Escalation Advice in API Response

When self-healing exhausts attempts, the response includes:

```json
{
  "escalationAdvice": {
    "currentModel": "worker",
    "suggestedModel": "strategic",
    "reason": "Worker model exhausted 5 attempts without resolving the issue",
    "failedStep": { "command": "...", "error": "..." }
  }
}
```

The client (CLI or API consumer) can then re-submit the fix plan with the suggested model role for another round of self-healing with a more capable model.
