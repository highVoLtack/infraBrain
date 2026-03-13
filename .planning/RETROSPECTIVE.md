# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

## Milestone: v1.0 — InfraBrain MVP

**Shipped:** 2026-03-12
**Phases:** 7 | **Plans:** 22 | **Commits:** 143

### What Was Built
- Full DPEV loop (Diagnose → Plan → Execute → Verify) with safety-first execution engine
- Teachable skill system — Markdown files define prompts, tool allowlists, and diagnostic ladders
- Circuit breaker + damage budget + automatic rollback safety net
- CLI with status, history, resume, JSON output, and queryable SQLite audit trail
- Docker/Nginx 502 POC proving end-to-end autonomous infrastructure fix with human oversight
- Multi-model registry with domain-expertise routing (default/strategic/forensic)

### What Worked
- **GSD workflow** delivered a complete platform from zero in 6 days — research → plan → execute → verify loop caught integration gaps early
- **Three audit cycles** found and closed all integration gaps before shipping — resume wiring, lock audit events, metadata persistence, log pre-filtering, formatter key alignment
- **Parallel plan execution** in Phase 7 — all 3 independent plans ran simultaneously, maximizing throughput
- **TDD approach** — writing failing tests first caught wiring issues before they reached verification

### What Was Inefficient
- **Phase 6+7 were avoidable** — gaps like "stub runner in resume route" and "metadata column missing" could have been caught during Phase 3-4 execution if integration tests had been more thorough
- **Three audit cycles** to reach 100% — first audit found 2 gaps, second found 3 more, third found 2 key mismatches. A single comprehensive integration test suite would have caught all at once
- **ROADMAP.md Phase 6 status tracking** was stale — showed "1/2 In progress" after both plans were complete

### Patterns Established
- **Gap closure phases** — audit-identified gaps become new phases with clear success criteria
- **Metadata key alignment** — formatter must use the exact same keys the executor writes (no assumptions)
- **Three-source cross-reference** for requirements — VERIFICATION + SUMMARY frontmatter + REQUIREMENTS traceability table
- **Integration checker as separate agent** — catches cross-phase wiring that per-phase verifiers miss

### Key Lessons
1. **Write integration tests early, not just unit tests** — unit tests verified each module in isolation but missed wiring gaps (stub runners, missing columns, orphaned exports)
2. **Audit trail metadata must be designed at schema time** — adding a metadata column later required migration logic; should have been in the initial audit_log schema
3. **Formatter and logger are coupled** — any change to audit event metadata keys must update both the emitter and the display layer simultaneously
4. **Minimal viable scope is acceptable** — CORE-07 (rolling context) was downscoped to "expose on result" and accepted; shipping > perfection

### Cost Observations
- Model mix: ~40% opus (orchestration, execution), ~50% sonnet (verification, research, planning), ~10% haiku (quick checks)
- Notable: Parallel agent execution in Wave 1 of Phase 7 completed 3 plans simultaneously in ~8 minutes

---

## Milestone: v1.1 — The Scenario Factory

**Shipped:** 2026-03-13
**Phases:** 4 | **Plans:** 10

### What Was Built
- Postgres connection leak POC — full DPEV loop with Engine-First SQL Rewriter and DeepSeek R1 forensic routing
- Docker storage bloat POC — causal deduplication distinguishes log bloat from state data before remediation
- Engine-First Architecture — SQL Rewriter, findDbContainer, stripHostFlag, Sanity Checker, Routing Enforcement
- Anti-hallucination hardening — MANDATORY_EXECUTION_PROTOCOL, GROUND TRUTH labels, Zod schema enforcement, structured diagnosis
- Rolling context injection — sub-agent LLM calls receive prior step results (CORE-07 closed)
- UX polish — /infra:history defaults to latest, session aliases, DPEV summary, structured diagnosis table

### What Worked
- **Engine-First Architecture** — shifting command syntax from prompts to TypeScript eliminated all syntax hallucination. The LLM writes SQL, the engine handles docker exec wrapping, container targeting, TTY sanitization, and auth
- **Iterative hardening** — the Postgres POC went through 6 iterations (routing fix, sanity checker, command rewriter, skill simplification, container targeting, host flag stripping). Each iteration was a focused, testable improvement
- **Structured diagnosis via Zod** — `generateObject` with a strict schema prevented free-text essays and enforced max 5 diagnostic steps
- **Discovery-as-GROUND-TRUTH** — running real commands before LLM inference and labeling results as GROUND TRUTH significantly reduced hallucination

### What Was Inefficient
- **6 iterations on Postgres skill** — the skill was rewritten 6 times before landing on SQL-only mode. Should have started with Engine-First from the beginning
- **Routing bug persisted across 3 iterations** — the `preferred_model` routing issue kept resurfacing because initial checks were soft (warning, then 503 with identity check). A three-layer check (identity + modelId + unknown sentinel) was needed from the start
- **No formal milestone audit** — skipped `/gsd:audit-milestone` due to user's explicit ship instruction. Future milestones should run the audit

### Patterns Established
- **SQL-only skills** — diagnostic skills write raw SQL, engine wraps in docker exec. Eliminates an entire class of hallucination
- **findDbContainer** — smart container selection scans for DB patterns (postgres > pg > db) instead of first-container
- **Sanity Checker with auto-retry** — scan for hallucination patterns, retry once with penalty prompt, halt on second failure (422)
- **Routing Enforcement** — hard 503 with debug payload when preferred_model can't resolve to distinct model
- **POSTGRES_HOST_AUTH_METHOD: trust** — demo environments use trust auth for automated docker exec

### Key Lessons
1. **Push complexity into TypeScript, not prompts** — deterministic code is more reliable than prompt engineering. The SQL Rewriter solved in 20 lines what 6 prompt rewrites couldn't
2. **Three-layer checks for critical paths** — single-condition checks get bypassed by edge cases. The routing enforcement needed identity + modelId + unknown sentinel
3. **Discovery before inference** — running real commands and injecting results as GROUND TRUTH is more effective than telling the LLM to "run these commands"
4. **Structured output (Zod) beats free text** — `generateObject` with schema enforcement prevents essays, enforces step limits, and enables clean CLI display

### Cost Observations
- Model mix: ~50% opus (orchestration, iterative hardening), ~30% sonnet (execution, verification), ~20% haiku (quick file reads)
- Notable: Postgres POC required 6 iterative sessions but produced a robust Engine-First architecture that benefits all future skills

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Commits | Phases | Key Change |
|-----------|---------|--------|------------|
| v1.0 | 143 | 7 | First milestone — established GSD workflow, TDD, audit-driven gap closure |
| v1.1 | ~60 | 4 | Engine-First architecture — push complexity from prompts to TypeScript |

### Cumulative Quality

| Milestone | Tests | Source Files | Skills |
|-----------|-------|-------------|--------|
| v1.0 | 354 | 57 | 4 |
| v1.1 | 440 | 59 | 6 |

### Top Lessons (Verified Across Milestones)

1. Integration tests catch what unit tests miss — invest in cross-phase wiring tests early
2. Audit-driven development works — let the milestone audit tell you what's broken, then fix it systematically
3. Push complexity into code, not prompts — deterministic TypeScript beats prompt engineering for command syntax
4. Discovery before inference — inject real system data as GROUND TRUTH before asking the LLM to reason
