# Phase 16: Fix-Caching - Research

**Researched:** 2026-04-10
**Updated:** 2026-04-10 (LanceDB pivot — no Docker/external service dependency)
**Domain:** Vector similarity caching with LanceDB (embedded), BGE-M3 embeddings
**Confidence:** HIGH

## Summary

Phase 16 adds a vector similarity cache layer to the DPEV pipeline using **LanceDB** as an embedded vector store and BGE-M3 (1024-dimensional) for embeddings. The cache intercepts after noise filtering and before LLM diagnosis, enabling sub-2-second resolution of repeat errors. The implementation requires three new subsystems: (1) LanceDB table management (in-process, no server), (2) BGE-M3 embedding via Ollama's OpenAI-compatible `/v1/embeddings` endpoint, (3) cache lookup/store logic with confidence scoring, and (4) skill-based invalidation via file hashing.

**Why LanceDB over Qdrant:** InfraBrain is a universal standalone tool. No Docker, no external services, no subprocess management. LanceDB runs fully in-process via NAPI Rust bindings — `npm install` and it works. Qdrant requires either Docker (rejected) or binary subprocess management (unnecessary complexity). LanceDB is proven in production CLI tools (AnythingLLM, Continue VS Code extension).

The project already has all prerequisites in place: the `embedding` model role is defined in `ModelMap` with `bge-m3` as default, the Vercel AI SDK (`ai` package) provides `embed()` for embeddings via `@ai-sdk/openai-compatible`, and the pipeline has a clear insertion point between `filterNoise()` and `runDiagnosis()`.

**Primary recommendation:** Use `@lancedb/lancedb` for vector storage and the Vercel AI SDK `embed()` function with the existing `@ai-sdk/openai-compatible` provider for BGE-M3 embeddings. No external service needed.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **LanceDB replaces Qdrant** — embedded, in-process, no Docker, no subprocess (User Decision 2026-04-10)
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
- LanceDB table schema and index configuration
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
| CACHE-01 | Vector store with auto-lifecycle management | LanceDB embedded — no lifecycle management needed; `await lancedb.connect("./data/cache")` opens/creates automatically |
| CACHE-02 | Error signature + discovery context embedded via BGE-M3 into vector store | Vercel AI SDK `embed()` with `@ai-sdk/openai-compatible` provider; BGE-M3 produces 1024-dim vectors; Ollama serves /v1/embeddings |
| CACHE-03 | Before LLM diagnosis, similarity search checks for cached fix (threshold > 0.85) | LanceDB `table.vectorSearch(embedding).limit(1).distanceType("cosine")` with post-filter on distance; inserts in pipeline after filterNoise() before runDiagnosis() |
| CACHE-04 | Cached fix returned in <2s vs 113s for LLM reasoning | LanceDB brute-force search at 10k vectors is sub-millisecond; BGE-M3 embedding ~100-200ms via Ollama; total well under 2s |
| CACHE-05 | Cache invalidation on skill file updates | Startup file hashing with crypto.createHash('sha256'); per-skill filter-based deletion via LanceDB `table.delete()` with filter predicate |
| CACHE-06 | Confidence scoring on cached fixes | Weighted formula computed in TypeScript; recency via exponential decay from last_used timestamp |
| CACHE-07 | Graceful degradation -- InfraBrain works without vector store | Try-catch wrapper around all LanceDB operations; cache miss fallback path identical to no-cache path; LanceDB is in-process so failure is rare but handled |
| CACHE-08 | Cache hit explainability -- provenance indicator | Payload stores original incident date, session ID, skill name, similarity score; formatted in pipeline output |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @lancedb/lancedb | ^0.27.x | Embedded vector store | True in-process (NAPI Rust bindings), zero-config, no server needed, proven in production CLI tools |
| ai (Vercel AI SDK) | ^6.0.116 | `embed()` function for BGE-M3 | Already in project; provides unified embedding API |
| @ai-sdk/openai-compatible | ^2.0.35 | OpenAI-compatible provider for embedding model | Already in project; `textEmbeddingModel()` method for BGE-M3 via Ollama |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| node:crypto | built-in | SHA-256 hashing for skill file invalidation | Startup skill hash comparison |
| zod | ^4.3.6 | Config schema extension for cache weights/thresholds | Already in project; extend InfraBrainConfigSchema |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| LanceDB | Qdrant (Docker/binary) | Requires external process management; Docker dependency rejected by user |
| LanceDB | sqlite-vec + better-sqlite3 | Works but no ANN indexing; LanceDB has IVF-PQ for scale; LanceDB API is more natural for vector ops |
| Vercel AI SDK embed() | Direct HTTP POST to /v1/embeddings | SDK handles retries, typing, provider abstraction; raw fetch loses these benefits |

**Installation:**
```bash
npm install @lancedb/lancedb
```

(All other dependencies already present in package.json)

## Architecture Patterns

### Recommended Project Structure
```
src/
├── cache/                    # NEW: Fix caching subsystem
│   ├── lance-store.ts        # LanceDB connection, table management, search, upsert, delete
│   ├── embedder.ts           # BGE-M3 embedding via Vercel AI SDK embed()
│   ├── cache-lookup.ts       # Pipeline-facing cache check + confidence scoring
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

### Pattern 1: LanceDB Embedded Store
**What:** In-process vector store, no server, directory-based persistence
**When to use:** All vector cache operations
**Example:**
```typescript
import * as lancedb from "@lancedb/lancedb";

const CACHE_DIR = "./data/fix-cache";
const TABLE_NAME = "fix_cache";

let _db: lancedb.Connection | null = null;

export async function getCacheDb(): Promise<lancedb.Connection> {
  if (!_db) {
    _db = await lancedb.connect(CACHE_DIR);
  }
  return _db;
}

export async function ensureTable(db: lancedb.Connection): Promise<lancedb.Table> {
  const tableNames = await db.tableNames();
  if (tableNames.includes(TABLE_NAME)) {
    return db.openTable(TABLE_NAME);
  }
  // Create with initial empty schema-defining row (LanceDB requires data to create)
  return db.createEmptyTable(TABLE_NAME, {
    vector: new lancedb.FixedSizeList(1024, new lancedb.Float32()),
    error_signature: new lancedb.Utf8(),
    skill_name: new lancedb.Utf8(),
    fix_plan: new lancedb.Utf8(), // JSON-serialized
    diagnosis: new lancedb.Utf8(),
    session_id: new lancedb.Utf8(),
    created_at: new lancedb.Utf8(),
    last_used: new lancedb.Utf8(),
    hit_count: new lancedb.Int32(),
    success_count: new lancedb.Int32(),
    fail_count: new lancedb.Int32(),
  });
}
```

### Pattern 2: Graceful Degradation Wrapper
**What:** Every LanceDB operation wrapped in try-catch that returns a "cache miss" result on failure
**When to use:** All cache operations -- the cache is an optimization, never a requirement
**Example:**
```typescript
export async function searchCache(
  embedding: number[],
  table: lancedb.Table | null,
): Promise<CacheHit | null> {
  if (!table) return null;
  try {
    const results = await table
      .vectorSearch(embedding)
      .distanceType("cosine")
      .limit(1)
      .toArray();
    if (results.length === 0) return null;
    const row = results[0];
    const similarity = 1 - row._distance; // LanceDB returns distance, not similarity
    if (similarity < 0.75) return null; // Below soft zone floor
    return {
      similarity,
      payload: row as CacheEntryPayload,
    };
  } catch {
    return null; // Graceful degradation
  }
}
```

### Pattern 3: Pipeline Insertion Point
**What:** Cache check inserts between noise filter and diagnosis in runDPEV()
**When to use:** Main pipeline flow
**Example:**
```typescript
// In pipeline.ts runDPEV(), after filterNoise() and contextManager setup,
// before runDiagnosis():
const cacheResult = await searchCache(
  await embedForCache(filteredRaw, prompt),
  cacheTable,
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

### Pattern 4: Embedding Input Formatting
**What:** Concatenate error signature + noise-filtered discovery context for embedding
**When to use:** Both cache write (after successful fix) and cache read (before diagnosis)
**Example:**
```typescript
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

### Pattern 5: Skill-Based Cache Invalidation
**What:** Delete cache entries for skills whose files have changed
**When to use:** On startup, after skill hash comparison
**Example:**
```typescript
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
  table: lancedb.Table,
  skillName: string,
): Promise<void> {
  await table.delete(`skill_name = '${skillName}'`);
}
```

### Anti-Patterns to Avoid
- **Opening LanceDB connection per request:** Use singleton connection. LanceDB is in-process but connection setup has overhead.
- **Embedding the raw (unfiltered) discovery output:** Different noise yields different embeddings for the same error. Always embed post-noise-filter output.
- **Hard-failing on LanceDB errors:** The cache is an optimization. Never throw errors that block the pipeline.
- **Storing the full fix plan as the vector:** The vector should represent the error context, not the fix. The fix goes in the payload columns.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Vector similarity search | Custom cosine similarity over in-memory arrays | LanceDB `table.vectorSearch()` | Handles persistence, indexing at scale, filtering |
| Embedding generation | Manual tokenization + model inference | Vercel AI SDK `embed()` | Handles API protocol, retries, provider abstraction |
| Exponential decay scoring | Reinventing decay formulas | `Math.exp(-lambda * ageDays)` with configurable lambda | Standard formula, just needs a clean implementation |
| Vector storage format | Custom binary file or JSON dump | LanceDB Lance format | Columnar, memory-mapped, efficient for vector ops |

## Common Pitfalls

### Pitfall 1: Embedding Dimension Mismatch
**What goes wrong:** Table created with wrong vector size, inserts fail
**Why it happens:** BGE-M3 produces 1024-dimensional vectors; easy to confuse with other models (384 for MiniLM, 768 for BERT)
**How to avoid:** Hard-code vector size 1024 in table schema; assert embedding length before upsert
**Warning signs:** Dimension mismatch errors from LanceDB

### Pitfall 2: LanceDB Distance vs Similarity
**What goes wrong:** Using distance directly as similarity score (inverted scale)
**Why it happens:** LanceDB returns `_distance` (lower = more similar), but the confidence formula expects similarity (higher = more similar)
**How to avoid:** Convert: `similarity = 1 - distance` for cosine distance
**Warning signs:** High-distance (dissimilar) results treated as cache hits

### Pitfall 3: Stale Embeddings After Noise Filter Changes
**What goes wrong:** Cached entries from before a noise filter update match with wrong similarity because the embedding input format changed
**Why it happens:** Noise filter patterns evolve; same error produces different filtered output over time
**How to avoid:** Include a schema version in cache entries; consider purging on major filter changes
**Warning signs:** High similarity hits that produce wrong fixes

### Pitfall 4: Embedding Model Not Loaded in Ollama
**What goes wrong:** embed() call fails because BGE-M3 isn't pulled in Ollama
**Why it happens:** The model role is configured but the actual model isn't downloaded
**How to avoid:** Check model availability during startup; log a warning if embedding model is not available (degrade gracefully)
**Warning signs:** 404 or model not found errors from Ollama embedding endpoint

### Pitfall 5: Speculative Execution Race Condition
**What goes wrong:** Both cached fix and LLM result modify shared state simultaneously
**Why it happens:** The 0.75-0.85 soft zone runs cache suggestion and LLM in parallel
**How to avoid:** Both paths should produce independent result objects; only the user's choice gets committed. No shared mutable state.
**Warning signs:** Corrupted diagnosis or mixed results

### Pitfall 6: LanceDB Table Schema Evolution
**What goes wrong:** Adding new columns to cache entries breaks existing tables
**Why it happens:** LanceDB uses Arrow schemas; changing schema requires migration
**How to avoid:** Define schema upfront with all needed columns. If schema must change, add migration that recreates table (acceptable for cache — data is ephemeral).
**Warning signs:** Schema mismatch errors on table open

## Code Examples

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
import { randomUUID } from 'node:crypto';

interface CacheEntryPayload {
  id: string;
  error_signature: string;
  skill_name: string;
  fix_plan: string;        // JSON-serialized FixPlan
  diagnosis: string;        // Abbreviated diagnosis text
  session_id: string;
  created_at: string;       // ISO timestamp
  last_used: string;        // ISO timestamp
  hit_count: number;
  success_count: number;
  fail_count: number;
}

async function storeCacheEntry(
  table: lancedb.Table,
  embedding: number[],
  payload: Omit<CacheEntryPayload, 'id'>,
): Promise<void> {
  await table.add([{
    vector: embedding,
    id: randomUUID(),
    ...payload,
  }]);
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
| Qdrant Docker container | LanceDB embedded (in-process) | User decision 2026-04-10 | Zero external dependencies, no Docker/subprocess |
| @qdrant/js-client-rest | @lancedb/lancedb NAPI bindings | User decision 2026-04-10 | True in-process, no network calls |
| Manual embedding HTTP calls | Vercel AI SDK embed() | ai@3.2+ | Unified API, provider abstraction, built-in retries |
| Ollama /api/embeddings | Ollama /v1/embeddings | Ollama 0.1.26+ | OpenAI-compatible endpoint, works with standard SDKs |

## Open Questions

1. **Speculative Execution without Phase 18**
   - What we know: CONTEXT.md says "leverages Phase 18 when available, falls back to sequential"
   - Recommendation: Implement with `Promise.allSettled()` using the existing pipeline. A simple `Promise.allSettled([cachedFixPromise, llmDiagnosisPromise])` works without Phase 18.

2. **Cache Write Timing**
   - What we know: Cache entries are written after a successful fix execution
   - Recommendation: Write cache entry after execution verification passes (circuit breaker success), not just after execution. This ensures only verified fixes enter the cache.

3. **Embedding Model Availability at Startup**
   - What we know: BGE-M3 must be pulled in Ollama before embeddings work
   - Recommendation: Check on startup, log warning if not available, degrade gracefully (cache disabled). Do NOT auto-pull -- respects air-gap and user control.

4. **LanceDB Cache Directory Location**
   - Recommendation: Use `{configDir}/cache/fix-cache/` where configDir follows XDG conventions or is configurable. Not in project dir.

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
| CACHE-01 | LanceDB store init + table management | unit | `npx vitest run tests/cache/lance-store.test.ts -x` | Wave 0 |
| CACHE-02 | BGE-M3 embedding generation | unit | `npx vitest run tests/cache/embedder.test.ts -x` | Wave 0 |
| CACHE-03 | Cache lookup before diagnosis | unit + integration | `npx vitest run tests/cache/cache-lookup.test.ts -x` | Wave 0 |
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
- [ ] Mock LanceDB table for unit tests (in-memory, no disk)
- [ ] Mock embedding function for deterministic test vectors

## Sources

### Primary (HIGH confidence)
- [LanceDB GitHub](https://github.com/lancedb/lancedb) - Architecture, NAPI bindings, platform support
- [LanceDB Docs](https://docs.lancedb.com/) - API reference, table creation, vector search, filtering
- [LanceDB npm](https://www.npmjs.com/package/@lancedb/lancedb) - v0.27.x, platform-specific optional deps
- [Vercel AI SDK embed()](https://ai-sdk.dev/docs/reference/ai-sdk-core/embed) - embed() function signature, return types, usage
- [BGE-M3 on HuggingFace](https://huggingface.co/BAAI/bge-m3) - 1024 dimensions, 8192 token max input, multilingual
- [Ollama OpenAI Compatibility](https://docs.ollama.com/api/openai-compatibility) - /v1/embeddings endpoint support

### Secondary (MEDIUM confidence)
- [LanceDB Review (2026)](https://www.dailyneuraldigest.com/tools-reviews/2026-01-07-lancedb-review/) - Production usage in CLI tools, performance benchmarks
- AnythingLLM and Continue (VS Code) as production references for LanceDB in desktop tools

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - LanceDB verified via official docs and npm; Vercel AI SDK embed() documented; proven in production CLI tools
- Architecture: HIGH - Pipeline insertion point clearly identified in existing code; LanceDB simplifies architecture (no lifecycle management)
- Pitfalls: MEDIUM - Distance vs similarity inversion is well-documented; schema evolution is theoretical but addressed

**Research date:** 2026-04-10
**Valid until:** 2026-05-10 (stable libraries, 30-day window)
