# vLLM Setup Guide

This guide covers deploying InfraBrain with vLLM for fast multi-model serving, either standalone or in a hybrid setup with Ollama.

## Why vLLM?

Ollama loads one model into VRAM at a time. Switching between models (e.g., triage 9B to strategic 122B) takes 60+ seconds per swap. vLLM serves models in parallel with OpenAI-compatible API endpoints, eliminating swap latency entirely.

**Recommended hybrid deployment:**
- vLLM serves small fast models (triage, worker) with sub-3s latency
- Ollama serves heavy models (strategic, forensic) with CPU offloading on single GPU

## Prerequisites

- RunPod instance (or any machine with GPU) running vLLM
- SSH access to the vLLM server
- `autossh` installed locally (`brew install autossh` on macOS)
- Ollama running locally or via SSH tunnel

## RunPod SSH Tunnel Setup

Direct HTTPS connections to RunPod go through Cloudflare proxy, which enforces a 100-second timeout. This kills any request to large models. SSH tunnel eliminates all timeout issues.

### Install autossh

```bash
# macOS
brew install autossh

# Linux
sudo apt install autossh
```

### Create the Tunnel

```bash
# Forward local port 8000 to vLLM on RunPod (port 8000)
autossh -M 0 -N -L 8000:localhost:8000 root@YOUR-POD-IP -p SSH_PORT -i ~/.ssh/your_key

# Forward local port 11435 to Ollama on RunPod (port 11434) if running remote Ollama
autossh -M 0 -N -L 11435:localhost:11434 root@YOUR-POD-IP -p SSH_PORT -i ~/.ssh/your_key
```

The `-M 0` flag disables autossh's monitoring port (uses ServerAliveInterval instead). The `-N` flag means no remote command -- tunnel only.

### Verify the Tunnel

```bash
# Check vLLM is reachable
curl http://localhost:8000/v1/models

# Check Ollama is reachable
curl http://localhost:11434/v1/models
```

Both should return a JSON object with a `data` array listing available models.

## vLLM Launch Commands

### Small Model (Triage/Worker)

Serve a fast 7B model for skill routing and self-heal corrections:

```bash
vllm serve Qwen/Qwen3.5-7B \
  --dtype bfloat16 \
  --gpu-memory-utilization 0.3 \
  --max-model-len 4096 \
  --served-model-name qwen3.5-9b \
  --port 8000
```

Key flags:
- `--gpu-memory-utilization 0.3`: Reserve 30% of VRAM, leaving room for other models
- `--max-model-len 4096`: Limit context window to save memory (triage needs short context)
- `--served-model-name qwen3.5-9b`: The model name InfraBrain uses in config (must match exactly)
- `--port 8000`: Separate port from Ollama (default 11434)

### Ollama for Heavy Models

Ollama serves the heavy model on its default port:

```bash
# Pull the model (one-time)
ollama pull qwen3.5:35b-a3b

# Ollama starts automatically on port 11434
# Verify:
curl http://localhost:11434/v1/models
```

## InfraBrain Configuration

Edit `.infrabrain/config.json` (create if it does not exist):

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

In this hybrid config:
- `triage` (and optionally `worker`) route to vLLM at `localhost:8000`
- All other roles route to Ollama at `localhost:11434` via `defaultBaseUrl`

See `config.example.json` in the project root for all three config formats (legacy, hybrid, full vLLM).

## Health Check Verification

Start InfraBrain and verify both backends are reachable:

```bash
# Start InfraBrain
npx tsx src/index.ts

# Check health (in another terminal)
curl http://localhost:3000/health
```

Expected response:

```json
{
  "status": "ok",
  "backends": [
    {
      "baseUrl": "http://localhost:11434/v1",
      "connected": true,
      "models": ["qwen3.5:35b-a3b", "qwen3.5:122b-a10b", "bge-m3"],
      "responseTimeMs": 45
    },
    {
      "baseUrl": "http://localhost:8000/v1",
      "connected": true,
      "models": ["qwen3.5-9b"],
      "responseTimeMs": 12
    }
  ],
  "summary": "all_connected"
}
```

If a backend is unreachable, the health check reports `"connected": false` with the error message. InfraBrain still starts -- it does not block on backend availability.

## Troubleshooting

### Model Name Mismatches

vLLM uses Hugging Face model paths (e.g., `Qwen/Qwen3.5-7B`) while Ollama uses short names (e.g., `qwen3.5:9b`). Use `--served-model-name` in vLLM to match the name InfraBrain expects:

```bash
# This makes vLLM respond to "qwen3.5-9b" instead of "Qwen/Qwen3.5-7B"
vllm serve Qwen/Qwen3.5-7B --served-model-name qwen3.5-9b
```

If the model name in config does not match the served name, requests will fail with a model-not-found error.

### Missing /v1 Suffix

Both Ollama and vLLM serve OpenAI-compatible APIs at the `/v1` path. The `defaultBaseUrl` and per-role `baseUrl` must include the `/v1` suffix:

- Correct: `http://localhost:11434/v1`
- Wrong: `http://localhost:11434` (returns 404 on `/models`)

### Timeout Differences

| Backend | Typical Latency | Notes |
|---------|----------------|-------|
| vLLM (7B) | 1-3s | Fast inference, no model swapping |
| Ollama (35B MoE) | 10-20s | Single model in VRAM, fast if already loaded |
| Ollama (122B MoE) | 25-45s | CPU offloading, slower but high quality |
| RunPod via Cloudflare | 100s timeout | Use SSH tunnel instead |

If requests time out, check:
1. SSH tunnel is alive (`autossh` should reconnect automatically)
2. Model is loaded in vLLM (check `curl localhost:8000/v1/models`)
3. Ollama model is not swapping (check `ollama ps`)

### Connection Refused

If `curl localhost:8000/v1/models` returns "Connection refused":
1. Verify the SSH tunnel is running: `ps aux | grep autossh`
2. Verify vLLM is running on the remote: `ssh root@YOUR-POD-IP "curl localhost:8000/v1/models"`
3. Check port conflicts: `lsof -i :8000`

### Structured Output Failures

vLLM supports guided decoding for structured output (JSON schema enforcement). If `generateObject` calls fail:
1. Verify the model supports JSON mode (`--enable-json-schema` flag may be needed for some models)
2. InfraBrain falls back to `generateText` + manual JSON parsing if structured output fails
3. Check vLLM logs for schema validation errors
