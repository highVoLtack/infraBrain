# Phase 10: Docker Storage Failure Scenario - Context

**Gathered:** 2026-03-13
**Status:** Ready for planning

<domain>
## Phase Boundary

Complete vertical slice proving autonomous Docker volume-full diagnosis and recovery through a full DPEV loop. Includes: Docker Compose environment with mixed bloat (log + Redis), `docker-storage.md` diagnostic skill, idempotent reset script, and automated E2E test. This scenario proves **Causal Deduplication** — the AI must distinguish safe-to-prune bloat from critical state data before proposing risk-tiered fixes.

Requirements: SCEN-04, SCEN-05, SCEN-06, E2E-02

</domain>

<decisions>
## Implementation Decisions

### Storage Failure Mechanism (Docker Compose Environment)
- **Mixed bloat** scenario with two containers sharing a tmpfs volume (10MB size cap)
- Container A ("logger"): App that spams log files to shared tmpfs — the **cause** of bloat
- Container B ("redis"): Redis using shared tmpfs for RDB persistence — the **victim** that crashes
- Logger fills tmpfs via `dd if=/dev/zero of=/shared/bloat.log bs=1M count=9` in entrypoint (instant, deterministic, CI-fast), then continues slow writes
- Redis crashes when RDB save fails on full disk — clear causal chain: logger causes bloat, Redis is victim
- tmpfs chosen for atomicity, speed, and environment-agnostic behavior — no host disk impact, instant reset
- Host port for Redis: non-default to avoid collisions with local Redis instances

### Diagnostic Ladder (docker-storage.md Skill) — Archetype Protocol
- 5-step Diagnostic Ladder following the **Archetype Protocol**: same DPEV structure as all skills, domain-tailored rung names
- Step 0 (Container Discovery): `docker ps`, `docker network inspect` — extract container names and mount topology
- Step 1 (Capacity Check): `df -h` inside containers on shared volume + `docker system df` — overall Docker storage usage
- Step 2 (Ownership Analysis): `du -sh` per directory on shared volume inside each container — breaks down per-container space ownership
- Step 3 (Causal Deduplication): LLM analyzes ownership data — Logger owns 9MB/10MB, Redis owns 0.5MB. Classifies: log bloat (safe to truncate) vs Redis data (critical state). **This is the key proof point** — the AI must identify the specific cause before proposing a fix
- Step 4 (Risk-Tiered Remediation): Generate multi-step fix plan with risk-appropriate actions per bloat type
- 5 discovery commands pre-inject all evidence — LLM does pure reasoning, not data gathering ("Wir liefern die Fakten, die KI liefert die Intelligenz")
- Skill uses `preferred_model: default` (Qwen) — storage analysis is structured/procedural, reserves forensic model for deep causality
- Tool allowlist: `docker`, `redis-cli`, `df`, `du`, `truncate`

### Fix Strategy (4-Step Rolling Context Proof)
- 4-step fix plan proving rolling context carries file paths and container names across steps:
- Step 1 (read): Identify bloat source files via `du`/`ls` on shared volume — captures specific file paths
- Step 2 (write, Y/n approval): `truncate -s 0` on bloated log files — preserves inode to avoid file handle leakage, zero disruption to logger service. Risk: WRITE
- Step 3 (write, Y/n approval): `docker restart redis` — structured restart to restore Redis to writable state. Proves InfraBrain understands service lifecycle, not just filesystem state. Risk: WRITE
- Step 4 (read): Dual verification — `df -h` shows free space recovered AND `redis-cli PING` returns PONG. **Verification Archetype**: physical resource + application-layer health (eliminates "False Green" problem)
- File path handoff from Step 1 → Step 2 and container name handoff to Step 3 are THE proof points for rolling context

### Demo Directory Structure (Chaos Library Pattern)
- Follows established Scenario-per-Directory pattern: `demo/docker-storage/`
- Contains: docker-compose.yml, logger/ (Dockerfile + entrypoint), reset-docker-storage.sh
- Note: ROADMAP.md currently says `demo/reset-docker-storage.sh` (top-level) — needs path correction to `demo/docker-storage/reset-docker-storage.sh`

### Reset Script (reset-docker-storage.sh)
- Idempotent: tears down, recreates, and verifies broken state
- Logger fills tmpfs instantly via dd — broken state reached in <5s
- Dual broken-state verification: tmpfs 100% full + `redis-cli PING` fails (connection refused)
- Both conditions must be true before exit
- 60s timeout (standardized across all scenarios for CI reliability)
- Exits non-zero if broken state not reached within timeout

### E2E Test Design
- Mock LLM responses (same pattern as poc-nginx-502.test.ts and poc-postgres-failover.test.ts) — deterministic, fast, no GPU dependency
- Canned skill selection, diagnosis with Causal Deduplication reasoning, and 4-step fix plan
- Test validates full DPEV loop: broken state → diagnosis with bloat classification → risk-tiered fix plan → execution → recovery verification → audit trail completeness
- 60s timeout for Docker operations (matching Phase 9)

### Claude's Discretion
- Exact logger container implementation (base image, entrypoint script details)
- Docker network naming and configuration
- Redis configuration (RDB save frequency, persistence settings to ensure crash on disk-full)
- Exact discovery command formatting and TOON encoding
- E2E test mock response content and assertion details
- tmpfs size (10MB suggested, Claude may adjust for optimal demo behavior)

</decisions>

<specifics>
## Specific Ideas

- **Causal Deduplication is the headline feature** — the AI must distinguish log bloat (safe) from Redis data (critical) before proposing ANY fix. This differentiates InfraBrain from blind cleanup tools
- **Archetype Protocol**: Every skill follows the same 5-step DPEV loop, but diagnostic rungs are domain-tailored. Storage uses: Discovery → Capacity Check → Ownership Analysis → Causal Deduplication → Risk-Tiered Remediation
- **Verification Archetype**: Dual verification (physical resource + application health) becomes the standard pattern. Eliminates "False Green" where containers look healthy but are functionally broken
- **`truncate -s 0`** chosen deliberately over `rm` to preserve inode and avoid file handle leakage — standard "Safe Remediation" pattern for log bloat
- **Service lifecycle awareness**: The Redis restart step proves InfraBrain understands that freeing disk space alone doesn't fix a crashed service — it needs structured recovery
- **Scenario-per-Directory pattern** (`demo/<scenario>/`) enables future "Chaos Monkey" agent to auto-discover all scenarios without manual index maintenance

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `demo/postgres/docker-compose.yml` + `demo/postgres/reset-postgres.sh`: Phase 9 scenario — direct template for docker-storage scenario structure
- `skills/postgres-troubleshoot.md`: Diagnostic Ladder pattern (5 steps) — template for docker-storage.md with storage-adapted rung names
- `tests/e2e/poc-nginx-502.test.ts` + postgres E2E test: Test patterns (vitest + supertest + mocked LLM) — template for storage E2E test
- `src/api/routes/debug.ts` line 84: `DISCOVERY_COMMANDS` registry — add `docker-storage` entries with docker, df, du commands
- `src/execution/executor.ts`: Rolling context already wired (Phase 8) — 4-step fix plan carries context automatically

### Established Patterns
- Discovery commands prevent LLM hallucination by injecting ground truth before diagnosis
- Risk-based approval: READ=auto, WRITE=Y/n, DESTRUCTIVE=typed confirmation
- Multi-model registry: `preferred_model` in skill frontmatter (this skill uses default/Qwen)
- TOON encoding compresses structured data before LLM injection
- Scenario-per-Directory: `demo/<scenario-name>/` with compose, reset script, supporting files

### Integration Points
- `src/api/routes/debug.ts`: Add `DISCOVERY_COMMANDS['docker-storage']` with docker, df, du commands (5 commands)
- `skills/`: Add `docker-storage.md` (auto-loaded by registry)
- `demo/docker-storage/`: New scenario directory with compose, logger app, reset script
- `tests/e2e/`: New E2E test following established mock pattern

</code_context>

<deferred>
## Deferred Ideas

- `infra:test-all` / "Chaos Monkey" command that auto-discovers and runs all scenarios in `demo/` — future automation phase
- LLM-Integration-Mode flag for full-stack E2E tests against real LLM — future test infrastructure
- `docker system prune` as alternative cleanup strategy (broader than targeted truncation) — different scenario
- Image bloat scenario (dangling images filling disk) — separate scenario, different diagnostic ladder
- ROADMAP.md path correction: `demo/reset-docker-storage.sh` → `demo/docker-storage/reset-docker-storage.sh`

</deferred>

---

*Phase: 10-docker-storage-failure-scenario*
*Context gathered: 2026-03-13*
