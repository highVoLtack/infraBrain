# Phase 17: MemPalace Semantic Memory - Research

**Researched:** 2026-04-11
**Domain:** Semantic memory, temporal knowledge graph, LLM prompt enrichment
**Confidence:** HIGH

## Summary

Phase 17 adds persistent semantic memory to InfraBrain: every completed incident is auto-filed into LanceDB, entities are extracted into a knowledge graph, and past experience enriches future diagnosis sessions via a 4-layer wake-up context system. The project already has proven LanceDB infrastructure (Phase 16 cache store), BGE-M3 embedding generation, exponential decay confidence scoring, and graceful degradation patterns -- all directly reusable.

The primary technical risks are: (1) LanceDB table design for the entity knowledge graph with temporal validity, (2) the intent classifier for natural language memory queries, and (3) the [MEMORY] block injection into the existing prompt assembly pipeline. All three are solvable with existing patterns -- the CacheStore singleton, OpenAI-compatible LLM calls, and ContextManager prompt building.

**Primary recommendation:** Build three LanceDB tables (incidents, entities, wal) sharing the existing connection singleton pattern. Reuse `generateEmbedding()` for incident vectors, adapt `computeConfidence()` for memory scoring with slower decay lambda, and inject [MEMORY] between [GROUND TRUTH] and [DISCOVERY] in the pipeline prompt.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **Wake-up Context Layers:** L0 Identity (~100 tokens, dynamic from LanceDB metadata), L1 Recent Incidents (~500 tokens, last 3-5 one-liners), L2 Filtered Search (vector search every session, top 3 similar), L3 Deep Semantic (only on cache miss AND weak L2, similarity < 0.7)
- **Injection point:** Dedicated `[MEMORY]` block in LLM prompt between `[GROUND TRUTH]` and `[DISCOVERY]`. L0+L1 pinned (survive compaction), L2+L3 evictable
- **Knowledge Graph:** Separate LanceDB entity table with relationships, temporal `valid_from`/`valid_to`, entity types from ground truth extractor + service/hostname
- **Temporal decay:** Same exponential formula as Phase 16 cache confidence, but with separate (slower) lambda in config.json
- **Wings/Rooms (MEM-08):** Single LanceDB table with `wing` discriminator column, not separate tables
- **Memory Skill Routing:** Intent classification via workerModel (Gemini 1.5 Flash), structured JSON output, LLM-driven natural language time parsing with current date injection
- **Response format:** Flexible, Ink-terminal ready (Chalk/Box anticipation for Phase 19)
- **v2.0 LoRA Readiness:** Entity table MUST include nullable `expert_domain` field

### Claude's Discretion
- Incident auto-filing structure (what exactly gets stored from DPEVResult)
- Write-ahead log (WAL) implementation details for MEM-09
- LanceDB table schemas and index configuration
- Exact entity extraction patterns beyond ground truth extractor
- L2/L3 result formatting before prompt injection

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| MEM-01 | Incident auto-filing after every completed DPEV cycle | DPEVResult + ExecutionResult have all data; file in execute route after cache write pattern |
| MEM-02 | Cross-session semantic search over all past incidents | LanceDB vector search with BGE-M3 embeddings; existing `generateEmbedding()` + `CacheStore.search()` pattern |
| MEM-03 | Temporal Knowledge Graph in LanceDB payload metadata | Entity table with valid_from/valid_to, relationship columns, wing discriminator |
| MEM-04 | 4-layer wake-up context (L0+L1+L2+L3) | L0 from LanceDB metadata counts, L1 from recent query, L2 vector search, L3 entity-based broader search |
| MEM-05 | Memory skill routes "what did we decide" queries | Intent classifier via workerModel with structured JSON output; memory.md skill file |
| MEM-06 | Infrastructure entity detection from diagnostic text | Extend ground-truth.ts extractors with service/hostname patterns |
| MEM-07 | Temporal decay weighting | Adapt `computeConfidence()` with separate slower lambda |
| MEM-08 | Wings/Rooms organizational hierarchy | Single table with `wing` column filter; wing_incidents, wing_config, wing_runbooks, wing_user |
| MEM-09 | Write-ahead log for all memory mutations | JSONL append-only log following AuditLogger pattern |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @lancedb/lancedb | ^0.27.2 | Vector store for incidents + entities + WAL | Already in project, proven in Phase 16 |
| ai | ^6.0.116 | LLM calls for intent classification | Already in project, OpenAI-compatible pattern |
| @ai-sdk/openai-compatible | ^2.0.35 | Provider for workerModel intent classifier | Already in project |
| zod | ^4.3.6 | Schema validation for config, intent classifier output | Already in project |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| (none new) | - | - | All dependencies already installed |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| LanceDB entity table | SQLite for knowledge graph | CONTEXT.md locked: LanceDB is single store for both caching and memory |
| LLM intent classification | Keyword triggers | CONTEXT.md locked: LLM classification for natural language accessibility |

**Installation:**
```bash
# No new dependencies required -- all already installed
```

## Architecture Patterns

### Recommended Project Structure
```
src/
├── memory/                    # NEW: MemPalace semantic memory subsystem
│   ├── types.ts               # Incident, Entity, WAL entry, MemoryConfig types
│   ├── incident-store.ts      # LanceDB store for incidents (mirrors CacheStore pattern)
│   ├── entity-store.ts        # LanceDB store for knowledge graph entities
│   ├── memory-search.ts       # Cross-session semantic search with temporal decay
│   ├── entity-extractor.ts    # Extended entity extraction (service, hostname beyond ground-truth)
│   ├── wake-up.ts             # 4-layer wake-up context builder (L0/L1/L2/L3)
│   ├── intent-classifier.ts   # LLM-based memory query classification
│   ├── wal.ts                 # Write-ahead log for memory mutations
│   └── memory-skill.ts        # Memory query response generation
├── skills/
│   └── memory.md              # NEW: Memory skill file for routing
├── cache/                     # EXISTING: Phase 16 cache (shared LanceDB connection)
├── context/                   # EXISTING: ContextManager gets [MEMORY] block injection
└── orchestrator/              # EXISTING: pipeline.ts gets memory hooks
```

### Pattern 1: Singleton Store per Table (from CacheStore)
**What:** Each LanceDB table gets its own store class with lazy init, promise deduplication, and graceful degradation
**When to use:** For `incident-store.ts` and `entity-store.ts`
**Example:**
```typescript
// Source: src/cache/lance-store.ts (existing pattern)
const _stores = new Map<string, IncidentStore>();

export function getIncidentStore(dataDir: string): IncidentStore {
  if (!_stores.has(dataDir)) {
    _stores.set(dataDir, new IncidentStore(dataDir));
  }
  return _stores.get(dataDir)!;
}

export class IncidentStore {
  private connection: lancedb.Connection | null = null;
  private table: lancedb.Table | null = null;
  private initPromise: Promise<void> | null = null;

  async init(): Promise<void> {
    if (this.connection && this.table) return;
    if (this.initPromise) return this.initPromise;
    this.initPromise = this._doInit();
    return this.initPromise;
  }
  // ... graceful degradation: try-catch returns null/empty, never throws
}
```

### Pattern 2: Shared LanceDB Connection
**What:** All three tables (fix_cache, incidents, entities) share the same LanceDB connection directory
**When to use:** At init time -- IncidentStore and EntityStore connect to same `dataDir` as CacheStore
**Key detail:** LanceDB `connect()` returns a connection to a directory; multiple tables coexist. The stores should share the connection or connect to the same dir.
```typescript
// All stores use the same data directory (e.g., '.infrabrain/memory')
// LanceDB handles multiple tables within one directory
const INCIDENTS_TABLE = 'mem_incidents';
const ENTITIES_TABLE = 'mem_entities';
```

### Pattern 3: Non-blocking Memory Enrichment
**What:** Memory retrieval enriches diagnosis but never gates it. All memory operations wrapped in try-catch returning empty/null on failure.
**When to use:** Every memory operation in the pipeline path
**Key constraint from CONTEXT.md:** "All memory operations are non-blocking -- memory enriches diagnosis but never gates it."
```typescript
// In pipeline.ts -- memory enrichment between cache check and diagnosis
let memoryContext = '';
try {
  memoryContext = await buildWakeUpContext(prompt, config.memory, embeddingParams);
} catch {
  // Memory unavailable -- proceed without enrichment
  if (DEV_MODE) console.log('[MEMORY] Wake-up context failed, proceeding without');
}
```

### Pattern 4: Config-driven Thresholds (from InfraBrainConfig)
**What:** All memory thresholds/weights in the zod config schema under `.memory` section
**When to use:** For decay lambda, similarity thresholds, token budgets, wing configuration
```typescript
// Add to InfraBrainConfigSchemaInner in src/config/types.ts
memory: z.object({
  enabled: z.boolean().default(true),
  dataDir: z.string().default('.infrabrain/memory'),
  decayLambda: z.number().default(0.02),  // Much slower than cache's 0.1
  l2SimilarityThreshold: z.number().default(0.7),
  l2Limit: z.number().default(3),
  tokenBudgets: z.object({
    l0: z.number().default(100),
    l1: z.number().default(500),
    l2l3: z.number().default(1000),
  }).default({}),
}).default({}),
```

### Pattern 5: Intent Classification via Vercel AI SDK
**What:** Use workerModel to classify user prompts as memory/action/combined
**When to use:** In the memory skill routing path
```typescript
// Source: existing openai-compat.ts pattern
import { generateObject } from 'ai';
import { z } from 'zod';

const IntentSchema = z.object({
  type: z.enum(['memory', 'action', 'combined']),
  search_query: z.string(),
  time_range: z.object({
    from: z.string().optional(),
    to: z.string().optional(),
  }).optional(),
  format_hint: z.enum(['list', 'narrative', 'combined']),
});

const result = await generateObject({
  model: workerModel,
  schema: IntentSchema,
  prompt: classifierPrompt,
});
```

### Anti-Patterns to Avoid
- **Separate LanceDB connections per table:** Use shared directory, not separate connections. LanceDB connect() to same dir is efficient.
- **Blocking memory in pipeline:** Never `await` memory operations in the critical diagnosis path without timeout/fallback. Memory is enrichment, not gating.
- **Storing raw DPEVResult as blob:** Extract structured fields. Raw JSON blob prevents vector search and entity queries.
- **Hard-coded entity types:** Use config-driven entity type list so new types (service, hostname) can be added without code changes.
- **Single lambda for cache + memory:** CONTEXT.md explicitly requires separate lambdas. Memory decays much slower (architectural knowledge persists months).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Vector embeddings | Custom embedding code | `generateEmbedding()` from `src/cache/embedder.ts` | BGE-M3 1024-dim, already proven, OpenAI-compatible |
| Confidence scoring | New scoring formula | Adapt `computeConfidence()` from `src/cache/confidence.ts` | Same exponential decay math, just different lambda |
| Entity extraction (base) | New regex extractors | Extend `extractGroundTruth()` from `src/context/ground-truth.ts` | Already extracts containers, IPs, ports, error codes |
| Audit/WAL logging | Custom file writer | Follow `AuditLogger` JSONL append pattern from `src/audit/logger.ts` | Proven append-only pattern with WriteThrough |
| LLM structured output | Manual JSON parsing | `generateObject()` from Vercel AI SDK | Schema validation built in, type-safe |
| Token counting | Character estimation | `countTokens()` from `src/context/token-counter.ts` | Qwen3 BPE accurate counting already available |

**Key insight:** Phase 16 already solved 80% of the infrastructure problems (LanceDB connection management, embedding generation, similarity search, decay scoring, graceful degradation). Phase 17 reuses all of it with domain-specific schemas and an additional memory-specific search layer.

## Common Pitfalls

### Pitfall 1: LanceDB Seed Row Schema Drift
**What goes wrong:** Incident table has more columns than cache table. If seed row misses a column, LanceDB schema inference omits it and later inserts fail.
**Why it happens:** LanceDB infers schema from the first data row (seed-row-then-delete pattern). Missing fields = missing columns.
**How to avoid:** The `_makeSeedRow()` method MUST include every field with correct types. Include `expert_domain: ''` (not null) since LanceDB infers type from first value.
**Warning signs:** "Column not found" errors on insert after table creation.

### Pitfall 2: Vector Dimension Mismatch Between Tables
**What goes wrong:** Incident embeddings use different text formatting than cache embeddings, but same BGE-M3 model. Search results may be unreliable if embedding input format diverges.
**Why it happens:** Cache uses `formatEmbeddingInput()` which prepends "ERROR:" and "CONTEXT:". Incident embedding should use a different format.
**How to avoid:** Create a dedicated `formatIncidentEmbeddingInput()` for incidents. Keep the format consistent: include diagnosis + root cause + service names. Document the format in types.
**Warning signs:** Low similarity scores even for obviously related incidents.

### Pitfall 3: Token Budget Overflow in Wake-up Context
**What goes wrong:** L0+L1+L2+L3 combined exceeds available context window headroom, pushing out discovery data or ground truth.
**Why it happens:** Each layer has a budget but no global cap enforcement. If 3 similar incidents are returned in L2, each summarized at 200 tokens = 600 tokens for L2 alone.
**How to avoid:** Enforce a hard total memory budget. L0+L1 are pinned (fixed ~600 tokens). L2+L3 share a dynamic budget based on remaining headroom after ground truth and discovery. Use `countTokens()` to enforce.
**Warning signs:** Context compaction firing more often after memory is added.

### Pitfall 4: Temporal Decay Lambda Too Aggressive
**What goes wrong:** Incidents from 2 weeks ago score near zero, making memory useless for recurring issues.
**Why it happens:** Using cache lambda (0.1) instead of memory lambda. At lambda=0.1, a 30-day-old incident has recency score of 0.05.
**How to avoid:** Memory lambda should be ~0.02 (at lambda=0.02, 30-day-old incident scores 0.55, 90-day scores 0.17). Verify with the formula: `exp(-lambda * days)`.
**Warning signs:** Only very recent incidents appear in search results despite many stored incidents.

### Pitfall 5: Entity Extraction Regex Collision
**What goes wrong:** Extending ground-truth extractors for service/hostname creates false positives (e.g., "redis" matched in "redistribution").
**Why it happens:** Service name patterns are less strict than IP/port regex. Word boundaries help but don't eliminate all false positives.
**How to avoid:** Use word boundary anchors (`\b`) and maintain a known-services list from config. Cross-reference with ground truth containers (if a container name contains "redis", that's a strong signal).
**Warning signs:** Entity table fills with noise entries that don't correspond to real infrastructure.

### Pitfall 6: WAL Growing Unbounded
**What goes wrong:** JSONL WAL file grows forever since memory mutations happen on every incident.
**Why it happens:** No rotation or cleanup strategy for the append-only log.
**How to avoid:** Implement log rotation by date (daily files) or size (rotate at 10MB). Same pattern as session audit logs.
**Warning signs:** Disk usage growing linearly with incident count.

## Code Examples

### Incident Table Schema (Seed Row)
```typescript
// Source: derived from CacheStore._makeSeedRow() pattern + CONTEXT.md decisions
private _makeIncidentSeedRow(): Record<string, unknown> {
  return {
    id: '__seed__',
    vector: new Array(1024).fill(0),        // BGE-M3 1024-dim
    session_id: '',
    wing: 'wing_incidents',                  // MEM-08 discriminator
    // Incident data
    prompt: '',                              // Original user prompt
    diagnosis: '',                           // LLM diagnosis text
    root_cause: '',                          // From structured diagnosis
    fix_summary: '',                         // From fix plan summary
    outcome: '',                             // 'completed' | 'halted' | 'failed'
    skill_name: '',
    // Temporal
    created_at: new Date().toISOString(),
    // Searchable metadata
    containers: '',                          // JSON array of container names
    services: '',                            // JSON array of detected services
    error_codes: '',                         // JSON array of error codes
    // v2.0 readiness
    expert_domain: '',                       // Nullable: LoRA expert pack mapping
  };
}
```

### Entity Table Schema (Seed Row)
```typescript
// Source: CONTEXT.md knowledge graph decisions
private _makeEntitySeedRow(): Record<string, unknown> {
  return {
    id: '__seed__',
    vector: new Array(1024).fill(0),         // Entity name embedding for search
    entity_type: '',                          // container | port | ip | error_code | service | hostname
    entity_value: '',                         // The actual value (e.g., "redis-master")
    wing: 'wing_incidents',                   // MEM-08 discriminator
    // Relationships
    related_incident_id: '',                  // Foreign key to incidents table
    related_entity_id: '',                    // Entity-to-entity relationship
    relationship_type: '',                    // 'involved_in' | 'runs_on' | 'connects_to' | 'has_port'
    // Temporal validity (MEM-03)
    valid_from: new Date().toISOString(),
    valid_to: '',                             // Empty = still valid
    // v2.0 readiness
    expert_domain: '',                        // LoRA domain mapping
    created_at: new Date().toISOString(),
  };
}
```

### Memory Scoring with Separate Lambda
```typescript
// Source: adapted from src/cache/confidence.ts
const MS_PER_DAY = 86_400_000;

export function computeMemoryScore(
  similarity: number,
  createdAt: string,
  config: { w_sim: number; w_rec: number; decayLambda: number },
): number {
  const ageDays = Math.max(0, (Date.now() - new Date(createdAt).getTime()) / MS_PER_DAY);
  const recencyScore = Math.exp(-config.decayLambda * ageDays);
  return config.w_sim * similarity + config.w_rec * recencyScore;
}

// Default: w_sim=0.6, w_rec=0.4, decayLambda=0.02
// At lambda=0.02: 7 days = 0.87, 30 days = 0.55, 90 days = 0.17
```

### Wake-up Context Assembly
```typescript
// Source: CONTEXT.md L0-L3 layer decisions
export async function buildWakeUpContext(
  currentPrompt: string,
  memoryConfig: MemoryConfig,
  embeddingParams: { baseURL: string; modelId: string },
  incidentStore: IncidentStore,
  entityStore: EntityStore,
): Promise<{ pinned: string; evictable: string }> {
  // L0: Identity (pinned, ~100 tokens)
  const stats = await incidentStore.getStats();  // incident count, domains, success rate
  const l0 = `You have resolved ${stats.totalIncidents} incidents. Top domains: ${stats.topDomains.join(', ')}. Success rate: ${stats.successRate}%.`;

  // L1: Recent incidents (pinned, ~500 tokens)
  const recent = await incidentStore.getRecent(5);
  const l1 = recent.map(i =>
    `[${i.created_at.slice(0,10)}] ${i.skill_name}: ${i.root_cause} -> ${i.outcome}`
  ).join('\n');

  // L2: Filtered search (evictable)
  const embedding = await generateEmbedding(currentPrompt, embeddingParams.baseURL, embeddingParams.modelId);
  let l2 = '';
  if (embedding) {
    const similar = await incidentStore.searchWithDecay(embedding, 3, memoryConfig.decayLambda);
    l2 = similar.map(i =>
      `[Score: ${i.score.toFixed(2)}] ${i.root_cause} (${i.skill_name}, ${i.created_at.slice(0,10)})`
    ).join('\n');
  }

  // L3: Deep semantic (evictable, conditional)
  let l3 = '';
  const l2MaxSim = /* best L2 similarity */ 0;
  if (l2MaxSim < memoryConfig.l2SimilarityThreshold) {
    // Broader entity-based search
    const entities = extractEntitiesFromText(currentPrompt);
    const entityResults = await entityStore.searchByEntities(entities);
    l3 = formatEntitySearchResults(entityResults);
  }

  return {
    pinned: `## Memory\n### Identity\n${l0}\n### Recent\n${l1}`,
    evictable: [l2 && `### Similar Past Incidents\n${l2}`, l3 && `### Related Knowledge\n${l3}`]
      .filter(Boolean).join('\n'),
  };
}
```

### Incident Auto-filing (in execute route)
```typescript
// Source: follows storeFixInCache pattern in src/api/routes/execute.ts line ~202
// After cache write block, add memory filing:
try {
  if (memoryEnabled && result.status === 'completed') {
    const incidentStore = getIncidentStore(memoryDataDir);
    const text = formatIncidentEmbeddingInput(prompt, diagnosis, rootCause);
    const vector = await generateEmbedding(text, embeddingBaseURL, embeddingModelId);
    if (vector) {
      // WAL first, then store
      await walAppend({ type: 'incident_add', sessionId, timestamp: new Date().toISOString() });
      await incidentStore.add({
        session_id: sessionId,
        wing: 'wing_incidents',
        prompt, diagnosis, root_cause: rootCause,
        fix_summary: fixPlan.summary,
        outcome: result.status,
        skill_name: skillName,
        containers: JSON.stringify(containers),
        services: JSON.stringify(detectedServices),
        error_codes: JSON.stringify(errorCodes),
        expert_domain: '',
        created_at: new Date().toISOString(),
      }, vector);

      // Extract and file entities
      const entities = extractEntitiesForGraph(discoveryContext, diagnosis);
      for (const entity of entities) {
        await entityStore.add(entity);
      }
    }
  }
} catch (memErr) {
  if (DEV_MODE) console.error('[MEMORY] Incident filing failed:', memErr);
}
```

### Intent Classifier System Prompt
```typescript
// Source: CONTEXT.md memory skill routing decisions
const CLASSIFIER_SYSTEM_PROMPT = `You are a query classifier for InfraBrain's memory system.
Current date/time: ${new Date().toISOString()}

Classify the user's query:
- "memory": Questions about past incidents, decisions, history (e.g., "Was hatten wir letzte Woche?", "When did this happen before?")
- "action": Requests to diagnose or fix something now (e.g., "Redis is down", "Check nginx logs")
- "combined": Both memory lookup AND action needed (e.g., "We had this before, fix it the same way")

Extract:
- search_query: The semantic search query to find relevant memories
- time_range: Absolute date range (from/to as ISO dates) extracted from natural language
- format_hint: "list" for enumeration queries, "narrative" for analysis, "combined" for complex queries`;
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| No memory between sessions | LanceDB semantic memory with temporal KG | Phase 17 (new) | InfraBrain learns from experience |
| Keyword-based skill routing | LLM intent classification | Phase 17 (new) | Natural language memory queries work |
| Fixed LLM prompts | Dynamic wake-up context from memory | Phase 17 (new) | Each session starts with relevant history |
| No entity tracking | Temporal knowledge graph | Phase 17 (new) | "All incidents involving redis" queries |

**Key architectural change:** The prompt assembly in `pipeline.ts` gains a `[MEMORY]` section between `[GROUND TRUTH]` and `[DISCOVERY]`. This is injected via the `buildWakeUpContext()` function and integrated with `ContextManager` for token budget tracking. L0+L1 are treated as pinned facts (like ground truth), L2+L3 as evictable observations.

## Open Questions

1. **LanceDB connection sharing vs. separate directories**
   - What we know: CacheStore uses `.infrabrain/cache` directory. Memory could use `.infrabrain/memory` or share the cache directory with different table names.
   - What's unclear: Whether sharing one `lancedb.connect()` across cache + memory tables is more efficient than separate connections.
   - Recommendation: Use separate directory (`.infrabrain/memory`) for clean separation. LanceDB connections are lightweight.

2. **Entity embedding strategy**
   - What we know: Incidents get full-text embeddings via BGE-M3. Entities need to be searchable too.
   - What's unclear: Whether embedding just the entity value ("redis-master") produces useful vectors, or if context should be included ("redis-master container running on port 6379").
   - Recommendation: Embed entity value + type + relationship context for richer vectors. Short entity names alone produce poor embeddings.

3. **Incident embedding input format**
   - What we know: Cache uses "ERROR: {prompt}\n\nCONTEXT: {discovery}". Incidents have more data (diagnosis, root cause, fix).
   - What's unclear: Optimal format for incident embeddings that maximizes retrieval quality.
   - Recommendation: Use "INCIDENT: {root_cause}\n\nSERVICES: {services}\n\nDIAGNOSIS: {diagnosis_summary}" -- weighted toward root cause for similarity matching.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (via `vitest run`) |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run tests/memory/ --reporter=verbose` |
| Full suite command | `npx vitest run` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| MEM-01 | Incident auto-filed after DPEV completion | unit | `npx vitest run tests/memory/incident-store.test.ts -t "auto-file"` | Wave 0 |
| MEM-02 | Cross-session semantic search | unit | `npx vitest run tests/memory/memory-search.test.ts -t "semantic search"` | Wave 0 |
| MEM-03 | Temporal knowledge graph entities | unit | `npx vitest run tests/memory/entity-store.test.ts -t "temporal"` | Wave 0 |
| MEM-04 | 4-layer wake-up context | unit | `npx vitest run tests/memory/wake-up.test.ts -t "layers"` | Wave 0 |
| MEM-05 | Memory skill routes queries | unit | `npx vitest run tests/memory/intent-classifier.test.ts -t "classify"` | Wave 0 |
| MEM-06 | Entity detection from diagnostic text | unit | `npx vitest run tests/memory/entity-extractor.test.ts -t "extract"` | Wave 0 |
| MEM-07 | Temporal decay weighting | unit | `npx vitest run tests/memory/memory-search.test.ts -t "decay"` | Wave 0 |
| MEM-08 | Wings/Rooms filtering | unit | `npx vitest run tests/memory/incident-store.test.ts -t "wing"` | Wave 0 |
| MEM-09 | Write-ahead log for mutations | unit | `npx vitest run tests/memory/wal.test.ts -t "append"` | Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run tests/memory/ --reporter=verbose`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/memory/incident-store.test.ts` -- covers MEM-01, MEM-08
- [ ] `tests/memory/entity-store.test.ts` -- covers MEM-03, MEM-06
- [ ] `tests/memory/memory-search.test.ts` -- covers MEM-02, MEM-07
- [ ] `tests/memory/wake-up.test.ts` -- covers MEM-04
- [ ] `tests/memory/intent-classifier.test.ts` -- covers MEM-05
- [ ] `tests/memory/wal.test.ts` -- covers MEM-09
- [ ] `tests/memory/entity-extractor.test.ts` -- covers MEM-06

## Sources

### Primary (HIGH confidence)
- Project codebase: `src/cache/lance-store.ts`, `src/cache/confidence.ts`, `src/cache/embedder.ts` -- proven LanceDB patterns
- Project codebase: `src/context/ground-truth.ts`, `src/context/context-manager.ts` -- entity extraction and context assembly
- Project codebase: `src/config/types.ts` -- zod config schema pattern
- Project codebase: `src/audit/logger.ts` -- JSONL append-only audit pattern
- CONTEXT.md: All locked decisions on wake-up layers, knowledge graph, temporal decay, wings

### Secondary (MEDIUM confidence)
- LanceDB @lancedb/lancedb v0.27.2: Table creation via seed-row-then-delete, cosine vector search, SQL-like filter expressions -- verified via existing project usage

### Tertiary (LOW confidence)
- Entity embedding quality for short entity names -- needs validation during implementation

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries already in project and proven in Phase 16
- Architecture: HIGH -- follows established patterns (CacheStore, AuditLogger, ContextManager) with domain-specific extensions
- Pitfalls: HIGH -- identified from direct code analysis of Phase 16 implementation and CONTEXT.md constraints
- Integration points: HIGH -- exact file paths and line numbers identified in existing codebase

**Research date:** 2026-04-11
**Valid until:** 2026-05-11 (stable -- all dependencies pinned, internal architecture)
