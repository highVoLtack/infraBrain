# Architecture: v1.3 Intelligence Layer Integration

**Domain:** AI IT Operations Platform -- 6 new feature areas integrating with existing DPEV engine
**Researched:** 2026-03-31
**Overall confidence:** MEDIUM-HIGH

## Current Architecture Baseline

```
index.ts (bootstrap)
  |
  +-- loadConfig() -> InfraBrainConfig (Zod-validated)
  +-- createModelRegistry() -> ModelRegistry (7 roles, per-role baseURL)
  +-- createProvider() -> LLMProvider (wraps registry)
  +-- SkillRegistry.populate() -> loads Markdown skill files
  +-- createServer(deps) -> Express app on :3000
  |     |
  |     +-- POST /debug   (DPEV orchestration: triage -> discovery -> diagnosis -> plan)
  |     +-- POST /execute (executor: lock -> snapshot -> approve -> run -> verify)
  |     +-- GET  /health, /status, /history, /resume
  |
  +-- registerCommands() -> Commander.js program
  +-- startRepl() -> readline loop, routes /infra:* to Commander
        |
        Commander actions call fetch() to Express routes internally
```

Key files by size and role:
- `src/api/routes/debug.ts` -- ~686 lines (DPEV orchestration, the heart of the system)
- `src/cli/commands.ts` -- 654 lines (Commander.js command definitions)
- `src/cli/formatter.ts` -- 502 lines (chalk-based output formatting)
- `src/execution/executor.ts` -- ~466 lines (fix plan execution with safety pipeline)
- `src/cli/repl.ts` -- 171 lines (readline-based REPL loop)
- `src/cli/approval.ts` -- 125 lines (readline-based approval prompts)

Key architectural facts:
- **Single execution path**: ALL operations flow through Express REST API, even from CLI
- **Discovery runs sequentially**: `runDiscovery()` loops with `for...of` over skill commands
- **Executor is serial**: Steps run one-at-a-time with snapshot/approve/run/rollback gates
- **AI SDK**: Uses `@ai-sdk/openai-compatible` with `generateText` / `generateObject` from `ai`
- **RollingContext**: Already does token-aware compression of step history (80% budget threshold)

---

## v1.3 Architecture (Target)

```
CLI Layer (Commander.js args -> Ink/React renderer)
    | HTTP fetch() + SSE
API Server (Express 5, REST routes + SSE streaming endpoints)
    |
Orchestrator (router.ts -> context.ts -> planner.ts -> parallel-pipeline.ts)
    |                                                       |
    |                                             MemPalace (MCP sidecar)
    |                                             via stdio / JSON-RPC 2.0
Execution Engine (executor.ts -> self-healer.ts -> runner.ts)
    |
Safety Layer (circuit-breaker, damage-budget, rollback, locks) -- UNCHANGED
    |
State & Persistence (SQLite + .infrabrain/ files) -- UNCHANGED
    |
LLM Abstraction (openai-compat.ts -> ModelRegistry, 7 roles)
    |                   |
    |         Auto-Compact (context manager middleware)
    |
Vector Cache (Qdrant Docker -> @qdrant/js-client-rest)
```

---

## Feature 1: Ink/React Terminal Renderer

### What Changes

Replace `repl.ts` (readline) and `formatter.ts` (chalk) with Ink components. The Express API stays -- CLI still calls API. This is a **rendering layer swap**, not an architecture change.

### Component-Level Integration

| Existing Component | Action | Rationale |
|-----------|--------|-----------|
| `src/cli/repl.ts` | **REPLACED** by `src/ui/layouts/ReplLayout.tsx` | Ink owns the terminal |
| `src/cli/formatter.ts` | **DEPRECATED** -> formatting moves into Ink components | Chalk inside Ink causes double-escaped ANSI |
| `src/cli/commands.ts` | **MODIFY** | Keep Commander.js for one-shot/arg parsing; each action calls `render(<Component>)` |
| `src/cli/approval.ts` | **REPLACED** by `src/ui/components/ApprovalPrompt.tsx` | Ink handles keyboard input |
| `src/api/server.ts` | **NO CHANGE** | Express keeps serving REST; Ink fetches from it |
| `src/index.ts` | **MODIFY** | Conditional: one-shot = Commander, interactive = `render(<App />)` |

### New Components

```
src/ui/                          # NEW directory
  App.tsx                        # Root Ink component, manages app state
  components/
    DPEVTracker.tsx              # Live phase indicator (D->P->E->V with timing)
    DiagnosisView.tsx            # Structured diagnosis table
    ApprovalPrompt.tsx           # Interactive approval (replaces approval.ts)
    ExecutionStream.tsx          # Step-by-step execution with live output
    HealthDashboard.tsx          # Backend status, model inventory
    SessionBrowser.tsx           # History viewer
    Spinner.tsx                  # Replaces createSpinner() in commands.ts
  hooks/
    useApi.ts                    # fetch() wrapper to Express REST API
    useStreaming.ts              # SSE subscription for live DPEV progress
    useApproval.ts               # Keyboard input handling for Y/N/typed confirmation
  layouts/
    ReplLayout.tsx               # Main REPL shell (input + output)
    DebugLayout.tsx              # Debug session view (DPEV tracker + output)
  theme.ts                       # Color palette, spacing constants
```

### Architecture Decision: Express API Stays

The CLI-calls-API pattern is correct and must not change. Reasons:
1. **API-first**: Future web UI, integrations, CI/CD all use same API
2. **Testing**: API routes have independent test coverage (620+ tests)
3. **Separation**: UI rendering vs business logic stay decoupled
4. **Streaming**: Add SSE endpoints to Express for live DPEV progress (Ink subscribes)

### SSE Endpoints Needed

| Endpoint | Purpose |
|----------|---------|
| `GET /debug/stream?sessionId=xxx` (SSE) | Stream DPEV phases, discovery output, diagnosis in real-time |
| `GET /execute/stream?sessionId=xxx` (SSE) | Stream step execution progress, self-heal attempts |

The current POST /debug returns a monolithic JSON response after DPEV completes. For live UI, add Server-Sent Events endpoints that emit phase transitions as they happen. The existing POST endpoints remain for one-shot/`--json` mode.

```typescript
// Events emitted:
// { phase: 'triage', data: { skill: 'linux-expert', reasoning: '...' } }
// { phase: 'discovery', data: { label: 'Running containers', output: '...' } }
// { phase: 'diagnosis', data: { rootCause: '...', structuredDiagnosis: {...} } }
// { phase: 'plan', data: { fixPlan: {...} } }
```

### CI/Non-interactive Fallback

```typescript
if (process.env.CI || flags.json) {
  // Use existing JSON envelope, no Ink
} else {
  render(<DebugView ... />);
}
```

### Ink + Express Coexistence

Ink runs in the same Node.js process as Express. This works because:
- Ink uses `yoga-layout` for terminal rendering (no DOM, no browser)
- Ink intercepts `console.log` to render above the UI (no interference with Express logs)
- Express listens on a port; Ink writes to stdout. No conflict.

**Confidence: HIGH** -- Claude Code, Warp, and other production AI CLI tools run Ink + background services in one process.

### Incremental Migration Path

Don't rewrite all 502 lines of `formatter.ts` at once. Start with `DPEVTracker` (highest-value component), then migrate commands one by one. Old chalk formatting can coexist with Ink during transition.

---

## Feature 2: Qdrant Fix-Caching

### What Changes

New `src/cache/` module that intercepts the DPEV pipeline. Before running full LLM diagnosis, check if a similar error pattern already has a cached fix. If yes, skip diagnosis entirely and return the cached plan (~2s vs ~113s).

### Component-Level Integration

| Existing Component | Action | Rationale |
|-----------|--------|-----------|
| `src/api/routes/debug.ts` | **MODIFY** | Cache-check BEFORE DPEV, cache-write AFTER successful fix |
| `src/execution/executor.ts` | **MODIFY** | After successful execution+verification, trigger cache write |
| `src/config/types.ts` | **MODIFY** | Add `fixCache` config section |
| `src/api/server.ts` | **MODIFY** | Initialize Qdrant on startup (background, non-blocking) |
| `src/index.ts` | **MODIFY** | Create QdrantClient, pass to server deps |

### New Components

```
src/cache/
  qdrant-client.ts               # Qdrant connection manager (wraps @qdrant/js-client-rest)
  embedder.ts                    # Generate embeddings via ModelRegistry 'embedding' role (bge-m3)
  fix-cache.ts                   # Core: search similar errors, store fix results
  docker-lifecycle.ts            # Auto-start/health-check Qdrant container
  types.ts                       # CacheEntry, CacheSearchResult, CacheConfig
```

### Data Flow

```
POST /debug (prompt arrives)
  |
  1. Skill selection (triage) -- unchanged
  2. Discovery -- unchanged
  3. ** NEW: Cache lookup **
  |    embedder.embed(prompt + discoveryContext)
  |    fixCache.search(embedding, threshold: 0.92)
  |    if (hit && hit.score > threshold):
  |      return cached fixPlan (skip diagnosis+plan LLM calls)
  |      log "[CACHE HIT] Returning cached fix in {N}ms"
  |
  4. Diagnosis (LLM) -- only if cache miss
  5. Plan generation -- only if cache miss
  6. ** NEW: Cache write (deferred) **
  |    After executor reports success + verification passes:
  |    fixCache.store(embedding, fixPlan, metadata)
```

### Qdrant Deployment Model

Qdrant does NOT have an embedded/in-process mode for Node.js (only Python has local mode via `qdrant-client`). For InfraBrain:

- **Default**: Run Qdrant as a Docker container (`docker run -d -p 6333:6333 -v ./data/qdrant:/qdrant/storage qdrant/qdrant`)
- **Auto-lifecycle**: `docker-lifecycle.ts` checks health, auto-starts container if missing
- **Config**: `fixCache.qdrantPort: 6333` in config.json
- **Graceful degradation**: If Qdrant is unreachable, skip caching silently. Cache is an optimization, not a requirement.

### Cache Schema (Qdrant Collection)

```
Collection: "fix_cache"
Vector dimension: 1024 (BGE-M3 output)
Payload: {
  errorPattern: string,      // Original error description
  skillName: string,         // Which skill resolved it
  fixPlan: FixPlan,          // The complete fix plan (JSON)
  target: string,            // Target system type
  successRate: number,       // How often this fix works (updated over time)
  createdAt: string,
  lastUsedAt: string,
  usageCount: number,
}
```

### Embedding Strategy

Use the existing `embedding` role in ModelRegistry (bge-m3 already provisioned):
```typescript
import { embed } from 'ai';
const { embedding } = await embed({
  model: registry.get('embedding'),
  value: `${prompt}\n${discoveryContext}`
});
```

### Cache Invalidation

Cache entries include skill version hash. Stale entries degrade gracefully (lower similarity score), expire after 30 days. No eager invalidation on skill changes -- too aggressive.

**Confidence: HIGH** -- Qdrant JS client is stable, bge-m3 is already provisioned, AI SDK has `embed()`.

---

## Feature 3: Auto-Compact Context Management

### What Changes

New `src/context/` module that monitors token usage across the DPEV pipeline and automatically summarizes/compacts when approaching model context limits. Critical for local models with 32K context windows.

### Component-Level Integration

| Existing Component | Action | Rationale |
|-----------|--------|-----------|
| `src/execution/context-builder.ts` | **MODIFY** | Extend RollingContext with LLM-based compaction |
| `src/llm/token-budget.ts` | **MODIFY** | Add window-aware threshold (83% trigger) |
| `src/api/routes/debug.ts` | **MODIFY** | Wrap prompt building with context manager |
| `src/config/types.ts` | **MODIFY** | Add `contextWindow` per model role in ModelMap |

### New Components

```
src/context/
  manager.ts                     # ContextManager: tracks token usage, triggers compaction
  compactor.ts                   # Summarize old context using worker model (7B)
  token-counter.ts               # Fast token estimation (progressive sampling for large inputs)
  types.ts                       # CompactionResult, ContextBudget
```

### Three-Tier Compaction Design

```
Tier 1 (existing): RollingContext compresses step outputs within a fix plan (80% budget)
Tier 2 (new):      Session-level compaction across DPEV phases
Tier 3 (new):      Cross-session compaction for resumed sessions
```

**Tier 2 detail:** When total messages approach 83% of model's context window (e.g., ~27K of 32K tokens for Qwen 32B):

1. Summarize Discovery findings into key facts (container names, IPs, error patterns)
2. Preserve Diagnosis root cause and structured diagnosis
3. Compress Plan to step list without full reasoning
4. Keep last 2 execution step results in full (same pattern as existing RollingContext)

### Token Budget for 32K Context

```
System prompt + skill instructions:  6.4K tokens (20%)
Current turn (user + assistant):     9.6K tokens (30%)
Conversation history:               16.0K tokens (50%)
  - Compaction trigger at:          12.8K tokens (80% of history budget)
  - Compact oldest 50% into:        2.0K token summary via worker model
```

### Where Summarization Lives

`compactor.ts` uses the `worker` model (7B, fast) for summarization:
```typescript
import { generateText } from 'ai';

async function compactContext(
  messages: Message[],
  workerModel: LanguageModel,
  preserveRecent: number = 2
): Promise<CompactionResult> {
  // Keep last N messages verbatim
  // Summarize older messages via worker model
  // Return compacted message array + summary
}
```

### Context Window Per Model

Extend ModelMapEntry:
```json
{
  "modelMap": {
    "default": { "model": "infrabrain", "baseUrl": "...", "contextWindow": 32768 },
    "worker": { "model": "qwen2.5-coder:7b", "baseUrl": "...", "contextWindow": 32768 },
    "forensic": { "model": "deepseek-r1:32b", "baseUrl": "...", "contextWindow": 65536 }
  }
}
```

**Confidence: HIGH** -- RollingContext already does primitive compaction. This extends it with LLM summarization and window-aware thresholds. Well-understood pattern (Claude Code uses identical approach at 83% threshold).

---

## Feature 4: Tool Concurrency (Parallel Discovery)

### What Changes

Discovery commands currently run sequentially in a `for...of` loop in `runDiscovery()`. Change to `Promise.all()` for read-only discovery commands. Execution steps remain serial (safety gates require sequential approval).

### Component-Level Integration

| Existing Component | Action | Rationale |
|-----------|--------|-----------|
| `src/api/routes/debug.ts` | **MODIFY** | `runDiscovery()` uses Promise.all instead of sequential loop |
| `src/execution/executor.ts` | **NO CHANGE** | Execution MUST stay serial (lock -> snapshot -> approve -> run) |
| `src/safety/classifier.ts` | **MODIFY** (optional) | Add `isConcurrencySafe()` as defense-in-depth |

### Implementation

The change is surgical -- only `runDiscovery()` needs modification:

```typescript
// BEFORE (v1.2): Sequential
async function runDiscovery(skill: SkillFile) {
  for (const { command, label } of commands) {
    const result = await runCommand(command);  // one at a time
    results[label] = result;
  }
}

// AFTER (v1.3): Parallel with safety gate
async function runDiscovery(skill: SkillFile) {
  const promises = commands.map(async ({ command, label }) => {
    const result = needsShell(command)
      ? await runShellCommand(command, { timeout: 15_000 })
      : await runCommand(...parseCommand(command), { timeout: 10_000 });
    return { label, result };
  });
  const resolved = await Promise.all(promises);
  for (const { label, result } of resolved) {
    results[label] = result.stdout.trim() || result.stderr.trim() || '(empty)';
  }
}
```

### Data Flow Change

```
Before: discovery1 -> discovery2 -> discovery3 -> diagnosis (total: sum of latencies)
After:  discovery1 -+
        discovery2 -+-> all complete -> diagnosis (total: max of latencies)
        discovery3 -+
```

For a typical 3-command discovery (~2-3s each), reduces from ~8s to ~3s.

### What Stays Serial (Non-Negotiable)

Everything in `executePlan()`:
- Lock acquisition, snapshot before each step, human approval per step, command execution, damage budget check, rolling context update, persistence verification

This is not a limitation -- it is a safety requirement.

**Confidence: HIGH** -- 20-line change in one function. Promise.all on independent read-only commands. No architectural risk.

---

## Feature 5: Parallel Inference Pipeline

### What Changes

During DPEV, run lightweight models (7B worker) in parallel with heavyweight models (32B default). While the 32B model reasons about diagnosis, the 7B model pre-processes logs and classifies error patterns.

### Component-Level Integration

| Existing Component | Action | Rationale |
|-----------|--------|-----------|
| `src/api/routes/debug.ts` | **MODIFY** | Orchestrate parallel LLM calls during DPEV phases |
| `src/llm/openai-compat.ts` | **NO CHANGE** | Already supports multiple providers with different baseURLs |
| `src/llm/types.ts` | **MODIFY** | Add `ParallelTask` type |

### How AI SDK Handles Concurrent Calls

`generateText` and `generateObject` return Promises. Parallel inference is `Promise.allSettled()`:

```typescript
const [diagnosis, logSummary, cacheEmbedding] = await Promise.allSettled([
  // 32B default: full diagnosis
  generateObject({
    model: registry.get('default'),
    schema: StructuredDiagnosisSchema,
    prompt: enrichedPrompt,
    system: systemPrompt,
  }),
  // 7B worker: pre-process logs
  generateText({
    model: registry.get('worker'),
    prompt: `Summarize error patterns:\n${discoveryRaw['Recent logs']}`,
  }),
  // bge-m3: generate embedding for cache
  embed({
    model: registry.get('embedding'),
    value: prompt,
  }),
]);
```

Use `Promise.allSettled` (not `Promise.all`) because if pre-processing fails, the main diagnosis can still proceed.

### Parallelization Opportunities by DPEV Phase

| Phase | Parallel Tasks | Models |
|-------|---------------|--------|
| Discovery | All discovery commands + cache embedding | runner + embedding |
| Diagnosis | Main diagnosis + log pre-filtering + memory recall | default + worker + embedding |
| Plan | Sequential (needs diagnosis output) | default |
| Execution | Step run + next step context prep (limited) | runner + worker |

### New Component

```
src/llm/
  parallel.ts                    # ParallelInference: orchestrate concurrent model calls
```

```typescript
interface ParallelTask<T> {
  name: string;
  execute: () => Promise<T>;
  required: boolean;  // If false, failure doesn't abort pipeline
  timeoutMs?: number;
}

async function runParallel<T>(tasks: ParallelTask<T>[]): Promise<Map<string, T | Error>> {
  const results = await Promise.allSettled(
    tasks.map(t => withTimeout(t.execute(), t.timeoutMs ?? 30000))
  );
  // Required tasks that failed -> throw
  // Optional tasks that failed -> log warning, return Error in map
}
```

### Backend Isolation Requirement

Parallel inference requires that models run on SEPARATE backends or that the backend handles concurrent requests:
- **vLLM**: Handles concurrent requests natively (batched inference) -- preferred
- **Ollama**: Sequential by default. Multiple concurrent requests queue.

The existing `ModelMap` already supports per-role `baseUrl`, so routing to different backends is already wired:

```json
{
  "modelMap": {
    "default": { "model": "infrabrain", "baseUrl": "http://gpu1:11434/v1" },
    "worker": { "model": "qwen2.5-coder:7b", "baseUrl": "http://gpu2:11434/v1" },
    "embedding": { "model": "bge-m3", "baseUrl": "http://gpu2:11434/v1" }
  }
}
```

**Confidence: MEDIUM** -- AI SDK supports this trivially via Promise.allSettled. The real constraint is the backend: Ollama serializes per model, vLLM batches natively. Per-role baseUrl config already exists.

---

## Feature 6: MemPalace Semantic Memory

### What Changes

New `src/memory/` module acts as an MCP client to a MemPalace sidecar. After DPEV completes, auto-files learnings. Before diagnosis, recalls relevant past experiences.

### Component-Level Integration

| Existing Component | Action | Rationale |
|-----------|--------|-----------|
| `src/api/routes/debug.ts` | **MODIFY** | recall() BEFORE diagnosis, store() AFTER successful fix |
| `src/execution/executor.ts` | **MODIFY** | store() outcome (success/failure/rollback) post-execution |
| `src/orchestrator/context.ts` | **MODIFY** | Inject recalled memories into LLM system prompt |
| `src/config/types.ts` | **MODIFY** | Add `mempalace` config section |
| `src/index.ts` | **MODIFY** | Initialize MCP client, pass to server deps |
| `skills/` | **ADD** | New `memory-recall.md` skill (optional) |

### New Components

```
src/memory/
  mcp-client.ts                  # MCP client using @modelcontextprotocol/sdk
  mempalace-lifecycle.ts         # Spawn/restart/shutdown sidecar process
  auto-filer.ts                  # Hooks into DPEV lifecycle, auto-files learnings
  recall.ts                      # Query memories relevant to current diagnosis
  types.ts                       # MemoryEntry, RecallResult, MemPalaceConfig
```

### MCP Transport Decision: stdio

Use **stdio transport** (MemPalace runs as a child process):
- Single client (InfraBrain is the only consumer)
- No network config needed
- Starts/stops with InfraBrain process
- Aligns with local/on-premise constraint

```typescript
import { Client } from '@modelcontextprotocol/sdk/client';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio';

const transport = new StdioClientTransport({
  command: 'mempalace-server',  // or 'python -m mempalace.mcp_server'
  args: ['--storage', '.infrabrain/memory']
});
const client = new Client({ name: 'infrabrain', version: '1.3.0' });
await client.connect(transport);
```

### Memory Integration Points

| Event | Action | Timing |
|-------|--------|--------|
| Before diagnosis | `recall(errorDescription)` -- fetch relevant past fixes | Synchronous (blocks diagnosis, enriches context) |
| After successful fix | `store(fixSummary + metadata)` -- save for future recall | Async (fire-and-forget) |
| After failed fix | `store(failureReport)` -- learn what does NOT work | Async (fire-and-forget) |
| Session start | `recall(targetDescription)` -- fetch infrastructure context | Synchronous (enriches initial context) |

### Memory Injection into LLM Prompt

In `src/orchestrator/context.ts`:
```typescript
const memories = await recall.search(prompt, { limit: 3, timeoutMs: 5000 });
if (memories.length > 0) {
  systemPrompt += `\n\n--- PAST EXPERIENCES ---\n${formatMemories(memories)}\n--- END PAST EXPERIENCES ---`;
}
```

### Qdrant Sharing Strategy

Fix-cache and MemPalace both need vector storage. Two approaches:

**Recommended: Separate concerns**
- Fix-cache = direct `@qdrant/js-client-rest` calls, `fix_cache` collection
- MemPalace = MCP server manages its own storage (may use Qdrant, ChromaDB, or SQLite internally)
- If MemPalace uses Qdrant, point it at the same instance, different collection

**Why not route fix-cache through MemPalace MCP?**
Fix-cache is a simple embedding lookup. Adding MCP overhead (JSON-RPC round-trip, process boundary) for a hot-path optimization is unnecessary complexity.

### Config Extension

```typescript
mempalace: {
  enabled: true,
  command: 'python',
  args: ['-m', 'mempalace.mcp_server'],
  vaultDir: '.infrabrain/mempalace',
  startupTimeoutMs: 10000,
  recallTimeoutMs: 5000,
}
```

**Graceful degradation:** If Python is not installed, MemPalace fails to start, or recall times out, InfraBrain continues without semantic memory. All calls wrapped in try/catch.

**Confidence: MEDIUM** -- MCP SDK is stable. MemPalace server implementation details (ChromaDB vs Qdrant, Python dependency) affect integration complexity. Auto-filing hooks are straightforward.

---

## Integrated Data Flow: v1.3 DPEV Pipeline

```
User types command in Ink UI (or one-shot CLI)
  |
  Ink <App> calls fetch() to Express API (or Commander calls directly)
  |
  POST /debug (prompt)
  |
  1. Triage (skill selection) -- unchanged
  |
  2. PARALLEL: [                             // Features 4 + 5
       Discovery commands (Promise.all),      // Tool concurrency
       Cache embedding generation,            // Fix-caching prep
       Memory recall query                    // MemPalace recall
     ]
  |
  3. Cache check (Qdrant similarity search)   // Feature 2
     |
     if HIT (score > 0.92) -> return cached fixPlan (skip steps 4-5)
     |
  4. Context budget check                     // Feature 3
     |  if > 83% window: compact via worker model
     |
  5. PARALLEL: [                              // Feature 5
       Diagnosis (32B default model),
       Log pre-processing (7B worker model)
     ]
     |  Merge: inject log summary into diagnosis
     |
  6. Plan generation -- sequential (needs diagnosis output)
  |
  7. Stream results via SSE to Ink UI         // Feature 1
  |
  POST /execute (fixPlan)
  |
  8. Serial execution (unchanged safety gates)
  |
  9. POST-EXECUTION HOOKS (async): [
       Cache write (if execution succeeded),   // Feature 2
       Memory auto-file (diagnosis + outcome)  // Feature 6
     ]
```

---

## Component Boundaries Summary

### New Directories

| Directory | Purpose | Key Dependencies |
|-----------|---------|-----------------|
| `src/ui/` | Ink/React terminal components | `ink`, `@inkjs/ui`, Express API |
| `src/cache/` | Qdrant fix-caching | `@qdrant/js-client-rest`, `ai` (embed) |
| `src/memory/` | MemPalace MCP sidecar | `@modelcontextprotocol/sdk` |
| `src/context/` | Auto-compact context management | `src/llm/token-budget.ts` |

### Hot Path: Files Modified by Multiple Features

| File | Features Touching It |
|------|---------------------|
| `src/api/routes/debug.ts` | Cache lookup (2), memory recall (6), parallel discovery (4), parallel inference (5), SSE streaming (1), context compaction (3) |
| `src/index.ts` | Ink render (1), Qdrant init (2), MCP client init (6) |
| `src/execution/executor.ts` | Cache write (2), memory auto-file (6) |
| `src/config/types.ts` | All features add config sections |

**Risk: debug.ts contention.** This 686-line file is the integration nexus. Consider extracting DPEV pipeline into `src/orchestrator/pipeline.ts` to reduce modification surface.

### Unchanged Core (Safety-Critical)

| Directory | Why Unchanged |
|-----------|---------------|
| `src/safety/` | Safety gates are serial by design. No feature changes them. |
| `src/skills/` | Skill files and registry unchanged. New skills are additive. |
| `src/state/` | SQLite + file storage unchanged. MemPalace is separate from operational state. |
| `src/locks/` | Lock system unchanged. |
| `src/audit/` | Audit logging unchanged (new events are additive). |

---

## Suggested Build Order

Dependencies between the 6 features determine build order:

```
Phase 1: Tool Concurrency (Feature 4)
  - No external dependencies
  - 20-line change in runDiscovery()
  - Immediate performance win (discovery 2-5x faster)
  - Testable in isolation with current CLI + test suite

Phase 2: Auto-Compact (Feature 3)
  - No external dependencies
  - Extends existing RollingContext + token-budget
  - Foundation: all other features benefit from context management
  - Required before parallel inference (more concurrent context = needs compaction)

Phase 3: Parallel Inference (Feature 5)
  - Benefits from Phase 2 context management
  - Requires: vLLM backend or multiple Ollama instances for true parallelism
  - New src/llm/parallel.ts module

Phase 4: Qdrant Fix-Caching (Feature 2)
  - Depends on: Qdrant Docker container
  - Depends on: embedding model (already wired -- bge-m3 in registry)
  - New src/cache/ module
  - Proves vector infrastructure before MemPalace

Phase 5: MemPalace Sidecar (Feature 6)
  - Depends on: MCP server implementation (Python sidecar)
  - May share Qdrant instance with fix-cache
  - New src/memory/ module + auto-filing hooks

Phase 6: Ink/React Terminal UI (Feature 1)
  - Depends on: SSE endpoints (can be added incrementally in earlier phases)
  - Largest surface area change (new src/ui/ directory, delete repl.ts + formatter.ts)
  - Build LAST so all backend features are stable before UI wraps them
```

### Rationale

1. **Quick wins first**: Tool concurrency is trivial, measurable, zero risk
2. **Foundation before complexity**: Auto-compact protects against context overflow before parallel inference
3. **Prove infrastructure incrementally**: Direct Qdrant (fix-cache) before MCP-mediated Qdrant (MemPalace)
4. **Backend before frontend**: All data pipeline features before UI. Building UI over shifting APIs causes churn.
5. **UI last**: Ink components need stable APIs. Once backend is stable, UI is a rendering exercise.

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Ink Bypassing Express API
**What:** Having Ink components import orchestrator/executor directly
**Why bad:** Breaks API-first architecture. Makes future web UI impossible. Duplicates validation.
**Instead:** Ink calls Express REST/SSE endpoints only. All logic stays behind the API.

### Anti-Pattern 2: Blocking Startup on External Services
**What:** Making InfraBrain startup wait for Qdrant or MemPalace initialization
**Why bad:** First run takes 30+ seconds. Breaks the "instant CLI" feel.
**Instead:** Start both in background. Features unavailable for first few seconds. Never block the main DPEV path.

### Anti-Pattern 3: Synchronous Cache Write in Response Path
**What:** Writing to fix-cache before returning the debug response
**Why bad:** Adds latency to every request.
**Instead:** Deferred cache write: store embedding + plan after executor reports success.

### Anti-Pattern 4: Routing Fix-Cache Through MemPalace MCP
**What:** Using MCP as the interface for simple embedding lookups
**Why bad:** Adds JSON-RPC overhead, process boundary hop, timeout risk on a hot path
**Instead:** Fix-cache uses Qdrant client directly. MemPalace uses MCP for richer semantic operations.

### Anti-Pattern 5: Parallelizing Write Commands
**What:** Running write/destructive commands in parallel for speed
**Why bad:** Race conditions on shared state. Violates safety guarantees.
**Instead:** Only READ-risk commands run in parallel. Write commands always serial with approval gates.

### Anti-Pattern 6: Multiple MemPalace Instances
**What:** Spawning a new MemPalace process per DPEV session or per command
**Why bad:** Database locking errors. Data corruption risk.
**Instead:** Single MemPalace sidecar process for the entire InfraBrain lifecycle.

### Anti-Pattern 7: Chalk Inside Ink Components
**What:** Using `chalk.red()` inside Ink `<Text>` components
**Why bad:** Double-escaped ANSI codes. Garbled output.
**Instead:** Use Ink's `<Text color="red">`. Keep Chalk for non-Ink paths only.

---

## Sources

- [Ink GitHub - React for interactive CLIs](https://github.com/vadimdemedes/ink)
- [Ink UI components library](https://github.com/vadimdemedes/ink-ui)
- [Claude Code TUI architecture (Ink-based)](https://deepwiki.com/mehmoodosman/claude-code/8.2-core-ui-components)
- [TypeScript conquering AI agent TUIs (Feb 2026)](https://thamizhelango.medium.com/from-browser-to-terminal-how-typescript-the-webs-darling-quietly-conquered-the-ai-agent-tui-d93a4eda62a5)
- [oclif + Ink framework comparison (Mar 2026)](https://levelup.gitconnected.com/oclif-ink-rust-and-the-framework-decision-that-shapes-everything-13f2c18539ec)
- [Qdrant JS client](https://github.com/qdrant/qdrant-js)
- [Qdrant Edge for embedded AI](https://qdrant.tech/blog/qdrant-edge/)
- [Qdrant quickstart / Docker deployment](https://qdrant.tech/documentation/quickstart/)
- [Qdrant installation docs](https://qdrant.tech/documentation/guides/installation/)
- [AI SDK generateText reference](https://ai-sdk.dev/docs/reference/ai-sdk-core/generate-text)
- [AI SDK workflow patterns (parallel)](https://ai-sdk.dev/docs/agents/workflows)
- [AI SDK parallel tool calls cookbook](https://ai-sdk.dev/cookbook/node/call-tools-in-parallel)
- [AI SDK provider management](https://ai-sdk.dev/docs/ai-sdk-core/provider-management)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [MCP Specification 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25)
- [MCP Developer Guide 2026](https://lushbinary.com/blog/mcp-model-context-protocol-developer-guide-2026/)
- [Claude Code auto-compact architecture](https://platform.claude.com/docs/en/build-with-claude/compaction)
- [Context compaction patterns (10x extension)](https://dev.to/amitksingh1490/how-we-extended-llm-conversations-by-10x-with-intelligent-context-compaction-4h0a)
- [Context window management techniques](https://agenta.ai/blog/top-6-techniques-to-manage-context-length-in-llms)
- [Context packing (Docker blog)](https://www.docker.com/blog/context-packing-context-window/)
