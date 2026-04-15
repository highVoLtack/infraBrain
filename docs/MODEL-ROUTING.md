# Model Routing Guide

InfraBrain uses a 7-role model routing system that assigns different LLM models to different tasks. The system is **fully provider-agnostic** -- any backend that speaks the OpenAI-compatible API works: local Ollama, local vLLM, Google Gemini, OpenAI, Anthropic, Groq, Together, Fireworks, or any other provider.

## Quick Setup Recipes

### Local Ollama (simplest)

No API key needed. Install Ollama, pull models, done.

```json
{
  "defaultBaseUrl": "http://localhost:11434/v1",
  "modelMap": {
    "default": "llama3.3:70b",
    "triage": "qwen2.5:7b",
    "strategic": "llama3.3:70b",
    "forensic": "deepseek-r1:32b",
    "worker": "qwen2.5-coder:32b",
    "vision": "llama3.2-vision",
    "embedding": "bge-m3"
  }
}
```

`.env`: not needed

### Local vLLM (GPU server)

No API key needed. Run vLLM with `--served-model-name`.

```json
{
  "defaultBaseUrl": "http://localhost:8000/v1",
  "modelMap": {
    "default": "qwen3.5:35b-a3b",
    "triage": "qwen3.5:9b",
    "strategic": "qwen3.5:122b-a10b",
    "forensic": "qwen3.5:35b-a3b",
    "worker": "qwen3.5:9b",
    "vision": "qwen3.5:122b-a10b",
    "embedding": "bge-m3"
  }
}
```

`.env`: not needed

### Remote vLLM (RunPod / SSH Tunnel)

No API key needed (RunPod proxy handles auth via URL).

```json
{
  "defaultBaseUrl": "https://YOUR-POD-ID-11434.proxy.runpod.net/v1",
  "modelMap": {
    "default": "qwen3.5:122b-a10b",
    "triage": "qwen3.5:122b-a10b",
    "strategic": "qwen3.5:122b-a10b",
    "forensic": "qwen3.5:122b-a10b",
    "worker": "qwen3.5:122b-a10b",
    "vision": "qwen3.5:122b-a10b",
    "embedding": "bge-m3"
  }
}
```

### Google Gemini (cloud, free tier available)

```json
{
  "defaultBaseUrl": "https://generativelanguage.googleapis.com/v1beta/openai/",
  "modelMap": {
    "default":   { "model": "gemini-2.5-flash",     "baseUrl": "https://generativelanguage.googleapis.com/v1beta/openai/", "apiKey": "${GOOGLE_AI_API_KEY}" },
    "triage":    { "model": "gemini-2.5-flash",     "baseUrl": "https://generativelanguage.googleapis.com/v1beta/openai/", "apiKey": "${GOOGLE_AI_API_KEY}" },
    "strategic": { "model": "gemini-2.5-pro",       "baseUrl": "https://generativelanguage.googleapis.com/v1beta/openai/", "apiKey": "${GOOGLE_AI_API_KEY}" },
    "forensic":  { "model": "gemini-2.5-flash",     "baseUrl": "https://generativelanguage.googleapis.com/v1beta/openai/", "apiKey": "${GOOGLE_AI_API_KEY}" },
    "worker":    { "model": "gemini-2.5-flash",     "baseUrl": "https://generativelanguage.googleapis.com/v1beta/openai/", "apiKey": "${GOOGLE_AI_API_KEY}" },
    "vision":    { "model": "gemini-2.5-flash",     "baseUrl": "https://generativelanguage.googleapis.com/v1beta/openai/", "apiKey": "${GOOGLE_AI_API_KEY}" },
    "embedding": { "model": "gemini-embedding-001", "baseUrl": "https://generativelanguage.googleapis.com/v1beta/openai/", "apiKey": "${GOOGLE_AI_API_KEY}" }
  }
}
```

`.env`:
```
GOOGLE_AI_API_KEY=AIza...your-key
```

Get key: https://aistudio.google.com/apikey

### OpenAI

```json
{
  "defaultBaseUrl": "https://api.openai.com/v1",
  "modelMap": {
    "default":   { "model": "gpt-4o-mini",          "baseUrl": "https://api.openai.com/v1", "apiKey": "${OPENAI_API_KEY}" },
    "triage":    { "model": "gpt-4o-mini",          "baseUrl": "https://api.openai.com/v1", "apiKey": "${OPENAI_API_KEY}" },
    "strategic": { "model": "gpt-4o",               "baseUrl": "https://api.openai.com/v1", "apiKey": "${OPENAI_API_KEY}" },
    "forensic":  { "model": "gpt-4o",               "baseUrl": "https://api.openai.com/v1", "apiKey": "${OPENAI_API_KEY}" },
    "worker":    { "model": "gpt-4o-mini",          "baseUrl": "https://api.openai.com/v1", "apiKey": "${OPENAI_API_KEY}" },
    "vision":    { "model": "gpt-4o",               "baseUrl": "https://api.openai.com/v1", "apiKey": "${OPENAI_API_KEY}" },
    "embedding": { "model": "text-embedding-3-small","baseUrl": "https://api.openai.com/v1", "apiKey": "${OPENAI_API_KEY}" }
  }
}
```

`.env`:
```
OPENAI_API_KEY=sk-...your-key
```

### Groq (ultra-fast cloud inference)

```json
{
  "defaultBaseUrl": "https://api.groq.com/openai/v1",
  "modelMap": {
    "default":   { "model": "llama-3.3-70b-versatile", "baseUrl": "https://api.groq.com/openai/v1", "apiKey": "${GROQ_API_KEY}" },
    "triage":    { "model": "llama-3.1-8b-instant",    "baseUrl": "https://api.groq.com/openai/v1", "apiKey": "${GROQ_API_KEY}" },
    "strategic": { "model": "llama-3.3-70b-versatile", "baseUrl": "https://api.groq.com/openai/v1", "apiKey": "${GROQ_API_KEY}" },
    "forensic":  { "model": "deepseek-r1-distill-llama-70b", "baseUrl": "https://api.groq.com/openai/v1", "apiKey": "${GROQ_API_KEY}" },
    "worker":    { "model": "llama-3.1-8b-instant",    "baseUrl": "https://api.groq.com/openai/v1", "apiKey": "${GROQ_API_KEY}" },
    "vision":    { "model": "llama-3.2-90b-vision-preview", "baseUrl": "https://api.groq.com/openai/v1", "apiKey": "${GROQ_API_KEY}" },
    "embedding": "bge-m3"
  }
}
```

Note: Groq has no embedding API. Use a local embedding model or pair with Gemini for embeddings (see Hybrid below).

`.env`:
```
GROQ_API_KEY=gsk_...your-key
```

### Hybrid: Cloud LLM + Local Embeddings

Mix providers freely. Each role resolves independently.

```json
{
  "defaultBaseUrl": "https://api.groq.com/openai/v1",
  "modelMap": {
    "default":   { "model": "llama-3.3-70b-versatile", "baseUrl": "https://api.groq.com/openai/v1", "apiKey": "${GROQ_API_KEY}" },
    "triage":    { "model": "llama-3.1-8b-instant",    "baseUrl": "https://api.groq.com/openai/v1", "apiKey": "${GROQ_API_KEY}" },
    "strategic": { "model": "gemini-2.5-pro",          "baseUrl": "https://generativelanguage.googleapis.com/v1beta/openai/", "apiKey": "${GOOGLE_AI_API_KEY}" },
    "forensic":  { "model": "deepseek-r1-distill-llama-70b", "baseUrl": "https://api.groq.com/openai/v1", "apiKey": "${GROQ_API_KEY}" },
    "worker":    { "model": "llama-3.1-8b-instant",    "baseUrl": "https://api.groq.com/openai/v1", "apiKey": "${GROQ_API_KEY}" },
    "vision":    { "model": "gpt-4o",                  "baseUrl": "https://api.openai.com/v1", "apiKey": "${OPENAI_API_KEY}" },
    "embedding": { "model": "bge-m3",                  "baseUrl": "http://localhost:11434/v1" }
  }
}
```

`.env`:
```
GROQ_API_KEY=gsk_...
GOOGLE_AI_API_KEY=AIza...
OPENAI_API_KEY=sk-...
```

This routes: Groq for fast inference, Gemini Pro for deep planning, OpenAI for vision, local Ollama for embeddings. Each role is independent.

### Hybrid: Local LLM + Cloud Embeddings

```json
{
  "defaultBaseUrl": "http://localhost:11434/v1",
  "modelMap": {
    "default": "llama3.3:70b",
    "triage": "qwen2.5:7b",
    "strategic": "llama3.3:70b",
    "forensic": "deepseek-r1:32b",
    "worker": "qwen2.5-coder:32b",
    "vision": "llama3.2-vision",
    "embedding": { "model": "gemini-embedding-001", "baseUrl": "https://generativelanguage.googleapis.com/v1beta/openai/", "apiKey": "${GOOGLE_AI_API_KEY}" }
  }
}
```

---

## How It Works

### Config File Location

```
.infrabrain/config.json    <-- loaded at startup
```

### Entry Formats

Each role in `modelMap` accepts two formats:

| Format | Syntax | Backend | Auth |
|--------|--------|---------|------|
| **String** | `"triage": "qwen2.5:7b"` | Uses `defaultBaseUrl` | No auth |
| **Object** | `"triage": { "model": "...", "baseUrl": "...", "apiKey": "..." }` | Own baseUrl | Optional Bearer token |

Both formats mix freely within the same `modelMap`.

### Environment Variable Substitution

Config values support `${ENV_VAR}` syntax. The loader reads `.env` at startup, then replaces placeholders from `process.env`.

```json
"apiKey": "${GOOGLE_AI_API_KEY}"
```

resolves to the value of `GOOGLE_AI_API_KEY` from `.env` or the shell environment.

**Never put raw API keys in config.json.** Always use `${VAR}` references and keep keys in `.env` (which is gitignored).

### API Key Handling

- **Present**: Sent as `Authorization: Bearer <key>` on every request (LLM calls + health probes)
- **Absent**: No auth header sent. Local backends (Ollama, vLLM) don't need auth.
- **Per-role**: Each role can have a different key (or none). Mix cloud + local freely.

### Provider Contract

InfraBrain requires one thing from any backend: **OpenAI-compatible API at the given baseUrl**.

Required endpoints:
- `POST /chat/completions` (all LLM roles)
- `POST /embeddings` (embedding role)
- `GET /models` (health check, optional but recommended)

Providers known to work:

| Provider | baseUrl | Notes |
|----------|---------|-------|
| Ollama | `http://localhost:11434/v1` | Local, no auth |
| vLLM | `http://localhost:8000/v1` | Local, no auth |
| Google Gemini | `https://generativelanguage.googleapis.com/v1beta/openai/` | Free tier: 15 RPM |
| OpenAI | `https://api.openai.com/v1` | Pay per token |
| Groq | `https://api.groq.com/openai/v1` | Free tier available |
| Together | `https://api.together.xyz/v1` | Pay per token |
| Fireworks | `https://api.fireworks.ai/inference/v1` | Pay per token |
| LiteLLM | `http://localhost:4000/v1` | Proxy for any provider |
| RunPod (proxy) | `https://POD-ID.proxy.runpod.net/v1` | No auth (URL is token) |

---

## Role Definitions

| Role | Purpose | Latency Target | Minimum Size |
|------|---------|---------------|--------------|
| **triage** | Skill selection and classification | <3s | 7B+ |
| **default** | General diagnosis, first-pass analysis | <15s | 32B+ |
| **strategic** | Fix planning, command generation, self-heal | <30s | 70B+ |
| **forensic** | Complex multi-step failure analysis | <60s | 70B+ (CoT) |
| **worker** | Self-heal corrections (stateful reasoning) | <10s | 32B+ |
| **vision** | Screenshot and visual evidence analysis | <30s | Vision model |
| **embedding** | Semantic search for cache + memory | <1s | Embedding model |

### Embedding Dimensions

Different embedding models produce different vector sizes. InfraBrain handles this automatically:

| Model | Dimensions | Provider |
|-------|-----------|----------|
| bge-m3 | 1024 | Local (Ollama/vLLM) |
| gemini-embedding-001 | 3072 | Google Gemini |
| text-embedding-3-small | 1536 | OpenAI |
| text-embedding-3-large | 3072 | OpenAI |

When switching embedding models, delete the existing cache/memory LanceDB data to avoid dimension mismatches:

```bash
rm -rf .infrabrain/cache/fix_cache.lance
rm -rf .infrabrain/memory/mem_incidents.lance
rm -rf .infrabrain/memory/mem_entities.lance
```

The stores will recreate automatically on next startup.

---

## Switching Providers

### Step 1: Edit `.infrabrain/config.json`

Copy one of the recipes above and adjust model names.

### Step 2: Set API keys in `.env`

```bash
# Add your key(s)
echo 'GOOGLE_AI_API_KEY=AIza...' >> .env
echo 'OPENAI_API_KEY=sk-...' >> .env
```

### Step 3: Restart InfraBrain

```bash
npm run dev
```

Check the health endpoint to verify:

```bash
curl http://localhost:3001/health | jq .
```

Should show `"connected": true` for all backends and `"available": true` for all roles.

### Step 4: (Optional) Clear vector stores on embedding model change

Only needed when the embedding model changes (different dimensions):

```bash
rm -rf .infrabrain/cache/fix_cache.lance .infrabrain/memory/mem_*.lance
```

---

## Skills and Model Preferences

Skills declare their preferred model via frontmatter:

```yaml
# skills/planning.md
name: planning
preferred_model: strategic
```

At runtime, the pipeline resolves `strategic` to whatever model + backend is configured for that role. Skills are provider-agnostic -- they reference roles, not models.

## Escalation Path

When self-healing exhausts attempts, the system escalates to more capable models:

```
worker → strategic → forensic
```

Each escalation switches to the model configured for that role. The escalation chain works regardless of provider -- it could go from local Ollama worker to cloud Gemini strategic to cloud OpenAI forensic.
