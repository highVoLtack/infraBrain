# Project Research Summary

**Project:** InfraBrain
**Domain:** Local-first AI IT Operations Platform (CLI, multi-agent, local LLMs)
**Researched:** 2026-03-07
**Confidence:** MEDIUM-HIGH

## Executive Summary

InfraBrain is a local-first, CLI-driven AI operations platform that uses local LLMs (via Ollama) to diagnose infrastructure problems, generate fix plans, execute remediation through isolated sub-agents, and verify results. The established pattern for building this type of tool is a hub-and-spoke orchestration architecture where a central orchestrator agent delegates atomic tasks to disposable sub-agents running in separate OS processes. The recommended stack is TypeScript on Node.js 22 LTS, using Vercel AI SDK for LLM abstraction, Commander.js for CLI, better-sqlite3 for persistence, and Markdown-based skill files for extensibility. This stack is well-validated with high-confidence sources across every major component except binary packaging.

The recommended approach is to build the safety infrastructure first -- circuit breakers, HITL approval gates, command validation, and audit logging -- before enabling any execution capability. InfraBrain's core differentiators are 100% on-premise operation (no data leaves the network), Markdown skill files that non-developers can author, transparent reasoning chains, and verification-driven remediation (test-driven fixes). These differentiators position it uniquely against cloud-dependent competitors (PagerDuty, Dynatrace, BigPanda) and heavy-infrastructure alternatives (StackStorm, Rundeck).

The primary risks are: (1) LLM hallucination generating dangerous commands on real infrastructure -- mitigated by strict HITL gates, command allowlists, and never using shell execution; (2) runaway automation cascades -- mitigated by circuit breakers and damage budgets as foundational primitives; (3) context window overflow causing silent loss of safety instructions -- mitigated by explicit token counting and aggressive log pre-filtering; and (4) standalone binary distribution complexity with native SQLite addon -- mitigated by early build pipeline validation. The local LLM quality gap versus cloud models is a fundamental constraint that must be addressed through skill design (decomposing complex reasoning into single-hop steps) rather than waiting for model improvements.

## Key Findings

### Recommended Stack

The stack centers on Node.js 22 LTS with TypeScript, chosen for the CLI ecosystem and async/await patterns needed for agent orchestration. Vercel AI SDK v6 (2.8M weekly npm downloads) provides the LLM abstraction layer, enabling provider swaps (Ollama to vLLM) without code changes. Commander.js handles CLI parsing, better-sqlite3 provides embedded SQLite, and Zod v4 unifies schema validation across the entire stack including AI SDK structured output.

**Core technologies:**
- **Vercel AI SDK v6**: LLM abstraction -- provider-agnostic interface with streaming, structured output, and tool calling built in
- **Commander.js 14.x**: CLI framework -- lightweight, battle-tested, ideal for command-driven (not TUI) interaction
- **better-sqlite3 12.x**: Embedded database -- synchronous API ideal for CLI tools, fastest Node.js SQLite binding
- **Node.js child_process (fork/spawn)**: Sub-agent isolation -- OS-level process boundary for blast-radius containment
- **Zod v4**: Schema validation -- 14x faster than v3, used by AI SDK for structured output, single validation library for entire stack
- **pino 9.x**: Structured logging -- 5x faster than Winston, JSON output aligns with audit trail requirement
- **Node.js SEA + seabox**: Binary distribution -- official path for standalone executables, seabox handles native addon extraction

**Critical version constraint:** AI SDK v6 requires Zod v4 (not v3). Commander 14.x requires matching @commander-js/extra-typings 14.x.

### Expected Features

**Must have (table stakes):**
- Diagnose-Plan-Execute-Verify loop -- the core workflow every AIOps tool provides
- Human-in-the-Loop approval with risk-based tiers (read auto-approves, write needs Y/N, destructive needs typed confirmation)
- Structured audit trail (decision log + before/after state diffs + queryable SQLite)
- Automatic rollback on failure to pre-change state snapshot
- Circuit breaker and damage budget per fix session
- Sub-agent execution with process isolation (separate LLM context + separate OS process)
- Skill/runbook definition system (Markdown-based)
- Log analysis and pattern recognition with pre-filtering
- Session state persistence and resumability
- CLI interface with machine-parseable JSON output

**Should have (differentiators):**
- 100% on-premise with local LLMs -- the core value proposition against cloud competitors
- Teach-any-system via Markdown skills -- non-developers can extend the platform
- Transparent reasoning chain -- no black-box AI, full decision visibility
- Verification-driven remediation (test-driven fixes) -- health check must pass after fix
- Progressive autonomy levels (OBSERVE / GUIDED / AUTONOMOUS per skill and environment)
- Standalone binary distribution -- zero runtime dependencies on target machine

**Defer (v2+):**
- Web UI dashboard -- build after API is stable and validated
- Multi-team / RBAC -- enterprise auth infrastructure
- Public skill marketplace -- requires community critical mass
- GraphRAG / knowledge graph -- overkill until managing 1000+ node environments
- ChatOps integration -- collaboration layer for larger teams
- Full autonomous mode -- existential risk; progressive autonomy is the safer path

### Architecture Approach

Hub-and-spoke orchestration with a central Orchestrator Agent coordinating isolated Sub-Agents through the Diagnose-Plan-Execute-Verify loop. Seven architectural layers from CLI to LLM abstraction. Sub-agents run as separate child processes with fresh LLM contexts -- they never communicate with each other, and all results flow back through the Orchestrator. Dual-state persistence writes to both SQLite (structured queries) and `.infrabrain/` files (human-readable, git-trackable). Safety is a cross-cutting concern with distinct checkpoints at pre-plan, pre-execution, during-execution, post-execution, and on-failure.

**Major components:**
1. **CLI + API Server** -- command parsing, session management, HITL prompts
2. **Orchestrator** -- diagnostic reasoning, skill loading, fix plan generation, task delegation
3. **Skill Loader** -- Markdown skill resolution, parsing, context injection into LLM prompts
4. **Sub-Agent Runner** -- spawns isolated child processes with task + skill + permissions
5. **Safety System** -- circuit breaker, damage budget, rollback manager, lock manager
6. **State Manager** -- dual-write to SQLite and filesystem, audit logging
7. **LLM Provider** -- Ollama default, pluggable interface for vLLM/llama.cpp

### Critical Pitfalls

1. **LLM hallucinated commands on real infrastructure** -- Never auto-execute write commands. Use `execFile`/`spawn` with `shell: false` and argument arrays, never `exec()`. Implement command allowlist/denylist. Show exact command in HITL approval prompt. This must exist before any execution capability.

2. **Runaway automation and cascading failures** -- Circuit breaker is a safety-critical primitive, not a feature. Three consecutive failures = automatic halt + rollback to session start snapshot. Damage budget limits write operations per fix plan. Stagnation detection halts loops with no state change.

3. **Context window overflow and silent truncation** -- Ollama defaults to 2048 tokens and silently truncates, dropping system prompts and safety instructions. Always set `num_ctx` explicitly (32K for orchestrator, 8-16K for sub-agents). Implement token counting. Aggressive log pre-filtering in every skill.

4. **Local LLM quality cliff on complex reasoning** -- Local 70B models fail on multi-hop inference chains. Design skills as "diagnostic ladders" with single-hop steps. Verify at every step, not just at the end. Support pluggable providers from day one for eventual cloud fallback.

5. **Binary packaging with native modules** -- better-sqlite3 is a native C++ addon that complicates SEA packaging. seabox handles extraction but adds complexity. Validate the build pipeline in week 1. Consider node:sqlite if it exits experimental status. Build CI for all target platforms early.

## Implications for Roadmap

Based on research, suggested phase structure:

### Phase 1: Foundation and Safety Primitives
**Rationale:** Architecture research identifies clear dependency chains -- LLM abstraction, state management, and CLI shell must exist before anything else. Pitfalls research demands safety primitives (command validation, HITL gate, circuit breaker) be foundational, not bolted on later.
**Delivers:** LLM provider interface (Ollama), state manager (SQLite + files), basic CLI shell, command validator with allowlist/denylist, HITL approval gate (traffic-light classification), context budget tracker with explicit `num_ctx` configuration.
**Addresses:** LLM Provider Interface, CLI Interface, State Persistence, HITL Approval (table stakes)
**Avoids:** Hallucinated command execution (Pitfall 1), silent context truncation (Pitfall 3), process isolation security gaps (Pitfall 6)

### Phase 2: Skill System and Orchestrator Brain
**Rationale:** The Orchestrator cannot reason without skills. Skill Loader must exist before the Orchestrator can diagnose or plan. This phase builds the "brain" that makes InfraBrain more than a command runner.
**Delivers:** Skill file format specification, Markdown parser (gray-matter + remark), Skill Loader with lazy resolution, Orchestrator diagnose + plan capabilities, audit logger capturing reasoning chain.
**Addresses:** Skill/Runbook System, Log Analysis, Diagnostic Reasoning, Transparent Reasoning Chain (table stakes + differentiators)
**Avoids:** Local LLM quality cliff (Pitfall 4) through diagnostic ladder skill design, context overflow (Pitfall 3) through skill-level pre-filtering

### Phase 3: Execution Engine and Safety Net
**Rationale:** Execution depends on having an Orchestrator that can generate plans and a safety system that can enforce limits. This phase connects the brain to the hands.
**Delivers:** Sub-Agent Runner with process isolation (fork + execa), circuit breaker, damage budget tracker, rollback manager with state snapshots, lock manager for target exclusivity.
**Addresses:** Sub-Agent Isolation, Circuit Breaker, Automatic Rollback, Execution Isolation (table stakes)
**Avoids:** Runaway automation (Pitfall 2), cascading failures, inter-agent trust exploitation (Pitfall 7)

### Phase 4: Verification and Core Loop Integration
**Rationale:** Verification-driven remediation is the differentiator that closes the Diagnose-Plan-Execute-Verify loop. This phase integrates all components into the end-to-end workflow.
**Delivers:** Verification system (test-driven fixes), session state persistence and resumability, full Diagnose-Plan-Execute-Verify loop, core planning and verification skills.
**Addresses:** Verification-Driven Remediation, Session Resumability, Core DPEV Loop (differentiators + table stakes)
**Avoids:** Fixes that "succeed" but do not resolve the problem, partial rollback gaps (Pitfall checklist)

### Phase 5: POC Scenario and Polish
**Rationale:** Everything must be proven end-to-end on a real scenario before claiming v1. The Docker/Nginx 502 POC validates the entire stack.
**Delivers:** Docker/Nginx 502 POC scenario with full loop, REST API server wrapping all capabilities, polished CLI commands with JSON output mode, comprehensive audit trail with model version pinning, prompt injection test cases.
**Addresses:** Docker/Nginx 502 POC, REST API, Full CLI (MVP definition items)
**Avoids:** Enterprise compliance gaps, "looks done but isn't" items from Pitfalls checklist

### Phase 6: Distribution and Hardening
**Rationale:** Binary packaging and cross-platform distribution are deferred to after core functionality is proven, but must happen before external users. This is the transition from "works on dev machine" to "ships to customers."
**Delivers:** Standalone binary via Node.js SEA + seabox, CI/CD for multi-platform builds (Linux x64/arm64, macOS x64/arm64), progressive autonomy levels, additional standard library skills.
**Addresses:** Standalone Binary, Progressive Autonomy (P2 features)
**Avoids:** Binary distribution failures (Pitfall 5), cross-platform surprises

### Phase Ordering Rationale

- **Safety before execution:** Research unanimously demands that command validation, HITL gates, and circuit breakers exist as primitives before any execution capability. Building execution first and adding safety later creates a window of dangerous operation.
- **Skills before orchestration:** The Orchestrator is useless without skills. Loading and parsing skills is a prerequisite, not a parallel workstream.
- **Verification before POC:** The verification system must work before the POC can prove the full loop. A POC without verification proves nothing about production readiness.
- **Binary packaging after core functionality:** Pitfalls research warns against deferring binary decisions indefinitely, but the core loop must work first. Phase 6 is late enough to have a working product but early enough to catch packaging issues before launch.
- **API Server late:** The CLI can call the Orchestrator directly in early phases. The REST API is a formalization that enables future clients (Web UI, ChatOps) but is not a prerequisite for the core loop.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 1:** LLM abstraction layer -- Ollama community provider compatibility with AI SDK v6 needs hands-on validation. Token counting approach needs prototyping.
- **Phase 2:** Skill file format -- no industry standard exists for Markdown-as-skill-definition. Format specification needs design iteration with real skill examples.
- **Phase 3:** Sub-agent process isolation -- the boundary between process isolation and security isolation needs careful implementation. `execFile` with `shell: false` patterns need security review.
- **Phase 6:** SEA binary packaging with native modules -- seabox is relatively new tooling. Cross-platform build matrix needs early CI experimentation.

Phases with standard patterns (skip deep research):
- **Phase 4:** Verification and session management -- well-documented patterns (health checks, file-based state persistence)
- **Phase 5:** REST API and CLI polish -- standard Node.js patterns with Commander.js and Express/Fastify

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | MEDIUM-HIGH | Core technologies (AI SDK, Commander, better-sqlite3, Zod) verified with official sources and high npm adoption. Binary packaging (SEA + seabox) is the weak point -- newer tooling with less battle-testing. |
| Features | MEDIUM-HIGH | Table stakes validated against multiple competitors (Rundeck, StackStorm, PagerDuty, Dynatrace). Differentiators are sound but "local LLM quality" is an ongoing constraint. Anti-features list is well-reasoned. |
| Architecture | HIGH | Hub-and-spoke orchestration validated by Microsoft Azure Architecture Center. Process isolation, dual-state persistence, and skill-as-context-injection all have authoritative sources. Build order is dependency-driven and clear. |
| Pitfalls | HIGH | Every critical pitfall backed by multiple sources including CVEs, OWASP standards, and production post-mortems. Prevention strategies are concrete and actionable. |

**Overall confidence:** MEDIUM-HIGH

### Gaps to Address

- **Ollama AI SDK v6 compatibility:** The community provider for Ollama targeting AI SDK v6 needs hands-on validation. Peer dependency alignment between ai@6.x and ollama-ai-provider is assumed but untested.
- **node:sqlite vs. better-sqlite3 decision:** Pitfalls research suggests node:sqlite (built-in) to eliminate native module packaging complexity. Stack research recommends better-sqlite3 for maturity. This trade-off needs a concrete decision during Phase 1 planning -- test both and pick one.
- **Skill file format specification:** No standard exists. The format must be designed, documented, and validated with real skill examples before the Skill Loader can be built. This is a design task, not a research task.
- **Local model selection and benchmarking:** Llama-3.3-70B for orchestration and Qwen2.5-Coder-7B for execution are recommended but not benchmarked against InfraBrain's specific task types. Early Phase 2 should include model evaluation on representative diagnostic scenarios.
- **Cross-platform binary testing:** SEA builds need CI validation on Linux x64, Linux arm64, macOS x64, and macOS arm64. No testing has been done. This should be validated with a minimal binary in Phase 1, not deferred to Phase 6.

## Sources

### Primary (HIGH confidence)
- [Vercel AI SDK 6 announcement and docs](https://vercel.com/blog/ai-sdk-6) -- LLM abstraction, structured output, provider interface
- [Microsoft Azure AI Agent Design Patterns](https://learn.microsoft.com/en-us/azure/architecture/ai-ml/guide/ai-agent-design-patterns) -- orchestration patterns
- [Node.js SEA documentation](https://nodejs.org/api/single-executable-applications.html) -- binary packaging
- [OWASP ASI08: Cascading Failures in Agentic AI](https://adversa.ai/blog/cascading-failures-in-agentic-ai-complete-owasp-asi08-security-guide-2026/) -- safety patterns
- [obra/superpowers](https://github.com/obra/superpowers) -- skill-as-Markdown architecture
- [vm2 CVE-2026-22709](https://www.endorlabs.com/learn/cve-2026-22709-critical-sandbox-escape-in-vm2-enables-arbitrary-code-execution) -- sandbox escape justifying OS-level isolation
- [Ollama API documentation](https://github.com/ollama/ollama/blob/main/docs/api.md) -- LLM integration

### Secondary (MEDIUM confidence)
- [AgentFS / Turso](https://turso.tech/blog/agentfs) -- SQLite-as-agent-state pattern
- [AI Agent Safety: Circuit Breakers](https://www.syntaxia.com/post/ai-agent-safety-circuit-breakers-for-autonomous-systems) -- damage budget patterns
- [Inter-agent trust exploitation research](https://arxiv.org/html/2507.06850v5) -- multi-agent security
- [Thoughtworks AIOps lessons learned](https://www.thoughtworks.com/insights/blog/generative-ai/aiops-what-we-learned-in-2025) -- production pitfalls
- [seabox GitHub](https://github.com/MeirionHughes/seabox) -- native addon extraction for SEA

### Tertiary (LOW confidence)
- [Network-AI TypeScript Multi-Agent Orchestrator](https://github.com/jovanSAPFIONEER/Network-AI) -- reference implementation, small project
- [Node.js 25.5 --build-sea](https://progosling.com/en/dev-digest/2026-01/nodejs-25-5-build-sea-single-executable) -- news source for SEA improvements

---
*Research completed: 2026-03-07*
*Ready for roadmap: yes*
