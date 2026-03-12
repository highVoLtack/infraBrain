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

## Cross-Milestone Trends

### Process Evolution

| Milestone | Commits | Phases | Key Change |
|-----------|---------|--------|------------|
| v1.0 | 143 | 7 | First milestone — established GSD workflow, TDD, audit-driven gap closure |

### Cumulative Quality

| Milestone | Tests | Source LOC | Test LOC |
|-----------|-------|-----------|----------|
| v1.0 | 354 | 4,993 | 5,777 |

### Top Lessons (Verified Across Milestones)

1. Integration tests catch what unit tests miss — invest in cross-phase wiring tests early
2. Audit-driven development works — let the milestone audit tell you what's broken, then fix it systematically
