# Domain Pitfalls: v1.3 Intelligence Layer

**Domain:** AI IT Operations Platform -- v1.3 feature additions to existing TypeScript CLI
**Researched:** 2026-03-31
**Confidence:** HIGH (verified against InfraBrain source code + official docs + community reports)

## Critical Pitfalls

Mistakes that cause rewrites or major issues.

### Pitfall 1: Ink Render Loop Conflicts with readline
**What goes wrong:** Ink takes over stdout/stdin. Any existing readline interface, console.log, or raw process.stdout.write will corrupt Ink's output. The terminal shows garbled text, duplicated lines, or frozen UI.
**Why it happens:** Ink uses a custom React reconciler that manages cursor position. Any uncontrolled write to stdout breaks its layout engine.
**Consequences:** Complete UI corruption. Must restart CLI.
**Prevention:** Remove ALL readline usage before enabling Ink. Replace every `console.log` in rendering paths with Ink's `<Text>` component. Use Ink's `useStdout()` hook for programmatic output. Keep `console.log` only in non-Ink code paths (Express API, background workers). Seven files reference readline: `repl.ts`, `commands.ts`, `approval.ts`, `executor.ts`, `types.ts`, `manager.ts`, `health.ts`.
**Detection:** Any test that uses `console.log` in an Ink-rendered context will show garbled output immediately.

### Pitfall 2: Qdrant Docker Lifecycle Races
**What goes wrong:** InfraBrain tries to query Qdrant before the container is ready. Auto-start launches container but does not wait for health check. First fix-cache query fails, error propagates and kills the DPEV session.
**Why it happens:** `docker run` returns immediately, but Qdrant needs 2-5 seconds to initialize and bind to port 6333.
**Consequences:** Fix-caching fails on first use after reboot. User sees cryptic connection refused error.
**Prevention:** Implement health-check polling after `docker run`: `GET http://localhost:6333/healthz` with retry (5 attempts, 1s interval). Only mark Qdrant as "ready" after 200 response. Wrap in graceful degradation -- if health check times out after 10s, disable fix-caching for this session.
**Detection:** Integration test that starts Qdrant container and immediately queries it.

### Pitfall 3: Auto-Compact Summarization Recursion
**What goes wrong:** The summarization LLM call itself triggers auto-compact (because the messages being summarized are large), creating an infinite loop of summarize-calls.
**Why it happens:** prepareStep fires before EVERY generateText call, including the summarization call.
**Consequences:** Infinite loop, OOM, or stack overflow. LLM costs spiral.
**Prevention:** Add a `isCompacting` flag. When prepareStep detects it is being called for a summarization request, skip the compact check. Alternatively, use a separate code path for summarization that bypasses prepareStep entirely.
**Detection:** Unit test that feeds a message history larger than context window and verifies exactly one summarization call fires.

### Pitfall 4: MemPalace SQLite Database Locking
**What goes wrong:** Multiple MemPalace processes access the same ChromaDB/SQLite files, causing "database is locked" errors and potential data corruption.
**Why it happens:** ChromaDB uses SQLite internally. SQLite's write-ahead log mode supports one writer at a time. Multiple Python processes spawned by InfraBrain all try to write concurrently.
**Consequences:** Memory store/recall fails intermittently. Lost memories. Corrupted database requiring re-initialization.
**Prevention:** Run exactly ONE MemPalace process for the entire InfraBrain lifecycle. Route all memory operations through a single client instance. Implement process-level locking (check if MemPalace is already running before spawning). If an existing instance is detected, connect to it instead of spawning a new one.
**Detection:** Integration test that sends 10 concurrent store operations and verifies all succeed without locking errors.

## Moderate Pitfalls

### Pitfall 5: Ink + Commander Exit Code Mismatch
**What goes wrong:** Ink app exits with code 0 even when the DPEV session failed. Commander expects non-zero exit for scripting/CI integration.
**Prevention:** Use Ink's `exitCode` prop on the root `<App>` component. Wire DPEV engine's success/failure state to the exit code. Test with `process.exitCode` assertions.

### Pitfall 6: p-queue Priority Starvation
**What goes wrong:** High-priority 122B model tasks always preempt 9B pre-processing tasks. The pre-processing never completes, so the 122B model does not benefit from pre-filtered context.
**Prevention:** Use p-queue's priority levels correctly: 9B pre-processing should START first (higher priority for initial scheduling), then 122B tasks queue behind. Or use two separate queues -- one for each model tier -- rather than a shared priority queue.

### Pitfall 7: Qdrant Embedding Dimension Mismatch
**What goes wrong:** BGE-M3 produces 1024-dim embeddings. If the model is swapped (e.g., to a 384-dim model), all existing Qdrant vectors become incompatible. Searches return garbage results.
**Prevention:** Store embedding model name + dimension in Qdrant collection metadata. On startup, verify current model matches stored metadata. If mismatch, warn user and offer re-embedding or new collection.

### Pitfall 8: Ink Re-render Performance on Long Sessions
**What goes wrong:** DPEV sessions with 50+ steps accumulate state. Each new step triggers re-render of the entire step history. Terminal becomes sluggish.
**Prevention:** Virtualize the step list -- only render visible steps (last N). Use React.memo aggressively on step components. Ink 7 has incremental rendering (only re-renders changed lines), but long lists still need virtualization.

### Pitfall 9: Fix Cache Poisoning
**What goes wrong:** A fix that worked once gets cached, but was actually a coincidence (timing-dependent). Future lookups return this bad fix, which fails repeatedly.
**Prevention:** Track fix success rate in Qdrant metadata (applied_count, success_count). Decay confidence over time. If a cached fix fails during execution, mark it as unreliable. Require minimum 2 successful applications before a fix is considered "proven."

### Pitfall 10: MemPalace stdout Pollution
**What goes wrong:** MemPalace prints startup messages or debug output to stdout, which InfraBrain interprets as JSON-RPC responses. Parsing fails, client crashes.
**Why it happens:** Known issue (GitHub Issue #225). MemPalace MCP writes startup text to stdout instead of stderr, breaking JSON-RPC parsing.
**Prevention:** Filter MemPalace stdout: only parse lines that start with `{` (valid JSON). Redirect non-JSON lines to InfraBrain's debug log. Alternatively, wait for the issue to be fixed upstream and pin to a version that resolves it.

### Pitfall 11: MemPalace First-Run Model Download
**What goes wrong:** First `mempalace init` downloads Sentence Transformers model (~80 MB, 2-3 minutes). If this happens during a DPEV session, the session blocks or times out.
**Prevention:** Document that `mempalace init` must be run during setup, not during first use. In InfraBrain's startup, check if MemPalace vault exists. If not, warn user to run `mempalace init` first. Do NOT auto-initialize during a DPEV session.

## Minor Pitfalls

### Pitfall 12: React 19 + TypeScript JSX Configuration
**What goes wrong:** TypeScript errors on `.tsx` files because tsconfig does not have `"jsx": "react-jsx"`.
**Prevention:** Add to tsconfig.json before any Ink component code: `"jsx": "react-jsx"`, `"jsxImportSource": "react"`.

### Pitfall 13: p-queue ESM Import Issues
**What goes wrong:** `import PQueue from 'p-queue'` fails with "default export not found" in some TypeScript configurations.
**Prevention:** InfraBrain already uses `"type": "module"` and `"moduleResolution": "NodeNext"` -- this should work. If not, use `import { default as PQueue } from 'p-queue'`.

### Pitfall 14: Chalk + Ink Color Conflicts
**What goes wrong:** Chalk v5 and Ink both manipulate terminal colors. Nested Chalk calls inside Ink `<Text>` components produce double-escaped ANSI codes.
**Prevention:** Inside Ink components, use Ink's built-in `<Text color="red">` instead of `chalk.red()`. Keep Chalk for non-Ink output paths only (Express API responses, log files).

### Pitfall 15: @lenml/tokenizer-qwen3 Model Mismatch
**What goes wrong:** InfraBrain routes to a non-Qwen model (e.g., DeepSeek R1 for forensic role) but the Qwen tokenizer is used for token counting. Token count diverges.
**Prevention:** Accept that the Qwen tokenizer is the primary tokenizer (covers 6/7 roles). For the forensic role (DeepSeek), the Qwen tokenizer still provides a reasonable estimate (+/- 10%). If exact multi-model counting is needed later, install additional `@lenml/tokenizer-*` packages per model.

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| Ink renderer setup | Pitfall 1 (readline conflict) | Complete readline removal must happen first, before any Ink code |
| Ink approval prompts | Pitfall 5 (exit codes) | Wire exit codes early, test with `--json` mode too |
| Auto-compact | Pitfall 3 (recursion) | Implement isCompacting guard from day 1 |
| Token counting | Pitfall 15 (model mismatch) | Use Qwen tokenizer as primary, accept +/-10% for non-Qwen |
| Qdrant fix-caching | Pitfall 2 (Docker races) + Pitfall 7 (dimension mismatch) | Health check polling + model metadata validation on startup |
| Parallel inference | Pitfall 6 (priority starvation) | Consider two separate queues instead of shared priority |
| Fix cache maturity | Pitfall 9 (cache poisoning) | Track success rate, require 2+ successful applications |
| MemPalace setup | Pitfall 4 (SQLite locking) + Pitfall 10 (stdout pollution) | Single process, filter stdout for valid JSON only |
| MemPalace first use | Pitfall 11 (model download) | Require `mempalace init` during setup, not during DPEV |

## Sources

- [Building a Coding CLI with React Ink](https://ivanleo.com/blog/migrating-to-react-ink) -- readline migration pitfalls
- [AI SDK context compaction discussion](https://github.com/vercel/ai/discussions/10864) -- summarization recursion risk
- [Qdrant quickstart](https://qdrant.tech/documentation/quickstart/) -- Docker health check
- [p-queue GitHub issues](https://github.com/sindresorhus/p-queue/issues/215) -- priority queue behavior
- [React 19 support in Ink](https://github.com/vadimdemedes/ink/issues/688) -- compatibility discussion
- [MemPalace database locking issue](https://github.com/milla-jovovich/mempalace/issues/211) -- ChromaDB/SQLite locking
- [MemPalace stdout bug](https://github.com/milla-jovovich/mempalace/issues/225) -- MCP stdout pollution
- [MemPalace setup guide](https://www.mempalace.tech/guides/setup) -- first-run model download
