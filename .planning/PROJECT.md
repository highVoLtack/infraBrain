# InfraBrain

## What This Is

A universal, locally-hosted AI operations platform for enterprise IT. InfraBrain is an agnostic "reasoning & execution engine" that learns capabilities through composable Markdown skill files. Admins interact via CLI, the system diagnoses problems, plans fixes, executes them through isolated sub-agents, and verifies results — all running 100% on-premise with local LLMs. Think of it as a new AI-powered IT team member that learns any system through skill files instead of months of onboarding.

## Core Value

The AI diagnoses, plans, and fixes infrastructure problems autonomously while the human admin retains full control — every critical action requires approval, every decision is auditable, and the system can be taught any IT system through simple Markdown files.

## Requirements

### Validated

<!-- Shipped and confirmed valuable. -->

(None yet — ship to validate)

### Active

- [ ] Agnostic core engine (Diagnose -> Plan -> Execute -> Verify loop)
- [ ] CLI interface with commands like `/infra:debug`
- [ ] REST/gRPC API backend powering the CLI
- [ ] Composable skills library (Markdown files defining prompts + available tool calls)
- [ ] Abstracted LLM provider interface (Ollama default, pluggable for vLLM, llama.cpp, etc.)
- [ ] Sub-agent execution with full process isolation (separate LLM context + sandboxed child process)
- [ ] Configurable Human-in-the-Loop (risk-based: read-only auto-approves, write commands need approval)
- [ ] Dual state storage (human-readable files in .infrabrain/ + SQLite for queryable data)
- [ ] Lock-based concurrency (one active fix per target, others see status, force-override available)
- [ ] Structured audit trail (decision log + before/after state diffs, queryable JSON)
- [ ] Circuit breaker + damage budget safety system (max retries + max blast radius per fix plan)
- [ ] Automatic rollback to last-known-good state when safety limits are hit
- [ ] Core skills: planning, verification, infrastructure mapping, log analysis
- [ ] v1 POC: Docker/Nginx 502 debug scenario (detect, diagnose, fix, verify end-to-end)
- [ ] Standalone binary distribution (via pkg/nexe, no Node.js required)

### Out of Scope

- GraphRAG / Neo4j integration — deferred to future, overkill for v1
- Public skill marketplace — requires community; build after v1 proves the model
- Private skill repositories (enterprise git integration) — future enterprise feature
- OAuth/multi-tenant auth — v1 is single-instance, single-team
- Mobile or web UI — CLI-first, web interface is a future layer
- Cloud-hosted option — privacy-first, 100% on-premise only

## Context

- Inspired by two open-source projects: GSD (context engineering, spec-driven workflows) and obra/superpowers (composable skills library as Markdown)
- Target users: IT admins, SysOps teams, CTOs at enterprises with complex/heterogeneous infrastructure
- The platform pitch: "We deliver the intelligent engine. You teach it your systems through skill files." This solves the B2B customization problem without custom code per client
- Key differentiator vs cloud AI ops tools: 100% local (critical for banks, government, Mittelstand), fully transparent reasoning (Markdown skills, not black-box), human always in the loop
- The v1 demo (Nginx 502 fix) is designed as an investor/customer proof point showing the full Diagnose -> Plan -> Execute -> Verify loop

## Constraints

- **Tech stack**: Node.js/TypeScript — aligns with CLI tooling ecosystem and async patterns
- **LLM runtime**: Must work fully offline with local models via Ollama (Llama-3.3-70B for orchestration, Qwen2.5-Coder-7B for execution)
- **Distribution**: Standalone binary — admins should not need Node.js installed
- **Privacy**: Zero cloud dependencies, zero telemetry, all data stays local
- **Safety**: No automated action on production systems without explicit safety guardrails (circuit breaker, damage budget, HITL)

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| TypeScript over Python | Better CLI tooling, strong async, closer to GSD/obra ecosystem | — Pending |
| CLI + API architecture | API-first enables future clients (web, integrations) while CLI ships first | — Pending |
| Abstracted LLM provider | Avoid vendor lock-in to Ollama; enterprises may run vLLM or llama.cpp | — Pending |
| Lock-based concurrency | Explicit, easy to reason about for v1; can evolve to queue-based later | — Pending |
| Decision log + diffs (no full transcripts) | Auditability without excessive storage; full replay deferred | — Pending |
| Circuit breaker + damage budget | Belt-and-suspenders safety; recursive loops are existential risk for infra tools | — Pending |
| Alert + rollback on safety halt | Safest default for enterprise; admin can inspect rolled-back state | — Pending |
| Both file + SQLite state | Files for human readability/git tracking, SQLite for structured queries | — Pending |
| Full sub-agent isolation (LLM + process) | Prevents context contamination AND limits blast radius of execution | — Pending |

---
*Last updated: 2026-03-07 after initialization*
