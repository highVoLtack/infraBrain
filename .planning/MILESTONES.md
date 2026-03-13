# Milestones

## v1.1 The Scenario Factory (Shipped: 2026-03-13)

**Phases completed:** 4 phases, 10 plans | 440 tests | 59 source files | 6 skills
**Timeline:** 1 day (2026-03-13)
**Requirements:** 13/13 satisfied | CORE-07 tech debt resolved

**Key accomplishments:**
1. Engine-First Architecture — SQL Rewriter wraps bare SQL in docker exec, findDbContainer targets DB containers, stripHostFlag forces local socket, risk auto-override for pg_terminate_backend
2. Postgres Connection Leak POC — 100% success with DeepSeek R1 forensic routing, 3-step surgical fix (identify PIDs → terminate backends → verify recovery)
3. Docker Storage Bloat POC — Causal deduplication distinguishes log bloat from state data, truncate-over-rm for inode preservation, dual verification (disk + app health)
4. Anti-Hallucination Hardening — MANDATORY_EXECUTION_PROTOCOL in base system prompt, GROUND TRUTH/ROLLING CONTEXT labels, Sanity Checker with auto-retry (422 on failure), structured Zod diagnosis schema (max 5 steps)
5. Forensic Routing Enforcement — Hard 503 if preferred_model can't resolve to distinct model, three-layer check (object identity + modelId + unknown sentinel)
6. UX Polish — /infra:history defaults to latest session, aliases (last/previous), DPEV summary, structured diagnosis table with 50-char truncation

**Tech debt resolved:**
- CORE-07: Rolling context now flows through executor (onBeforeStep callback) and routes (audit events)

**New tech debt:**
- E2E tests for Postgres/Docker Storage require Docker running (skip in CI without Docker)
- preFilterIfLogHeavy wasFiltered return value still unused for telemetry

---

## v1.0 InfraBrain MVP (Shipped: 2026-03-12)

**Phases completed:** 7 phases, 22 plans | 354 tests | 10,770 LOC TypeScript
**Timeline:** 6 days (2026-03-07 → 2026-03-12)
**Requirements:** 39/39 satisfied | 3 audit cycles | 0 gaps remaining

**Key accomplishments:**
1. LLM-powered infrastructure diagnostics — Ollama-backed AI provider with pluggable models, token budget enforcement, and multi-model registry
2. Teachable skill system — Markdown-based skill files with validation, LLM-based routing, and four log format parsers with runtime pre-filtering
3. Safety-first execution engine — Circuit breaker, damage budget, pre-execution snapshots, automatic rollback, and file-based target locking
4. Full operational visibility — CLI status dashboard, queryable audit trail with metadata persistence, JSON output mode, and session resumability
5. Proven DPEV loop — Docker/Nginx 502 end-to-end demo: diagnose → plan → execute → verify with full audit trail
6. Production-grade wiring — Three audit cycles closed all integration gaps across 7 phases

**Accepted tech debt (v1.1 backlog):**
- CORE-07: RollingContext exposed on ExecutionResult but not injected into sub-agent LLM calls
- Minor: preFilterIfLogHeavy wasFiltered return value unused for telemetry

---

