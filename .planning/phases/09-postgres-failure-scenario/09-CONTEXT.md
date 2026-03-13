# Phase 9: Postgres Failure Scenario - Context

**Gathered:** 2026-03-13
**Status:** Ready for planning

<domain>
## Phase Boundary

Complete vertical slice proving autonomous Postgres connection-limit diagnosis and recovery through a full DPEV loop. Includes: Docker Compose environment with connection-leaking app, `postgres-troubleshoot.md` diagnostic skill, idempotent reset script, and automated E2E test. This scenario is the stress test for Phase 8 (Rolling Context) — the multi-step fix plan MUST carry PIDs between execution steps.

Requirements: SCEN-01, SCEN-02, SCEN-03, E2E-01

</domain>

<decisions>
## Implementation Decisions

### Connection Leak Mechanism (Docker Compose Environment)
- Python leaky-app container (psycopg2) opens 18 connections to Postgres and holds them forever
- Postgres configured with `max_connections=20` — leaves 2 free slots for superuser diagnostic access
- Leaky-app uses retry-loop with 2s backoff for Postgres readiness (no depends_on healthcheck)
- Leaky-app prints clear intent messages (`"Holding 18 connections open..."`) for demo legibility
- Postgres image: `postgres:16`, host port `5433` (non-default to avoid collisions with local Postgres)
- Leaky-app Dockerfile: `python:3-slim` + `pip install psycopg2-binary`, ~10 lines of Python

### Diagnostic Ladder (postgres-troubleshoot.md Skill)
- 5-step Diagnostic Ladder establishing the "Database Skill Archetype": Discovery → Saturation Check → Activity Analysis → Topology Correlation → Remediation
- Step 0 (Container Discovery): `docker ps`, `docker network inspect` — extract container names and IP-to-container mapping
- Step 1 (Connection Saturation Check): `SELECT count(*) FROM pg_stat_activity` + `SHOW max_connections`
- Step 2 (Idle Connection Analysis): `SELECT pid, state, client_addr, query, state_change FROM pg_stat_activity WHERE state = 'idle'`
- Step 3 (Cross-Domain Correlation): Map `client_addr` from pg_stat_activity to container names via pre-injected Docker topology — proves cross-stack reasoning (DB state → container topology → root cause)
- Step 4 (Fix Proposal): Generate multi-step fix plan with surgical PID-based termination
- All discovery data (Docker topology + pg_stat_activity + connection counts) pre-injected via discovery commands — LLM does pure reasoning, not data gathering ("Wir liefern die Fakten, die KI liefert die Intelligenz")
- Skill uses `preferred_model: forensic` (DeepSeek-R1) — cross-domain correlation is hidden causality analysis
- Tool allowlist: `docker`, `psql`

### Fix Strategy (Multi-Step Rolling Context Proof)
- 3-step fix plan: Identify PIDs → Terminate Connections → Verify Recovery
- Step 1 (read): `SELECT pid FROM pg_stat_activity WHERE state='idle' AND client_addr='<leaky-app-ip>'` — captures specific PIDs
- Step 2 (write, Y/n approval): `pg_terminate_backend(pid)` for each PID identified in Step 1 — uses EXACT PIDs via rolling context
- Step 3 (read): `SELECT count(*) FROM pg_stat_activity` — confirms connection count recovered
- Risk classification: pg_terminate_backend = `write` (Y/n prompt), not `destructive` — connections are already leaked/idle
- The PID handoff from Step 1 → Step 2 is THE proof point for Phase 8's rolling context injection

### Demo Directory Structure (Chaos Library Foundation)
- Subdirectories per scenario: `demo/nginx/`, `demo/postgres/`, future `demo/docker-storage/`
- Phase 9 moves existing nginx demo files into `demo/nginx/` (update poc-nginx-502.test.ts paths)
- Phase 9 creates `demo/postgres/` with: docker-compose.yml, leaky-app/ (Dockerfile + leak.py), reset-postgres.sh
- All scenarios follow the "Scenario Standard": `demo/<scenario-name>/` containing compose file, reset script, and supporting files
- `reset-postgres.sh` is idempotent: tears down, recreates, and verifies broken state (polls until "too many connections" confirmed, exits non-zero if broken state not reached within 60s)

### E2E Test Design
- Mock LLM responses (same pattern as poc-nginx-502.test.ts) — deterministic, fast, no GPU dependency
- Canned skill selection, diagnosis, and fix plan with pre-determined PIDs
- Test validates full DPEV loop: broken state → diagnosis → multi-step fix plan → execution → recovery verification → audit trail completeness
- Future: optional LLM-Integration-Mode flag for occasional full-stack tests against real LLM

### Claude's Discretion
- Exact leaky-app Python implementation details (connection timing, error handling)
- Docker network naming and configuration
- E2E test timeout values and polling intervals
- Exact psql connection strings and authentication in discovery commands
- TOON encoding thresholds for diagnostic evidence compression
- init.sql usage (if needed for database setup)

</decisions>

<specifics>
## Specific Ideas

- This scenario is the "ultimate stress test" for Phase 8 (Rolling Context) and TOON encoding — the fix plan must prove sub-agents carry context between execution steps
- The cross-domain correlation (pg_stat_activity.client_addr → docker inspect → container name) is the key differentiator — proves InfraBrain "thinks across stack layers"
- The 5-step Diagnostic Ladder establishes a repeatable archetype for all database skills: Discovery → Saturation → Activity → Correlation → Remediation
- Pre-injection of all evidence (topology + DB state) transforms the LLM task from "search" to pure "analysis" — minimizes latency, eliminates risk of faulty SQL from the AI
- "Wir liefern die Fakten, die KI liefert die Intelligenz" — discovery commands deliver facts, LLM delivers intelligence
- Chaos Library directory structure (`demo/<scenario>/`) enables future `infra:test-all` command to auto-discover and run all scenarios

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `demo/docker-compose.yml` + `demo/reset.sh` + `demo/nginx.conf`: Phase 5 Nginx scenario — template for Postgres scenario structure
- `skills/nginx-troubleshoot.md`: Diagnostic Ladder pattern (5 steps) — template for postgres-troubleshoot.md
- `tests/e2e/poc-nginx-502.test.ts`: E2E test pattern (vitest + supertest + mocked LLM) — template for poc-postgres-failover.test.ts
- `src/api/routes/debug.ts`: Discovery commands registry (lines 84-89) — add postgres-troubleshoot entries
- `src/execution/executor.ts`: Rolling context already wired (Phase 8) — multi-step fix plans carry context automatically

### Established Patterns
- Discovery commands prevent LLM hallucination by injecting ground truth before diagnosis
- Fix plan validation ensures plans use only names discovered in Step 0
- Risk-based approval: READ=auto, WRITE=Y/n, DESTRUCTIVE=typed confirmation
- Multi-model registry: `preferred_model` in skill frontmatter routes to appropriate model
- TOON encoding compresses structured data before LLM injection

### Integration Points
- `src/api/routes/debug.ts` line 84: Add `DISCOVERY_COMMANDS['postgres-troubleshoot']` with docker and psql commands
- `skills/` directory: Add `postgres-troubleshoot.md` (auto-loaded by registry)
- `demo/postgres/`: New scenario directory with compose, leaky-app, reset script
- `tests/e2e/`: New `poc-postgres-failover.test.ts` following existing pattern
- Existing E2E test `poc-nginx-502.test.ts`: Update paths after nginx files move to `demo/nginx/`

</code_context>

<deferred>
## Deferred Ideas

- `infra:test-all` command that auto-discovers and runs all scenarios in `demo/` — future automation phase
- LLM-Integration-Mode flag for full-stack E2E tests against real LLM — future test infrastructure
- Connection pool reconfiguration as alternative fix strategy (vs surgical termination) — more complex, different scenario
- `docker restart leaky-app` as additional fix step to prevent re-leak — scope creep, the demo proves DPEV loop not app lifecycle management
- `/infra:report <session-id>` post-mortem report generation — already deferred from Phase 5

</deferred>

---

*Phase: 09-postgres-failure-scenario*
*Context gathered: 2026-03-13*
