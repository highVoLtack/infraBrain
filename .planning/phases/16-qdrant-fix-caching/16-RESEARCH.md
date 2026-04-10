# Phase 16: Qdrant Fix-Caching - Research

**Researched:** 2026-04-10
**Domain:** Vector similarity caching with Qdrant, BGE-M3 embeddings, Docker container lifecycle
**Confidence:** HIGH

## Summary

Phase 16 adds a vector similarity cache layer to the DPEV pipeline using Qdrant as the vector store and BGE-M3 (1024-dimensional) for embeddings. The cache intercepts after noise filtering and before LLM diagnosis, enabling sub-2-second resolution of repeat errors. The implementation requires four new subsystems: (1) Qdrant Docker lifecycle management, (2) BGE-M3 embedding via Ollama's OpenAI-compatible `/v1/embeddings` endpoint, (3) cache lookup/store logic with confidence scoring, and (4) skill-based invalidation via file hashing.

The project already has all prerequisites in place: the `embedding` model role is defined in `ModelMap` with `bge-m3` as default, the Vercel AI SDK (`ai` package) provides `embed()` for embeddings via `@ai-sdk/openai-compatible`, the pipeline has a clear insertion point between `filterNoise()` and `runDiagnosis()`, and Docker container management patterns exist in the execution layer. Qdrant's TypeScript client (`@qdrant/js-client-rest`) provides a clean REST API for collection management, upsert, search, and filtered deletion.

**Primary recommendation:** Use `@qdrant/js-client-rest` for Qdrant operations and the Vercel AI SDK `embed()` function with the existing `@ai-sdk/openai-compatible` provider for BGE-M3 embeddings. Qdrant container lifecycle via `child_process.exec` following the project's established pattern.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Cache check happens **before diagnosis** in the DPEV pipeline -- after discovery + noise filter, before LLM diagnosis
- On cache hit (similarity > 0.85): skip diagnosis and planning entirely, show abbreviated diagnosis block with cached fix plan + provenance
- User prompted "Use cached fix or re-diagnose?" before execution; `--no-cache` flag for forced bypass
- Soft Zone (Speculative Execution): 0.85+ = Fast Path, 0.75-0.85 = Speculative Execution (show cached fix as "Possible Match" while LLM runs in parallel), below 0.75 = cache miss
- Success Feedback Loop: hit_count, success_count, last_used timestamp per cache entry
- Confidence Formula: `confidence = w_sim * similarity + w_rec * recency_score + w_suc * success_rate` with defaults w_sim=0.5, w_rec=0.3, w_suc=0.2; configurable in config.json
- Recency uses exponential decay
- Embed error signature + filtered discovery context (post-noise-filter output from Phase 15)
- Use BGE-M3 model (already in modelMap as `embedding` role)
- Per-skill cache invalidation: each entry stores which skill produced the fix; skill file change purges only that skill's entries
- Eager invalidation on startup: hash all skill files, compare against stored hashes, purge stale entries immediately
- No TTL -- exponential decay naturally deprioritizes old entries
- Manual cache management: `infrabrain cache clear` and `infrabrain cache list`

### Claude's Discretion
- Qdrant container lifecycle details (port, volume mount, health check implementation)
- Qdrant collection schema and index configuration
- Exact embedding input formatting (how error signature + discovery context are concatenated)
- Cache entry payload structure beyond the required fields
- Abbreviated diagnosis block exact formatting

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| CACHE-01 | Qdrant runs as Docker container with auto-lifecycle management | Docker lifecycle via child_process.exec; health check via GET /healthz on port 6333; volume mount for persistence |
| CACHE-02 | Error signature + discovery context embedded via BGE-M3 into Qdrant collection | Vercel AI SDK `embed()` with `@ai-sdk/openai-compatible` provider; BGE-M3 produces 1024-dim vectors; Ollama serves /v1/embeddings |
| CACHE-03 | Before LLM diagnosis, similarity search checks for cached fix (threshold > 0.85) | Qdrant `client.query()` with score_threshold; inserts in pipeline after filterNoise() before runDiagnosis() |
| CACHE-04 | Cached fix returned in <2s vs 113s for LLM reasoning | Qdrant search is <50ms; BGE-M3 embedding ~100-200ms via Ollama; total well under 2s |
| CACHE-05 | Cache invalidation on skill file updates | Startup file hashing with crypto.createHash('sha256'); per-skill filter-based deletion via client.delete() with payload filter |
| CACHE-06 | Confidence scoring on cached fixes | Weighted formula computed in TypeScript; recency via exponential decay from last_used timestamp |
| CACHE-07 | Graceful degradation -- InfraBrain works without Qdrant | Try-catch wrapper around all Qdrant operations; cache miss fallback path identical to no-cache path |
| CACHE-08 | Cache hit explainability -- provenance indicator | Payload stores original incident date, session ID, skill name, similarity score; formatted in pipeline output |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @qdrant/js-client-rest | ^1.17.0 | Qdrant vector DB client | Official TypeScript REST client, type-safe, ESM support, Node.js >= 18 |
| ai (Vercel AI SDK) | ^6.0.116 | `embed()` function for BGE-M3 | Already in project; provides unified embedding API |
| @ai-sdk/openai-compatible | ^2.0.35 | OpenAI-compatible provider for embedding model | Already in project; `textEmbeddingModel()` method for BGE-M3 via Ollama |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| node:child_process | built-in | Docker container lifecycle (start/stop/inspect) | Qdrant container management |
| node:crypto | built-in | SHA-256 hashing for skill file invalidation | Startup skill hash comparison |
| zod | ^4.3.6 | Config schema extension for cache weights/thresholds | Already in project; extend InfraBrainConfigSchema |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| @qdrant/js-client-rest | Raw HTTP fetch to Qdrant REST API | Client provides type safety, error handling, reconnection; raw fetch adds maintenance burden |
| Vercel AI SDK embed() | Direct HTTP POST to /v1/embeddings | SDK handles retries, typing, provider abstraction; raw fetch loses these benefits |

**Installation:**
```bash
npm install @qdrant/js-client-rest
```

(All other dependencies already present in package.json)

## Architecture Patterns

### Recommended Project Structure
```
src/
├── cache/                    # NEW: Fix caching subsystem
│   ├── qdrant-client.ts      # Singleton QdrantClient wrapper with graceful degradation
│   ├── qdrant-lifecycle.ts   # Docker container start/stop/health check
│   ├── embedder.ts           # BGE-M3 embedding via Vercel AI SDK embed()
│   ├── cache-store.ts        # Upsert, search, delete operations on Qdrant collection
│   ├── confidence.ts         # Confidence scoring formula + exponential decay
│   ├── invalidation.ts       # Skill file hashing + stale entry purge
│   └── types.ts              # CacheEntry, CacheHit, CacheConfig types
├── orchestrator/
│   └── pipeline.ts           # MODIFIED: Insert cache check between filterNoise and runDiagnosis
├── config/
│   └── types.ts              # MODIFIED: Add cache config to InfraBrainConfigSchema
└── cli/
    └── cache-commands.ts     # NEW: `infrabrain cache clear` and `infrabrain cache list`
```

### Pattern 1: Graceful Degradation Wrapper
**What:** Every Qdrant operation wrapped in try-catch that returns a "cache miss" result on failure
**When to use:** All cache operations -- the cache is an optimization, never a requirement
**Example:**
```typescript
// Source: Project pattern -- cache is optimization, not requirement
export async function searchCache(
  embedding: number[],
  client: QdrantClient | null,
): Promise<CacheHit | null> {
  if (!client) return null; // Qdrant unavailable
  try {
    const results = await client.query('fix_cache', {
      query: embedding,
      limit: 1,
      score_threshold: 0.75, // Lowest threshold (soft zone floor)
      with_payload: true,
    });
    if (results.points.length === 0) return null;
    const point = results.points[0];
    return {
      similarity: point.score,
      payload: point.payload as CacheEntryPayload,
      pointId: point.id,
    };
  } catch {
    return null; // Graceful degradation
  }
}
```

### Pattern 2: Pipeline Insertion Point
**What:** Cache check inserts between noise filter and diagnosis in runDPEV()
**When to use:** Main pipeline flow
**Example:**
```typescript
// In pipeline.ts runDPEV(), after filterNoise() and contextManager setup,
// before runDiagnosis():
const cacheResult = await searchCache(
  await embedForCache(filteredRaw, prompt),
  qdrantClient,
);

if (cacheResult && cacheResult.similarity >= 0.85) {
  // Fast Path: return cached result directly
  return buildCachedResult(cacheResult, input);
} else if (cacheResult && cacheResult.similarity >= 0.75) {
  // Speculative Execution: run LLM in parallel, present both
  // (falls back to sequential if Phase 18 not available)
}
// else: cache miss, proceed to full LLM diagnosis
```

### Pattern 3: Embedding Input Formatting
**What:** Concatenate error signature + noise-filtered discovery context for embedding
**When to use:** Both cache write (after successful fix) and cache read (before diagnosis)
**Example:**
```typescript
// Consistent embedding input ensures "same error in same infra state" matches
function formatEmbeddingInput(
  userPrompt: string,
  filteredDiscovery: Record<string, string>,
): string {
  const discoveryText = Object.entries(filteredDiscovery)
    .map(([key, val]) => `${key}: ${val}`)
    .join('\n');
  return `ERROR: ${userPrompt}\n\nCONTEXT:\n${discoveryText}`;
}
```

### Pattern 4: Singleton Qdrant Client with Lazy Init
**What:** Single QdrantClient instance created on first use, reused across requests
**When to use:** All Qdrant interactions
**Example:**
```typescript
let _client: QdrantClient | null = null;
let _available = true;

export async function getQdrantClient(): Promise<QdrantClient | null> {
  if (!_available) return null;
  if (_client) return _client;
  try {
    _client = new QdrantClient({ url: 'http://localhost:6333' });
    // Verify connection with health check
    await _client.getCollections();
    return _client;
  } catch {
    _available = false;
    return null; // Graceful degradation
  }
}
```

### Anti-Patterns to Avoid
- **Creating QdrantClient per request:** Connection overhead adds latency. Use singleton.
- **Embedding the raw (unfiltered) discovery output:** Different noise yields different embeddings for the same error. Always embed post-noise-filter output.
- **Hard-failing on Qdrant unavailability:** The cache is an optimization. Never throw errors that block the pipeline.
- **Storing the full fix plan as the vector:** The vector should represent the error context, not the fix. The fix goes in the payload.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Vector similarity search | Custom cosine similarity over in-memory arrays | Qdrant `client.query()` | HNSW index scales, handles persistence, filtering, pagination |
| Embedding generation | Manual tokenization + model inference | Vercel AI SDK `embed()` | Handles API protocol, retries, provider abstraction |
| Docker container health checks | Polling with `docker inspect` in a loop | HTTP GET to `http://localhost:6333/healthz` | Qdrant exposes REST health endpoint; simpler and faster than Docker inspect |
| Exponential decay scoring | Reinventing decay formulas | `Math.exp(-lambda * ageDays)` with configurable lambda | Standard formula, just needs a clean implementation |

**Key insight:** Qdrant and the AI SDK handle all the hard parts (indexing, vector math, API protocols). The custom code is just orchestration: when to check cache, what to embed, how to score confidence.

## Common Pitfalls

### Pitfall 1: Embedding Dimension Mismatch
**What goes wrong:** Collection created with wrong vector size, upserts fail silently or with cryptic errors
**Why it happens:** BGE-M3 produces 1024-dimensional vectors; easy to confuse with other models (384 for MiniLM, 768 for BERT)
**How to avoid:** Hard-code `size: 1024` in collection creation; assert embedding length before upsert
**Warning signs:** "Vector dimension mismatch" errors from Qdrant

### Pitfall 2: Qdrant Container Port Conflict
**What goes wrong:** Qdrant fails to start because port 6333 is already in use
**Why it happens:** Previous Qdrant container not cleaned up, or another service on the same port
**How to avoid:** Check for existing container by name before creating; use `docker start` for stopped containers rather than `docker run`
**Warning signs:** EADDRINUSE errors, Docker exit code 125

### Pitfall 3: Stale Embeddings After Noise Filter Changes
**What goes wrong:** Cached entries from before a noise filter update match with wrong similarity because the embedding input format changed
**Why it happens:** Noise filter patterns evolve; same error produces different filtered output over time
**How to avoid:** Include a schema version in cache entries; consider purging on major filter changes (but this is an edge case)
**Warning signs:** High similarity hits that produce wrong fixes

### Pitfall 4: Blocking Pipeline on Qdrant Start
**What goes wrong:** First request hangs for 5-10 seconds while Qdrant Docker container starts
**Why it happens:** Container startup is synchronous and blocks the pipeline
**How to avoid:** Start Qdrant container during server startup (not on first request); use a startup health check with timeout
**Warning signs:** First diagnosis after restart takes 10+ seconds longer than subsequent ones

### Pitfall 5: Embedding Model Not Loaded in Ollama
**What goes wrong:** embed() call fails because BGE-M3 isn't pulled in Ollama
**Why it happens:** The model role is configured but the actual model isn't downloaded
**How to avoid:** Check model availability during startup; log a warning if embedding model is not available (degrade gracefully)
**Warning signs:** 404 or model not found errors from Ollama embedding endpoint

### Pitfall 6: Speculative Execution Race Condition
**What goes wrong:** Both cached fix and LLM result modify shared state simultaneously
**Why it happens:** The 0.75-0.85 soft zone runs cache suggestion and LLM in parallel
**How to avoid:** Both paths should produce independent result objects; only the user's choice gets committed. No shared mutable state.
**Warning signs:** Corrupted diagnosis or mixed results

## Code Examples

### Qdrant Collection Setup
```typescript
// Source: Qdrant official docs + project BGE-M3 config
import { QdrantClient } from '@qdrant/js-client-rest';

const COLLECTION_NAME = 'fix_cache';
const VECTOR_SIZE = 1024; // BGE-M3 output dimension

async function ensureCollection(client: QdrantClient): Promise<void> {
  const collections = await client.getCollections();
  const exists = collections.collections.some(c => c.name === COLLECTION_NAME);
  if (!exists) {
    await client.createCollection(COLLECTION_NAME, {
      vectors: { size: VECTOR_SIZE, distance: 'Cosine' },
    });
    // Create payload index for skill-based invalidation
    await client.createPayloadIndex(COLLECTION_NAME, {
      field_name: 'skill_name',
      field_schema: 'keyword',
    });
  }
}
```

### BGE-M3 Embedding via Vercel AI SDK
```typescript
// Source: Vercel AI SDK docs + project openai-compat.ts pattern
import { embed } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

function createEmbeddingModel(baseURL: string, modelId: string) {
  const provider = createOpenAICompatible({
    name: 'infrabrain-embed',
    baseURL,
  });
  return provider.textEmbeddingModel(modelId);
}

async function generateEmbedding(
  text: string,
  baseURL: string,
  modelId: string,
): Promise<number[]> {
  const model = createEmbeddingModel(baseURL, modelId);
  const { embedding } = await embed({ model, value: text });
  return embedding;
}
```

### Cache Entry Upsert After Successful Fix
```typescript
// Source: Qdrant JS client docs
import { v4 as uuidv4 } from 'uuid';

interface CacheEntryPayload {
  error_signature: string;
  skill_name: string;
  fix_plan: object;       // Serialized FixPlan
  diagnosis: string;       // Abbreviated diagnosis text
  session_id: string;
  created_at: string;      // ISO timestamp
  last_used: string;       // ISO timestamp
  hit_count: number;
  success_count: number;
  fail_count: number;
}

async function storeCacheEntry(
  client: QdrantClient,
  embedding: number[],
  payload: CacheEntryPayload,
): Promise<void> {
  await client.upsert(COLLECTION_NAME, {
    wait: true,
    points: [{
      id: uuidv4(),
      vector: embedding,
      payload,
    }],
  });
}
```

### Skill-Based Cache Invalidation
```typescript
// Source: Project SkillRegistry pattern + Node.js crypto
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

function hashSkillFiles(skillsDir: string): Map<string, string> {
  const hashes = new Map<string, string>();
  for (const file of readdirSync(skillsDir)) {
    if (!file.endsWith('.md')) continue;
    const content = readFileSync(join(skillsDir, file), 'utf-8');
    const hash = createHash('sha256').update(content).digest('hex');
    hashes.set(file, hash);
  }
  return hashes;
}

async function purgeStaleEntries(
  client: QdrantClient,
  skillName: string,
): Promise<void> {
  await client.delete(COLLECTION_NAME, {
    filter: {
      must: [{ key: 'skill_name', match: { value: skillName } }],
    },
  });
}
```

### Docker Container Lifecycle
```typescript
// Source: Project execution/runner.ts pattern
import { exec as execCb } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execCb);

const QDRANT_CONTAINER_NAME = 'infrabrain-qdrant';
const QDRANT_PORT = 6333;
const QDRANT_VOLUME = 'infrabrain-qdrant-data';

async function ensureQdrantRunning(): Promise<boolean> {
  try {
    // Check if container exists
    const { stdout } = await exec(
      `docker inspect --format='{{.State.Running}}' ${QDRANT_CONTAINER_NAME} 2>/dev/null`
    );
    if (stdout.trim() === 'true') return true;

    // Container exists but stopped -- start it
    await exec(`docker start ${QDRANT_CONTAINER_NAME}`);
    return await waitForHealth();
  } catch {
    // Container doesn't exist -- create it
    try {
      await exec(
        `docker run -d --name ${QDRANT_CONTAINER_NAME} ` +
        `-p ${QDRANT_PORT}:6333 ` +
        `-v ${QDRANT_VOLUME}:/qdrant/storage ` +
        `qdrant/qdrant`
      );
      return await waitForHealth();
    } catch {
      return false; // Graceful degradation
    }
  }
}

async function waitForHealth(maxRetries = 10, delayMs = 500): Promise<boolean> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const resp = await fetch(`http://localhost:${QDRANT_PORT}/healthz`);
      if (resp.ok) return true;
    } catch { /* not ready yet */ }
    await new Promise(r => setTimeout(r, delayMs));
  }
  return false;
}

async function stopQdrant(): Promise<void> {
  try {
    await exec(`docker stop ${QDRANT_CONTAINER_NAME}`);
  } catch { /* already stopped or doesn't exist */ }
}
```

### Confidence Scoring
```typescript
// Source: CONTEXT.md locked decision
interface ConfidenceConfig {
  w_sim: number;  // default 0.5
  w_rec: number;  // default 0.3
  w_suc: number;  // default 0.2
  decayLambda: number; // exponential decay rate
}

function computeConfidence(
  similarity: number,
  lastUsed: Date,
  successCount: number,
  totalUses: number,
  config: ConfidenceConfig,
): number {
  const ageDays = (Date.now() - lastUsed.getTime()) / (1000 * 60 * 60 * 24);
  const recencyScore = Math.exp(-config.decayLambda * ageDays);
  const successRate = totalUses > 0 ? successCount / totalUses : 0.5; // neutral default

  return config.w_sim * similarity
       + config.w_rec * recencyScore
       + config.w_suc * successRate;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Qdrant REST API raw HTTP | @qdrant/js-client-rest typed client | 2024 | Type-safe operations, automatic serialization |
| Qdrant search() method | Qdrant query() method | Qdrant 1.10+ | Unified search API, replaces separate search/recommend |
| Manual embedding HTTP calls | Vercel AI SDK embed() | ai@3.2+ | Unified API, provider abstraction, built-in retries |
| Ollama /api/embeddings | Ollama /v1/embeddings | Ollama 0.1.26+ | OpenAI-compatible endpoint, works with standard SDKs |

**Important:** Use `client.query()` not `client.search()` -- `query()` is the modern unified API in Qdrant 1.10+.

## Open Questions

1. **Speculative Execution without Phase 18**
   - What we know: CONTEXT.md says "leverages Phase 18 when available, falls back to sequential"
   - What's unclear: Phase 18 (Parallel Inference) hasn't been built yet. The soft zone (0.75-0.85) needs parallel execution.
   - Recommendation: Implement with `Promise.allSettled()` using the existing pipeline. Phase 18 is about multi-model parallel inference, not general parallelism. A simple `Promise.allSettled([cachedFixPromise, llmDiagnosisPromise])` works without Phase 18.

2. **Cache Write Timing**
   - What we know: Cache entries are written after a successful fix execution
   - What's unclear: Exact trigger point -- after execution succeeds? After verification passes?
   - Recommendation: Write cache entry after execution verification passes (circuit breaker success), not just after execution. This ensures only verified fixes enter the cache.

3. **Embedding Model Availability at Startup**
   - What we know: BGE-M3 must be pulled in Ollama before embeddings work
   - What's unclear: Whether to auto-pull or just warn
   - Recommendation: Check on startup, log warning if not available, degrade gracefully (cache disabled). Do NOT auto-pull -- respects air-gap and user control.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.0.18 |
| Config file | vitest.config.ts |
| Quick run command | `npx vitest run tests/cache/` |
| Full suite command | `npx vitest run` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CACHE-01 | Qdrant lifecycle (start/stop/health) | unit + integration | `npx vitest run tests/cache/qdrant-lifecycle.test.ts -x` | Wave 0 |
| CACHE-02 | BGE-M3 embedding generation | unit | `npx vitest run tests/cache/embedder.test.ts -x` | Wave 0 |
| CACHE-03 | Cache lookup before diagnosis | unit + integration | `npx vitest run tests/cache/cache-store.test.ts -x` | Wave 0 |
| CACHE-04 | Sub-2s cache hit performance | integration | `npx vitest run tests/cache/performance.test.ts -x` | Wave 0 |
| CACHE-05 | Skill file invalidation | unit | `npx vitest run tests/cache/invalidation.test.ts -x` | Wave 0 |
| CACHE-06 | Confidence scoring formula | unit | `npx vitest run tests/cache/confidence.test.ts -x` | Wave 0 |
| CACHE-07 | Graceful degradation | unit | `npx vitest run tests/cache/degradation.test.ts -x` | Wave 0 |
| CACHE-08 | Cache hit provenance display | unit | `npx vitest run tests/cache/provenance.test.ts -x` | Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run tests/cache/`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/cache/` directory -- all test files listed above
- [ ] Mock Qdrant client for unit tests (no Docker dependency in CI)
- [ ] Mock embedding function for deterministic test vectors

## Sources

### Primary (HIGH confidence)
- [Qdrant Quickstart](https://qdrant.tech/documentation/quickstart/) - Docker setup, TypeScript client API, collection creation, search
- [Qdrant JS Client GitHub](https://github.com/qdrant/qdrant-js) - Package name, import syntax, Node.js requirements
- [Vercel AI SDK embed()](https://ai-sdk.dev/docs/reference/ai-sdk-core/embed) - embed() function signature, return types, usage
- [BGE-M3 on HuggingFace](https://huggingface.co/BAAI/bge-m3) - 1024 dimensions, 8192 token max input, multilingual
- [Qdrant Health Endpoints](https://api.qdrant.tech/api-reference/service/healthz) - /healthz, /livez, /readyz on port 6333
- [Ollama OpenAI Compatibility](https://docs.ollama.com/api/openai-compatibility) - /v1/embeddings endpoint support

### Secondary (MEDIUM confidence)
- [Qdrant Collections Docs](https://qdrant.tech/documentation/concepts/collections/) - Distance metrics, payload indexing, on_disk config
- [@qdrant/js-client-rest npm](https://www.npmjs.com/package/@qdrant/js-client-rest) - Version 1.17.0, latest publish date

### Tertiary (LOW confidence)
- vLLM BGE-M3 support -- confirmed available in Ollama, vLLM support for BGE-M3 still evolving; Ollama path is safer for this project

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All libraries verified against official docs; @qdrant/js-client-rest is the official client; Vercel AI SDK embed() documented
- Architecture: HIGH - Pipeline insertion point clearly identified in existing code; patterns follow established project conventions
- Pitfalls: MEDIUM - Based on Qdrant community issues and general vector DB experience; some pitfalls (like noise filter drift) are theoretical

**Research date:** 2026-04-10
**Valid until:** 2026-05-10 (stable libraries, 30-day window)
