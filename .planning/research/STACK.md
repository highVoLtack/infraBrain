# Stack Research

**Domain:** Local-first AI IT Operations Platform (CLI, multi-agent, local LLMs)
**Researched:** 2026-03-07
**Confidence:** MEDIUM-HIGH (core stack verified with official sources; binary packaging area has known complexity)

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Node.js | 22.x LTS | Runtime | LTS until April 2027. SEA support available. Matches TypeScript CLI ecosystem constraint. |
| TypeScript | 5.7+ | Language | Required by project constraints. Strong async/await, excellent type inference for agent APIs. |
| Commander.js | 14.x | CLI framework | Lightweight, battle-tested, 14B+ weekly downloads. InfraBrain is command-driven (not interactive TUI), so Commander's simple subcommand model fits perfectly. oclif is overkill for a single-binary distribution. |
| @commander-js/extra-typings | 14.x | CLI type inference | Infers strong types for options and action handlers without manual type annotations. Requires TypeScript 5.0+. |
| Vercel AI SDK (`ai`) | 6.x | LLM abstraction layer | 2.8M weekly npm downloads. Provider-agnostic: swap Ollama for vLLM/llama.cpp without code changes. Built-in structured output (Zod schemas), streaming, tool calling, and agent loops. This is the abstraction layer the project needs to avoid vendor lock-in. |
| ollama-ai-provider | latest | Ollama provider for AI SDK | Community provider connecting AI SDK to Ollama's HTTP API. Supports tool calling, streaming, and structured output with local models. |
| ollama | 0.6.x | Direct Ollama client | Official Ollama JS client. Use for model management (pull, list, delete) and health checks. AI SDK handles inference; this handles ops. |
| better-sqlite3 | 12.6.x | SQLite database | Synchronous API (ideal for CLI tools -- no callback soup). 4,100+ dependents. The fastest Node.js SQLite binding. Native addon, but well-supported with prebuilt binaries. |
| Zod | 4.x | Schema validation | TypeScript-first validation with static type inference. 14x faster parsing in v4. Used by AI SDK for structured output schemas -- aligns the entire stack on one validation library. |
| pino | 9.x | Structured logging | 5x faster than Winston. JSON-structured logs align with the audit trail requirement. Async, non-blocking -- critical when the CLI is orchestrating multiple sub-agents. |

### Process Isolation & Sandboxing

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Node.js child_process (fork/spawn) | built-in | Sub-agent process isolation | Each sub-agent runs as a separate child process with its own memory space. This is the ONLY safe approach for InfraBrain's blast-radius containment. Do NOT use vm/vm2/isolated-vm for this use case -- InfraBrain sub-agents execute shell commands on real infrastructure, so V8-level sandboxing is irrelevant. The isolation boundary is the OS process. |
| execa | 9.x | Child process execution | Modern, promise-based wrapper over child_process. Better error handling, streaming, timeouts, and signal forwarding. Use for executing infrastructure commands (docker, systemctl, nginx) from sub-agents. |

**Architecture note on isolation:** InfraBrain's sub-agent isolation is about preventing context contamination between agents (separate LLM conversations) and limiting blast radius (separate processes with configurable permissions). This is NOT about sandboxing untrusted JavaScript code. Each sub-agent is a fresh Node.js child process that: (1) gets its own LLM context via AI SDK, (2) executes infrastructure commands via execa with explicit timeouts, (3) has its damage budget tracked by the parent orchestrator.

### Binary Distribution

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Node.js SEA | built-in (Node 22+) | Single executable packaging | Native to Node.js, replacing deprecated `pkg`. Node 25.5 added `--build-sea` for one-step builds. The official path forward. |
| seabox | latest | SEA build tooling | Wraps Node.js SEA with native addon extraction support. Critical because better-sqlite3 is a native addon that must be extracted to disk at runtime when embedded in SEA. |

**Binary packaging is the hardest part of this stack.** Native addons (better-sqlite3) inside SEA require extraction to a temp directory on first run. This works but adds complexity. Plan for this in the build pipeline early.

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| chalk | 5.x | Terminal colors | CLI output formatting. ESM-only in v5. |
| ora | 8.x | Terminal spinners | Long-running operations (LLM inference, network scans). |
| @inkjs/ui | latest | Interactive prompts | HITL approval prompts ([Y] Execute / [N] Reject / [M] Modify). Only needed for the interactive approval flow, not the core CLI. |
| gray-matter | 4.x | Markdown frontmatter parser | Parsing skill file metadata (frontmatter) from Markdown files. |
| unified + remark | latest | Markdown AST processing | Parsing skill file content into structured sections (prompts, tool definitions, examples). |
| conf | 13.x | Configuration management | User/project-level config files (.infrabrain/config). JSON-backed, schema-validated. |
| eventemitter3 | 5.x | Event bus | Inter-component communication within the orchestrator (agent status, circuit breaker triggers, audit events). Faster than Node built-in EventEmitter. |
| nanoid | 5.x | ID generation | Unique IDs for fix plans, agent sessions, audit entries. URL-safe, no dependencies. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| tsdown | TypeScript bundler | Successor to tsup (which is no longer actively maintained). Powered by Rolldown (Rust-based). ESM-first, zero-config for library builds. Use for bundling before SEA packaging. |
| vitest | Testing | v4.x. Vite-native, fast. Use for unit tests on skills parser, orchestrator logic, circuit breaker. |
| tsx | TypeScript execution | For development -- run .ts files directly without compilation step. Faster than ts-node. |
| @biomejs/biome | Linting + formatting | Rust-based, replaces ESLint + Prettier with a single tool. Faster, zero-config defaults. |
| @types/better-sqlite3 | Type definitions | TypeScript types for better-sqlite3. |

## Installation

```bash
# Core runtime & CLI
npm install commander @commander-js/extra-typings ai ollama-ai-provider ollama better-sqlite3 zod pino

# Process & execution
npm install execa

# CLI UX
npm install chalk ora @inkjs/ui

# Markdown/skills parsing
npm install gray-matter unified remark-parse

# Utilities
npm install conf eventemitter3 nanoid

# Dev dependencies
npm install -D typescript tsdown vitest tsx @biomejs/biome @types/better-sqlite3 @types/node
```

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| Commander.js | oclif | If InfraBrain grows into a plugin ecosystem with community-contributed CLI commands. oclif's plugin system shines there. For v1 single-binary, Commander is simpler. |
| Commander.js | Ink (full React TUI) | If the CLI evolves into a persistent dashboard/TUI with real-time agent status panels. For v1 command-driven interaction, Commander is right. |
| Vercel AI SDK | LangChain.js / LangGraph.js | If you need graph-based agent orchestration with complex branching. AI SDK is lighter, more composable, and avoids LangChain's notorious abstraction bloat. InfraBrain's orchestration logic is custom anyway (Diagnose-Plan-Execute-Verify loop). |
| Vercel AI SDK | Direct Ollama HTTP API | If AI SDK's provider abstraction adds unwanted overhead. But then you lose the provider-swap capability (Ollama -> vLLM) which is a stated requirement. |
| better-sqlite3 | Node.js built-in node:sqlite | When node:sqlite exits experimental status (likely Node 24+). Currently sync-only API matches better-sqlite3, but lacks WAL mode control, user-defined functions, and the ecosystem maturity needed for production. Revisit in 2027. |
| better-sqlite3 | Drizzle ORM | If query complexity grows beyond raw SQL. Drizzle has a better-sqlite3 driver. Add later if needed -- raw SQL is fine for audit logs and state queries in v1. |
| tsdown | tsup | If tsdown has compatibility issues. tsup still works, just unmaintained. Safe fallback. |
| tsdown | esbuild (direct) | If you need more control over the bundle. tsdown wraps Rolldown which handles edge cases (circular deps, tree-shaking) better than raw esbuild. |
| pino | Winston | If you need multi-transport logging (file + database + external service simultaneously). Pino can do this via pino-transport, but Winston makes it easier. For InfraBrain's file-based audit trail, pino's JSON output piped to files is sufficient and faster. |
| seabox + Node SEA | pkg (deprecated) / nexe | Never. pkg is deprecated by Vercel with no Node 22+ support. nexe has not kept up with modern Node versions. SEA is the only supported path. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| vm2 | Critical CVE-2026-22709 (sandbox escape, CVSS 9.8). Repeatedly compromised. Maintainer recommends against using it. | OS-level process isolation via child_process.fork() |
| node:vm | Explicitly documented as NOT a security mechanism. Scoping only, trivially escapable. | child_process for isolation, Zod for data validation |
| LangChain.js | Massive abstraction overhead, frequent breaking changes, "framework tax" on every LLM call. InfraBrain's orchestration is domain-specific (IT ops loop), not generic chain/agent composition. | Vercel AI SDK for LLM abstraction + custom orchestration logic |
| pkg (vercel/pkg) | Deprecated. No Node 22+ support. Community fork (yao-pkg) exists but is a maintenance liability for a security-critical IT tool. | Node.js SEA + seabox |
| node:sqlite (built-in) | Still experimental, requires --experimental-sqlite flag. Sync-only API. No WAL mode control. Missing user-defined functions. Not production-ready. | better-sqlite3 |
| winston | 5x slower than pino. Heavier dependency tree. No advantage for structured JSON logging to files. | pino |
| ts-node | Slow startup due to full TypeScript compilation. | tsx (uses esbuild under the hood, instant startup) |
| ESLint + Prettier | Two tools, complex config, slow. | Biome (single tool, Rust-based, fast, zero-config) |

## Stack Patterns by Variant

**If targeting Node 24+ (future):**
- Evaluate node:sqlite replacing better-sqlite3 (eliminates native addon packaging complexity)
- SEA tooling will likely be more mature, possibly eliminating need for seabox

**If sub-agents need network isolation (enterprise hardening):**
- Run sub-agents in Docker containers instead of child processes
- Use dockerode npm package for container lifecycle management
- Adds latency but provides true network namespace isolation

**If Ollama proves insufficient for enterprise models:**
- Swap ollama-ai-provider for a vLLM or llama.cpp provider
- AI SDK's provider interface means zero application code changes
- May need custom provider implementation if community provider doesn't exist

**If the CLI evolves into a persistent daemon:**
- Add fastify for the REST/gRPC API layer
- Keep Commander for the CLI client that talks to the daemon
- Split into two packages: `infrabrain-cli` and `infrabrain-daemon`

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| ai@6.x | ollama-ai-provider@latest | Ensure provider version targets AI SDK v6, not v5. Check peer dependencies. |
| better-sqlite3@12.x | Node.js 20-22 | Prebuilt binaries available for LTS versions. Rebuild required for non-LTS. |
| Commander@14.x | @commander-js/extra-typings@14.x | Versions must match (peer dependency). |
| Zod@4.x | ai@6.x | AI SDK 6 uses Zod for structured output schemas. Ensure both use Zod 4 (not 3). |
| tsdown@latest | TypeScript 5.7+ | Requires modern TS for satisfies and const type parameters. |
| seabox@latest | Node.js 22+ | SEA requires Node 22+ for stability. Node 25.5+ for --build-sea one-step builds. |

## Confidence Assessment

| Area | Confidence | Rationale |
|------|------------|-----------|
| CLI framework (Commander) | HIGH | Verified via npm, official docs. Industry standard for command-driven CLIs. |
| LLM abstraction (AI SDK) | HIGH | Verified via official Vercel blog, npm. 2.8M weekly downloads. Active development. |
| Ollama integration | MEDIUM-HIGH | Community provider, not official Vercel. But multiple actively maintained providers exist. |
| SQLite (better-sqlite3) | HIGH | 12.6.x actively maintained, 4K+ dependents. Industry standard for embedded SQLite in Node. |
| Binary packaging (SEA) | MEDIUM | SEA is the official path but still evolving. Native addon extraction (seabox) adds complexity. Test early. |
| Process isolation | HIGH | child_process.fork() is Node.js core, battle-tested. Architecture pattern (not library dependency). |
| Bundling (tsdown) | MEDIUM | New tool (successor to tsup). Rolldown is backed by Evan You / Vite team. Safe bet but less battle-tested than tsup. |
| Testing (vitest) | HIGH | v4.x stable, massive adoption, Vite-native. |
| Schema validation (Zod) | HIGH | v4.x stable, 14x perf improvement, used by AI SDK. |

## Sources

- [Vercel AI SDK 6 announcement](https://vercel.com/blog/ai-sdk-6) -- AI SDK version, features, structured output (HIGH confidence)
- [AI SDK official docs](https://ai-sdk.dev/docs/introduction) -- Provider interface, tool calling (HIGH confidence)
- [AI SDK Ollama community provider](https://ai-sdk.dev/providers/community-providers/ollama) -- Ollama integration (MEDIUM-HIGH confidence)
- [ollama-js GitHub](https://github.com/ollama/ollama-js) -- Official Ollama JS client, v0.6.3 (HIGH confidence)
- [Commander.js npm](https://www.npmjs.com/package/commander) -- Version 14.x, Node 20+ requirement (HIGH confidence)
- [better-sqlite3 npm](https://www.npmjs.com/package/better-sqlite3) -- Version 12.6.2 (HIGH confidence)
- [Node.js SEA documentation](https://nodejs.org/api/single-executable-applications.html) -- SEA status, native addon handling (HIGH confidence)
- [Node.js 25.5 --build-sea](https://progosling.com/en/dev-digest/2026-01/nodejs-25-5-build-sea-single-executable) -- One-step SEA builds (MEDIUM confidence, news source)
- [seabox GitHub](https://github.com/MeirionHughes/seabox) -- Native addon extraction for SEA (MEDIUM confidence)
- [Zod v4 announcement](https://www.infoq.com/news/2025/08/zod-v4-available/) -- v4 performance, @zod/mini (HIGH confidence)
- [tsdown official docs](https://tsdown.dev/guide/) -- tsup successor, Rolldown-powered (MEDIUM confidence)
- [Vitest 4.0 release](https://vitest.dev/blog/vitest-4) -- Latest testing framework (HIGH confidence)
- [vm2 CVE-2026-22709](https://www.endorlabs.com/learn/cve-2026-22709-critical-sandbox-escape-in-vm2-enables-arbitrary-code-execution) -- Critical sandbox escape (HIGH confidence)
- [isolated-vm GitHub](https://github.com/laverdet/isolated-vm) -- V8 isolate alternative (MEDIUM confidence, not recommended for this use case)
- [Pino vs Winston comparison](https://betterstack.com/community/comparisons/pino-vs-winston/) -- Logger performance benchmarks (MEDIUM confidence)

---
*Stack research for: InfraBrain -- Local-first AI IT Operations Platform*
*Researched: 2026-03-07*
