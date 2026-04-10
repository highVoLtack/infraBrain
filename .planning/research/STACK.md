# Technology Stack: v1.3 Intelligence Layer Additions

**Project:** InfraBrain v1.3
**Researched:** 2026-03-31
**Scope:** NEW dependencies only. Existing stack (ai-sdk, Commander, Chalk, Zod, SQLite, Express, Vitest) is validated and unchanged.

## Recommended Stack Additions

### 1. Terminal UI: Ink + React

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| ink | ^7.0.0 | React renderer for terminal | Stable release (Apr 2026). Flexbox layout via Yoga, incremental rendering (only re-renders changed lines), hooks for paste/resize/animation. Used by Gatsby, Parcel, Yarn. Replaces readline REPL with component-based UI. |
| react | ^19.2.0 | Peer dependency for Ink 7 | Required by Ink 7. React 19 brings use() hook, Actions, and improved Suspense -- useful for async DPEV state management. |
| react-devtools-core | ^6.1.2 | Optional: debug Ink layouts | Peer dep of Ink 7 (optional). Install only in dev. Enables live prop inspection of terminal UI. |
| @inkjs/ui | ^2.0.0 | Pre-built Ink components | Spinner, Select, TextInput, ProgressBar, Badge, Alert, StatusMessage. Peer dep: ink >=5 (compatible with 7). Eliminates need to build common UI primitives. |

**React 19 + Ink 7 Note:** Ink 7 requires Node.js 22+ and React 19.2+. This is the correct choice because: (a) Ink 5/6 used React 18 which is now legacy, (b) Ink 7 is the actively maintained branch, (c) Node 22 is LTS (active until Apr 2027), and (d) InfraBrain already runs Node 25.2.1 so no upgrade needed.

**Migration from readline:** The existing readline REPL (`src/cli/repl.ts`) uses `readline.createInterface()` and `setReadline()` for approval prompts. Seven files reference readline: `repl.ts`, `commands.ts`, `approval.ts`, `executor.ts`, `types.ts`, `manager.ts`, `health.ts`. Migration is incremental -- Ink's `useInput()` hook and `<TextInput>` component replace readline line-by-line. Commander stays as the argument parser; Ink replaces only the interactive rendering layer.

**Confidence:** HIGH -- verified from Ink GitHub package.json (v7.0.0, peerDependencies: react >=19.2.0, engines: node >=22).

### 2. Vector Database: Qdrant

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| @qdrant/js-client-rest | ^1.17.0 | Qdrant REST client | Official TypeScript SDK. REST-based (easier debugging than gRPC). Major/minor versions track Qdrant engine releases. Supports both local Docker and Qdrant Cloud. |
| qdrant (Docker image) | latest | Vector DB server | Run via `docker run -p 6333:6333 qdrant/qdrant`. Volume-mount for persistence. InfraBrain already uses Docker for scenarios, so no new infra dependency. |

**No JS Embedded Mode:** Qdrant does NOT have an in-process embedded mode for Node.js (only Python has `:memory:` mode). The "embedded default" approach for InfraBrain: auto-launch Qdrant Docker container on first use, detect if already running via health check (`GET http://localhost:6333/healthz`). For environments without Docker, degrade gracefully (skip fix-caching, fall back to full LLM reasoning).

**Docker Compose integration:** Add Qdrant to existing Docker Compose setup alongside scenario containers:

```yaml
services:
  qdrant:
    image: qdrant/qdrant:latest
    ports:
      - "6333:6333"
      - "6334:6334"
    volumes:
      - ./data/qdrant:/qdrant/storage
```

**Confidence:** HIGH -- verified from npm registry (v1.17.0, Feb 2026) and Qdrant official docs. No JS embedded mode exists.

### 3. MemPalace: Python Sidecar via MCP

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| mempalace (Python) | latest | Semantic memory system | 19 MCP tools for store/search/manage memories. ChromaDB for vector storage, SQLite knowledge graph for structured relationships. Highest-scoring AI memory benchmark. |
| Python 3.9+ | system | MemPalace runtime | Required by MemPalace. Should already be available on any Linux/macOS admin workstation. |

**Sidecar Architecture:** MemPalace runs as a separate Python process communicating over MCP (JSON-RPC 2.0 over stdin/stdout). InfraBrain spawns it as a child process:

```
InfraBrain (Node.js) --stdin/stdout--> mempalace mcp (Python)
                     <--JSON-RPC 2.0--
```

**Installation:** `pip install mempalace && mempalace init`. First run downloads Sentence Transformers model (~80 MB, 2-3 min). Creates `palace.db` (SQLite metadata), `chroma/` (vector embeddings), and `wings/` (memory containers).

**Integration pattern:** InfraBrain spawns MemPalace via `child_process.spawn('python', ['-m', 'mempalace.mcp_server'])` and communicates via JSON-RPC 2.0 messages on stdin/stdout. Build a thin `MemPalaceClient` class that:
1. Spawns the Python process on first use (lazy init)
2. Sends JSON-RPC requests (tool calls) on stdin
3. Reads JSON-RPC responses from stdout
4. Handles process lifecycle (restart on crash, clean shutdown)

**Known Issue:** Multiple processes accessing the same ChromaDB/SQLite files causes "database is locked" errors. Mitigation: run exactly ONE MemPalace process, route all InfraBrain requests through it. Do NOT spawn multiple instances.

**What NOT to use:** Do NOT use `@anthropic-ai/mcp-sdk` or any MCP client library -- the protocol is simple enough (JSON-RPC 2.0 over stdio) to implement directly. Adding an MCP SDK would add unnecessary dependency weight for what amounts to `JSON.stringify` + `readline` on a child process.

**Confidence:** MEDIUM -- MemPalace is a newer project (active development, some rough edges per GitHub issues). The MCP JSON-RPC protocol is stable, but the Python dependency adds deployment friction. The Zig rewrite (Issue #30) may eventually eliminate the Python requirement.

### 4. Token Counting (for Auto-Compact)

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| @lenml/tokenizers | ^3.7.2 | Tokenizer core | Lightweight fork of transformers.js (tokenizers only). No network access needed. Supports loading model-specific tokenizers. |
| @lenml/tokenizer-qwen3 | ^3.4.2 | Qwen3 tokenizer | Exact token counting for Qwen3/Qwen3.5 MoE models (InfraBrain's primary LLM family). Accurate context window budgeting. |

**Why @lenml/tokenizers over js-tiktoken?** InfraBrain routes to Qwen3.5 MoE models across 7 roles. GPT BPE tokenization (js-tiktoken) diverges 15-40% from Qwen tokenization for code content. Since auto-compact decisions depend on "are we at 80% of 32K context?", a 15-40% error could trigger compaction too early (wasting context) or too late (hitting the window limit and getting truncated). Model-native tokenization eliminates this risk.

**Usage pattern:** Load once at startup, count tokens per message array before each LLM call:

```typescript
import { TokenizerLoader } from '@lenml/tokenizers';
import qwen3_data from '@lenml/tokenizer-qwen3';
const tokenizer = TokenizerLoader.fromPreTrained(qwen3_data);
const count = tokenizer.encode(text).length;
```

**Fallback:** If a non-Qwen model is used, the Qwen tokenizer still provides a reasonable estimate (+/- 10%). For exact multi-model support, install additional `@lenml/tokenizer-*` packages as needed.

**Confidence:** HIGH -- @lenml/tokenizers verified on npm (v3.7.2), Qwen3 tokenizer verified (v3.4.2). Pure JS, zero dependencies, offline-capable.

### 5. Concurrency Control (Tool Concurrency + Parallel Inference)

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| p-queue | ^9.1.2 | Promise queue with concurrency | Full-featured queue: concurrency limit, priority, pause/resume, events (idle, active, completed). Pure ESM. Use for tool execution queue and inference pipeline. |
| p-limit | ^7.3.0 | Simple concurrency limiter | Lightweight (no queue features). Use for batch-partitioned discovery commands where we just need "run max N in parallel." |

**Why both?** Different concurrency patterns need different tools:
- **p-queue** for the inference pipeline (priority queue: 9B model pre-processing gets queued, 122B reasoning gets priority) and tool execution orchestration (pause on approval, resume after).
- **p-limit** for batch discovery (run 5 `docker inspect` commands in parallel, simple fan-out/fan-in).

**Confidence:** HIGH -- both packages verified on npm, pure ESM, actively maintained by sindresorhus.

### 6. Context Management (Auto-Compact)

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| (ai SDK built-in) | existing | prepareStep hook | Vercel AI SDK provides `prepareStep` callback in `generateText`/`streamText` for context manipulation before each LLM call. This is the integration point for auto-compact -- no new library needed. |
| @lenml/tokenizers | (see above) | Token budget measurement | Count tokens to decide when compaction triggers. |

**Architecture:** Auto-compact is implemented as a `prepareStep` middleware pattern, not a library:
1. Before each step, count tokens in message history via @lenml/tokenizer-qwen3
2. If tokens > threshold (e.g., 80% of model's context window), trigger compaction
3. Summarize older messages using the existing LLM provider (call `generateText` with a "summarize these messages" system prompt)
4. Replace older messages with summary, keep recent N messages intact
5. Pass compacted messages to the LLM call

**Compaction strategy for 32K context:**
- Reserve 20% (6.4K tokens) for system prompt + tool definitions
- Reserve 30% (9.6K tokens) for the current turn (user input + assistant response)
- Remaining 50% (16K tokens) for conversation history
- Trigger compaction when history exceeds 12.8K tokens (80% of history budget)
- Compact oldest 50% of history into a 2K token summary

**No external library needed** beyond @lenml/tokenizers. The AI SDK's `prepareStep` hook provides the insertion point.

**Confidence:** MEDIUM -- AI SDK prepareStep approach verified via Vercel docs. Implementation is custom but follows documented patterns. Token budgets are initial estimates; tune after benchmarking with actual Qwen3.5 models.

### 7. Parallel Inference Pipeline

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| (ai SDK built-in) | existing | generateText/streamText | Multiple concurrent calls to different models via existing @ai-sdk/openai-compatible provider. No new dependency. |
| p-queue | (see above) | Priority scheduling | 9B pre-processing tasks at lower priority, 122B reasoning at higher priority. Respects GPU memory limits via concurrency cap. |

**Pattern:** Use `Promise.allSettled()` with the existing `ai` SDK for the parallel inference pipeline:

```typescript
const [logAnalysis, errorClassification] = await Promise.allSettled([
  generateText({ model: qwen9B, prompt: 'Analyze these logs...' }),
  generateText({ model: qwen9B, prompt: 'Classify this error...' }),
]);
// Feed results into the 122B reasoning call
const diagnosis = await generateText({
  model: qwen122B,
  prompt: `Given log analysis: ${logAnalysis}...`,
});
```

Use `Promise.allSettled` (not `Promise.all`) because: if one 9B pre-processing call fails, the 122B model can still reason with partial input. Failing fast with `Promise.all` would throw away successful results.

**GPU Memory Consideration:** When running vLLM locally with limited VRAM, cap concurrent model calls via p-queue to prevent OOM. A single GPU typically handles 1x 122B or 3-4x 9B models concurrently. p-queue's concurrency limit enforces this at the application level.

**No new dependency needed** -- this combines existing `ai` SDK with p-queue (already added for tool concurrency).

**Confidence:** HIGH -- AI SDK generateText supports parallel calls natively (documented in Vercel cookbook). p-queue handles scheduling.

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Terminal UI | Ink 7 + React 19 | Ink 5 + React 18 | Ink 5/6 no longer actively maintained. React 18 is legacy. |
| Terminal UI | Ink 7 | blessed / blessed-contrib | Dead project (last commit 2020). No React paradigm. |
| Terminal UI | Ink 7 | Pastel (Ink framework) | Adds Next.js-like routing. Overkill -- InfraBrain has Commander for routing. |
| Vector DB client | @qdrant/js-client-rest | @qdrant/qdrant-js (gRPC) | REST easier to debug. gRPC adds protobuf dep. Switch later if perf demands it. |
| Vector DB | Qdrant (Docker) | ChromaDB | ChromaDB's JS client is less mature. MemPalace already uses ChromaDB internally -- no need to duplicate. |
| Vector DB | Qdrant (Docker) | hnswlib-node | Raw HNSW index with no metadata filtering, no collections, no persistence API. Would rebuild Qdrant from scratch. |
| Token counting | @lenml/tokenizer-qwen3 | js-tiktoken | GPT BPE diverges 15-40% from Qwen tokenization on code. Unacceptable for 32K context budgeting. |
| Token counting | @lenml/tokenizer-qwen3 | gpt-tokenizer | Same problem -- GPT-family tokenizer, not Qwen-native. |
| Concurrency | p-queue + p-limit | Bottleneck | CJS-only, heavier, designed for rate limiting not task scheduling. |
| Concurrency | p-queue + p-limit | Custom Promise.all batching | Reinvents the wheel. p-queue handles priority, error propagation, queue draining. |
| Memory system | MemPalace (Python sidecar) | Custom RAG in Node.js | MemPalace provides 19 MCP tools, knowledge graph, AAAK protocol out of the box. Building equivalent from scratch would take months. |
| Memory system | MemPalace MCP | Qdrant-only memory | Qdrant stores vectors but has no knowledge graph, no structured relationships, no memory organization. MemPalace adds semantic structure on top. |
| MCP client | Direct JSON-RPC implementation | @anthropic-ai/mcp-sdk | MCP over stdio is trivially simple (JSON lines on stdin/stdout). SDK adds 50+ transitive deps for no benefit. |

## What NOT to Add

These are already covered by the existing stack:

| Need | Already Handled By | Do NOT Add |
|------|--------------------|-----------|
| LLM provider | @ai-sdk/openai-compatible + ai SDK | LangChain, LlamaIndex, or any LLM framework |
| Schema validation | Zod ^4.3.6 | joi, yup, io-ts |
| CLI argument parsing | Commander ^14.0.3 | yargs, meow, clipanion |
| Terminal colors | Chalk ^5.6.2 | kleur, picocolors (Ink handles colors internally too) |
| Testing | Vitest ^4.0.18 | Jest, mocha |
| Database (audit) | better-sqlite3 ^12.6.2 | Any SQL ORM -- keep raw SQLite |
| HTTP API | Express ^5.2.1 | Fastify, Hono |
| Build | tsup ^8.5.1 + tsx ^4.21.0 | esbuild directly, webpack |
| Vector search for fixes | Qdrant (new) | ChromaDB in Node.js (MemPalace uses Chroma internally -- don't duplicate) |

## Installation

```bash
# Terminal UI (Ink + React 19)
npm install ink@^7.0.0 react@^19.2.0 @inkjs/ui@^2.0.0

# Vector DB client
npm install @qdrant/js-client-rest@^1.17.0

# Token counting (Qwen-native)
npm install @lenml/tokenizers@^3.7.2 @lenml/tokenizer-qwen3@^3.4.2

# Concurrency control
npm install p-queue@^9.1.2 p-limit@^7.3.0

# Dev dependencies
npm install -D @types/react@^19.2.0 react-devtools-core@^6.1.2

# MemPalace (Python sidecar -- separate from npm)
pip install mempalace
mempalace init
```

**Total new production dependencies:** 7 npm packages
**Total new dev dependencies:** 2 npm packages
**Total external dependencies:** 1 Python package (mempalace), 1 Docker image (qdrant)

## Node.js Version Requirement

Ink 7 requires Node.js 22+. Update `package.json`:

```json
{
  "engines": {
    "node": ">=22.0.0"
  }
}
```

Node 22 is LTS (Active until Apr 2027, Maintenance until Apr 2028). InfraBrain already runs Node 25.2.1, so this is a documentation formality.

## TypeScript Configuration Change

React 19 with Ink 7 requires JSX support in tsconfig. Add to `compilerOptions`:

```json
{
  "jsx": "react-jsx",
  "jsxImportSource": "react"
}
```

The existing `"module": "NodeNext"` and `"moduleResolution": "NodeNext"` are compatible with all recommended packages (all are ESM).

## Integration Points with Existing Stack

### Ink + Commander Coexistence
Commander handles argument parsing and command routing. Ink handles the interactive UI once a command is dispatched. Pattern:
1. Commander parses `/infra:debug --target nginx`
2. Commander action handler calls `render(<DebugView target="nginx" />)`
3. Ink renders the DPEV progress, streaming output, approval prompts
4. When Ink app exits, control returns to Commander

This is a well-established pattern used by Gatsby CLI, Shopify CLI, and Yarn.

### Ink + Express API
Express continues to serve the REST API. Ink is the CLI renderer only. No conflict -- they operate on different I/O channels (Express on HTTP, Ink on stdout/stdin).

### Qdrant + AI SDK (Fix-Caching)
The fix-caching flow: before calling `generateText()`, query Qdrant for similar error embeddings. If a cached fix exists with high similarity (cosine > 0.92), skip LLM reasoning and return cached fix. This wraps around the existing AI SDK calls, not inside them:

```
Error occurs --> Embed error text --> Search Qdrant -->
  HIT (>0.92):  Return cached fix (2s)
  MISS:         Full LLM reasoning (113s) --> Store fix in Qdrant
```

### MemPalace + InfraBrain
MemPalace acts as long-term semantic memory. InfraBrain stores successful fix patterns, learns from repeated failures, and recalls relevant context for new diagnoses. Communication is fire-and-forget for writes (store memory after fix completes) and synchronous for reads (recall before diagnosis).

### p-queue + AI SDK (Parallel Inference)
The parallel inference pipeline wraps `generateText()` calls in p-queue tasks. The 9B model pre-processing tasks and 122B reasoning tasks share a queue with priority levels, respecting GPU memory limits.

### Auto-Compact + AI SDK
The `prepareStep` hook in generateText/streamText intercepts every LLM call. The auto-compact middleware counts tokens and compresses history when approaching the 32K limit. This is transparent to the rest of the codebase -- existing `generateText` calls gain auto-compact automatically.

## Dependency Graph (New Additions)

```
ink@7 -----> react@19 (peer dep)
         |-> yoga-layout (bundled, Flexbox engine)
         |-> @inkjs/ui@2 (Spinner, Select, TextInput)

@qdrant/js-client-rest@1.17 (standalone, REST client)

@lenml/tokenizers@3.7 --> @lenml/tokenizer-qwen3@3.4 (tokenizer data)

p-queue@9.1 (standalone)
p-limit@7.3 (standalone)

mempalace (Python, external process via MCP/JSON-RPC)
qdrant (Docker, external service via REST)
```

## Sources

- [Ink GitHub repository](https://github.com/vadimdemedes/ink) -- package.json verified for v7.0.0, React 19.2+ peer dep, Node 22+ engines
- [Ink npm](https://www.npmjs.com/package/ink) -- v7.0.0 published Apr 2026
- [@inkjs/ui](https://github.com/vadimdemedes/ink-ui) -- v2.0.0, peer dep: ink >=5
- [@qdrant/js-client-rest npm](https://www.npmjs.com/package/@qdrant/js-client-rest) -- v1.17.0, Feb 2026
- [Qdrant installation docs](https://qdrant.tech/documentation/guides/installation/) -- Docker setup, no JS embedded mode
- [@lenml/tokenizers npm](https://www.npmjs.com/package/@lenml/tokenizers) -- v3.7.2, Qwen3 support
- [@lenml/tokenizer-qwen3 npm](https://www.npmjs.com/package/@lenml/tokenizer-qwen3) -- v3.4.2
- [p-queue npm](https://www.npmjs.com/package/p-queue) -- v9.1.2
- [p-limit npm](https://www.npmjs.com/package/p-limit) -- v7.3.0
- [MemPalace GitHub](https://github.com/milla-jovovich/mempalace) -- MCP server, 19 tools, ChromaDB + SQLite KG
- [MemPalace setup guide](https://www.mempalace.tech/guides/setup) -- pip install, Python 3.9+
- [MemPalace database locking issue](https://github.com/milla-jovovich/mempalace/issues/211) -- single-process requirement
- [AI SDK parallel tools cookbook](https://ai-sdk.dev/cookbook/node/call-tools-in-parallel) -- Promise.all pattern
- [AI SDK workflow patterns](https://ai-sdk.dev/docs/agents/workflows) -- parallel model calls
- [AI SDK generateText reference](https://ai-sdk.dev/docs/reference/ai-sdk-core/generate-text) -- prepareStep hook
