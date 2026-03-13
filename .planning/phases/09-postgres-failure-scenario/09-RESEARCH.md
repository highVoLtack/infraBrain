# Phase 9: Postgres Failure Scenario - Research

**Researched:** 2026-03-13
**Domain:** Docker Compose Postgres scenario, diagnostic skill authoring, E2E testing
**Confidence:** HIGH

## Summary

Phase 9 builds a complete vertical slice proving InfraBrain's autonomous Postgres connection-limit diagnosis and recovery through the DPEV loop. The implementation consists of four deliverables: (1) a Docker Compose environment with a Python connection-leaking app that saturates Postgres, (2) a `postgres-troubleshoot.md` diagnostic skill following the established 5-step Diagnostic Ladder pattern, (3) an idempotent reset script, and (4) an E2E test proving the full loop with mocked LLM responses.

The codebase already has a near-identical scenario (Nginx 502) that serves as a direct template. The Nginx scenario established all patterns: demo directory structure, reset script idiom, skill file format, discovery command registry, and E2E test scaffolding (vitest + supertest + mocked LLM). Phase 9 reuses these patterns wholesale, adapting them for Postgres-specific diagnostics.

The critical proof point is the PID handoff between fix plan steps via Phase 8's RollingContext -- Step 1 queries PIDs, Step 2 terminates using those exact PIDs, Step 3 verifies recovery. This proves rolling context actually works across multi-step execution.

**Primary recommendation:** Follow the Nginx scenario as a 1:1 template. The only novel work is the Postgres-specific Docker environment, the diagnostic skill content, and restructuring `demo/` into per-scenario subdirectories.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Python leaky-app container (psycopg2) opens 18 connections to Postgres and holds them forever
- Postgres configured with `max_connections=20` -- leaves 2 free slots for superuser diagnostic access
- Leaky-app uses retry-loop with 2s backoff for Postgres readiness (no depends_on healthcheck)
- Leaky-app prints clear intent messages (`"Holding 18 connections open..."`) for demo legibility
- Postgres image: `postgres:16`, host port `5433` (non-default to avoid collisions with local Postgres)
- Leaky-app Dockerfile: `python:3-slim` + `pip install psycopg2-binary`, ~10 lines of Python
- 5-step Diagnostic Ladder: Discovery -> Saturation Check -> Activity Analysis -> Topology Correlation -> Remediation
- Step 0 (Container Discovery): `docker ps`, `docker network inspect` -- extract container names and IP-to-container mapping
- Step 1 (Connection Saturation Check): `SELECT count(*) FROM pg_stat_activity` + `SHOW max_connections`
- Step 2 (Idle Connection Analysis): `SELECT pid, state, client_addr, query, state_change FROM pg_stat_activity WHERE state = 'idle'`
- Step 3 (Cross-Domain Correlation): Map `client_addr` from pg_stat_activity to container names via pre-injected Docker topology
- Step 4 (Fix Proposal): Generate multi-step fix plan with surgical PID-based termination
- All discovery data pre-injected via discovery commands -- LLM does pure reasoning
- Skill uses `preferred_model: forensic` (DeepSeek-R1)
- Tool allowlist: `docker`, `psql`
- 3-step fix plan: Identify PIDs -> Terminate Connections -> Verify Recovery
- Step 1 (read): `SELECT pid FROM pg_stat_activity WHERE state='idle' AND client_addr='<leaky-app-ip>'`
- Step 2 (write, Y/n approval): `pg_terminate_backend(pid)` for each PID
- Step 3 (read): `SELECT count(*) FROM pg_stat_activity` -- confirms recovery
- Risk classification: pg_terminate_backend = `write` (Y/n prompt), not `destructive`
- Subdirectories per scenario: `demo/nginx/`, `demo/postgres/`, future `demo/docker-storage/`
- Phase 9 moves existing nginx demo files into `demo/nginx/` (update poc-nginx-502.test.ts paths)
- Phase 9 creates `demo/postgres/` with: docker-compose.yml, leaky-app/ (Dockerfile + leak.py), reset-postgres.sh
- `reset-postgres.sh` is idempotent: tears down, recreates, verifies broken state (polls until "too many connections" confirmed, exits non-zero if broken state not reached within 60s)
- Mock LLM responses in E2E test (same pattern as poc-nginx-502.test.ts)
- Test validates full DPEV loop: broken state -> diagnosis -> multi-step fix plan -> execution -> recovery verification -> audit trail completeness

### Claude's Discretion
- Exact leaky-app Python implementation details (connection timing, error handling)
- Docker network naming and configuration
- E2E test timeout values and polling intervals
- Exact psql connection strings and authentication in discovery commands
- TOON encoding thresholds for diagnostic evidence compression
- init.sql usage (if needed for database setup)

### Deferred Ideas (OUT OF SCOPE)
- `infra:test-all` command that auto-discovers and runs all scenarios in `demo/` -- future automation phase
- LLM-Integration-Mode flag for full-stack E2E tests against real LLM -- future test infrastructure
- Connection pool reconfiguration as alternative fix strategy (vs surgical termination) -- more complex, different scenario
- `docker restart leaky-app` as additional fix step to prevent re-leak -- scope creep
- `/infra:report <session-id>` post-mortem report generation -- already deferred from Phase 5
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SCEN-01 | Docker Compose environment starts with Postgres hitting max_connections from connection-leaking app | Docker Compose config with postgres:16 + leaky-app Python container; `superuser_reserved_connections` must be set to 2 for correct slot math |
| SCEN-02 | `postgres-troubleshoot.md` skill diagnoses pg_stat_activity, identifies idle/leaked connections, generates fix plan | 5-step Diagnostic Ladder skill file following nginx-troubleshoot.md template; discovery commands registered in debug.ts |
| SCEN-03 | Postgres scenario has reset script reproducing broken state idempotently | `reset-postgres.sh` following `demo/reset.sh` pattern with polling loop for "too many connections" confirmation |
| E2E-01 | Postgres scenario has automated E2E test proving full DPEV loop | `poc-postgres-connleak.test.ts` following `poc-nginx-502.test.ts` pattern with mocked LLM, canned fix plan, audit trail assertions |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| postgres | 16 (Docker image) | Database under test | Locked decision; PG16 has `reserved_connections` feature |
| psycopg2-binary | latest (pip) | Python connection leak driver | Locked decision; simplest PG driver for Python, no build deps |
| python:3-slim | latest (Docker image) | Leaky-app base image | Locked decision; minimal footprint |
| vitest | existing (project) | E2E test framework | Established in project |
| supertest | existing (project) | HTTP testing | Established pattern from poc-nginx-502.test.ts |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Docker Compose | v2 (CLI) | Orchestrate postgres + leaky-app | Demo environment setup |
| psql | bundled in postgres:16 | Diagnostic queries from host | Discovery commands via `docker exec` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| psycopg2-binary | asyncpg | More complex, unnecessary for simple leak demo |
| python:3-slim | node.js pg client | Python is locked decision, simpler leak code |

## Architecture Patterns

### Recommended Project Structure
```
demo/
├── nginx/                  # Moved from demo/ root (Phase 9 restructure)
│   ├── docker-compose.yml
│   ├── nginx.conf
│   └── reset.sh           # Renamed from reset.sh
├── postgres/               # NEW (Phase 9)
│   ├── docker-compose.yml
│   ├── leaky-app/
│   │   ├── Dockerfile
│   │   └── leak.py
│   └── reset-postgres.sh
└── start-api.ts            # Stays at demo/ root

skills/
├── nginx-troubleshoot.md
├── postgres-troubleshoot.md  # NEW (Phase 9)
├── planning.md
├── verification.md
└── log-analysis.md

tests/e2e/
├── poc-nginx-502.test.ts     # Updated paths: demo/nginx/
└── poc-postgres-connleak.test.ts  # NEW (Phase 9)
```

### Pattern 1: Diagnostic Skill File (Database Archetype)
**What:** Markdown skill file with frontmatter + system prompt + diagnostic ladder + examples
**When to use:** Every new infrastructure scenario
**Example:**
```markdown
---
name: postgres-troubleshoot
description: "Diagnoses PostgreSQL connection saturation..."
triggers:
  - postgres
  - connection
  - max_connections
  - pg_stat_activity
tools:
  - docker
  - psql
preferred_model: forensic
priority: 10
---

## System Prompt

You are a PostgreSQL infrastructure diagnostic specialist...

### Diagnostic Ladder

**Step 0: Container Discovery (MANDATORY)**
Run: `docker ps --format "{{.Names}}"` and `docker network inspect <network>`
...

**Step 1: Connection Saturation Check**
Run: `SELECT count(*) FROM pg_stat_activity` + `SHOW max_connections`
...
```

### Pattern 2: Discovery Commands Registry
**What:** Pre-LLM ground truth injection preventing hallucination
**When to use:** Every skill that interacts with live infrastructure
**Example:**
```typescript
// In src/api/routes/debug.ts, add to DISCOVERY_COMMANDS:
'postgres-troubleshoot': [
  { command: 'docker ps --format "{{.Names}}"', label: 'Running containers' },
  { command: 'docker network inspect postgres_default', label: 'Network topology' },
  {
    command: 'docker exec postgres-demo psql -U postgres -t -c "SELECT count(*) FROM pg_stat_activity"',
    label: 'Active connections',
  },
  {
    command: 'docker exec postgres-demo psql -U postgres -t -c "SHOW max_connections"',
    label: 'Max connections',
  },
  {
    command: 'docker exec postgres-demo psql -U postgres -t -c "SELECT pid, state, client_addr, query, state_change FROM pg_stat_activity WHERE state = \'idle\' ORDER BY state_change"',
    label: 'Idle connections detail',
  },
],
```

### Pattern 3: Canned Fix Plan for E2E Testing
**What:** Pre-defined fix plan with deterministic PIDs for mocked E2E tests
**When to use:** E2E tests that need deterministic multi-step execution
**Example:**
```typescript
const cannedFixPlan: FixPlan = {
  summary: 'Terminate leaked idle connections from leaky-app',
  complexity: 'moderate',
  steps: [
    {
      command: 'docker exec postgres-demo psql -U postgres -t -c "SELECT pid FROM pg_stat_activity WHERE state=\'idle\' AND client_addr=\'172.20.0.3\'"',
      description: 'Identify leaked connection PIDs from leaky-app',
      risk: 'read',
      rollback: 'N/A',
    },
    {
      command: 'docker exec postgres-demo psql -U postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE state=\'idle\' AND client_addr=\'172.20.0.3\'"',
      description: 'Terminate all idle connections from leaky-app IP',
      risk: 'write',
      rollback: 'N/A',
    },
    {
      command: 'docker exec postgres-demo psql -U postgres -t -c "SELECT count(*) FROM pg_stat_activity"',
      description: 'Verify connection count recovered',
      risk: 'read',
      rollback: 'N/A',
    },
  ],
};
```

### Anti-Patterns to Avoid
- **Hardcoding PIDs in the skill:** The diagnostic ladder must discover PIDs dynamically. Only the E2E test canned plan has hardcoded PIDs.
- **Using `pg_cancel_backend` instead of `pg_terminate_backend`:** Cancel only aborts the current query; terminate closes the entire connection. Leaked idle connections need termination.
- **Connecting as non-superuser for diagnostics:** `pg_terminate_backend` requires superuser privileges. Discovery commands must use `-U postgres`.
- **Depending on container IP addresses in the skill:** IPs are dynamic. The skill's Step 3 (Topology Correlation) must discover the mapping at runtime via `docker network inspect`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Connection leak simulation | Complex app with connection pool bugs | Simple Python script holding connections open | 10 lines of Python vs. simulating realistic app behavior |
| PG connection monitoring | Custom monitoring script | `pg_stat_activity` system view | PostgreSQL built-in, authoritative, complete |
| Connection termination | `kill` or restart container | `pg_terminate_backend(pid)` | Surgical, per-connection, graceful, auditable |
| Docker topology discovery | Parsing `docker inspect` JSON manually | `docker network inspect --format` | Built-in Go templating, stable output |
| E2E test LLM behavior | Real LLM calls | Mocked provider (vi.fn()) | Deterministic, fast, no GPU needed |

**Key insight:** PostgreSQL provides all the diagnostic and remediation tools natively via system views and built-in functions. The skill's value is in cross-domain correlation (DB state mapped to container topology), not in custom tooling.

## Common Pitfalls

### Pitfall 1: superuser_reserved_connections Math
**What goes wrong:** PostgreSQL 16 defaults `superuser_reserved_connections` to 3. With `max_connections=20`, regular users can only open 17 connections (20 - 3). If the leaky-app tries to open 18 as a regular user, the 18th connection fails immediately.
**Why it happens:** The reserved slots are invisible to non-superuser clients.
**How to avoid:** In `docker-compose.yml`, set `command: postgres -c max_connections=20 -c superuser_reserved_connections=2`. This gives 18 regular slots + 2 superuser slots = 20 total. The leaky-app fills all 18 regular slots, and diagnostic `psql -U postgres` (superuser) uses the 2 reserved slots.
**Warning signs:** Leaky-app throws connection errors before reaching 18 connections.

### Pitfall 2: Docker Network IP Instability
**What goes wrong:** Container IPs change between `docker compose down/up` cycles. Hardcoding `client_addr` in the skill or discovery commands breaks on reset.
**Why it happens:** Docker assigns IPs from the subnet pool; order depends on startup sequence.
**How to avoid:** Discovery commands must extract the leaky-app IP dynamically. The E2E test canned plan can use a fixed IP since the test controls the environment, but the skill itself must correlate dynamically.
**Warning signs:** `pg_stat_activity` shows connections from unexpected IPs.

### Pitfall 3: Race Condition in Reset Script
**What goes wrong:** `reset-postgres.sh` starts the environment but checks broken state before Postgres is ready or before the leaky-app has opened all connections.
**Why it happens:** Docker Compose `up -d` returns immediately; Postgres needs ~2s to initialize; leaky-app needs another 2-4s with backoff to establish all 18 connections.
**How to avoid:** Poll loop with timeout: `for i in {1..30}; do docker exec postgres-demo psql -U leaky -c "SELECT 1" 2>&1 | grep -q "too many" && break; sleep 2; done`. Exit non-zero if broken state not confirmed within 60s.
**Warning signs:** E2E test fails intermittently in `beforeAll` because broken state is not yet established.

### Pitfall 4: Port Collision with Host Postgres
**What goes wrong:** Demo Postgres on port 5432 conflicts with developer's local Postgres installation.
**Why it happens:** PostgreSQL default port is 5432; many developers run Postgres locally.
**How to avoid:** Map to host port `5433` (locked decision). All `psql` commands from host must use `-p 5433` or go through `docker exec`.
**Warning signs:** "port already in use" on `docker compose up`.

### Pitfall 5: psql Commands via docker exec vs Host
**What goes wrong:** Running `psql` from the host requires the Postgres client installed and correct port mapping. Running via `docker exec` is universal.
**Why it happens:** Not all developers have `psql` installed locally.
**How to avoid:** All discovery commands and fix plan steps use `docker exec postgres-demo psql -U postgres ...` format. Never assume `psql` is available on the host.
**Warning signs:** "psql: command not found" in test runs.

### Pitfall 6: Nginx E2E Test Path Breakage
**What goes wrong:** Moving `demo/docker-compose.yml` to `demo/nginx/docker-compose.yml` breaks `poc-nginx-502.test.ts` which references `demo/docker-compose.yml` and `demo/reset.sh`.
**Why it happens:** Path references are hardcoded in the test file (lines 84, 182).
**How to avoid:** Update all path references in `poc-nginx-502.test.ts` when restructuring. Also update `afterAll` cleanup to use `demo/nginx/docker-compose.yml`.
**Warning signs:** Nginx E2E test fails after demo directory restructure.

## Code Examples

### Leaky-App Python Script (leak.py)
```python
# Source: Claude's discretion -- minimal connection leak simulator
import psycopg2
import time
import sys

DSN = "host=postgres dbname=postgres user=leaky password=leaky"
TARGET = 18
connections = []

print(f"Leaky-app starting: will open {TARGET} connections and hold them forever...")

for i in range(TARGET):
    while True:
        try:
            conn = psycopg2.connect(DSN)
            conn.autocommit = True
            connections.append(conn)
            print(f"Connection {i+1}/{TARGET} established")
            break
        except psycopg2.OperationalError as e:
            print(f"Connection {i+1} failed, retrying in 2s: {e}", file=sys.stderr)
            time.sleep(2)

print(f"Holding {TARGET} connections open. Postgres should be at max capacity.")

# Hold forever
while True:
    time.sleep(60)
```

### Docker Compose for Postgres Scenario
```yaml
# Source: Adapted from demo/docker-compose.yml pattern
services:
  postgres:
    image: postgres:16
    container_name: postgres-demo
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: postgres
    command: >
      postgres
        -c max_connections=20
        -c superuser_reserved_connections=2
    ports:
      - "5433:5432"
    networks:
      - pgnet

  leaky-app:
    build: ./leaky-app
    container_name: leaky-app
    environment:
      PGHOST: postgres
      PGDATABASE: postgres
      PGUSER: leaky
      PGPASSWORD: leaky
    depends_on:
      - postgres
    networks:
      - pgnet

networks:
  pgnet:
    driver: bridge
```

### Leaky User Creation (init.sql or postgres command)
```sql
-- Create the non-superuser that the leaky-app connects as
CREATE USER leaky WITH PASSWORD 'leaky';
GRANT CONNECT ON DATABASE postgres TO leaky;
```
Note: This can be done via an `init.sql` mounted into `/docker-entrypoint-initdb.d/` or via `POSTGRES_USER` being the leaky user itself. Using a separate user is important because the leaky-app must NOT be superuser (superuser slots must remain for diagnostics).

### Reset Script Pattern (reset-postgres.sh)
```bash
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.yml"

echo "==> Tearing down existing Postgres demo environment..."
docker compose -f "$COMPOSE_FILE" down --remove-orphans 2>/dev/null || true

echo "==> Starting broken Postgres environment..."
docker compose -f "$COMPOSE_FILE" up -d --build

echo "==> Waiting for leaky-app to saturate connections (max 60s)..."
for i in $(seq 1 30); do
  # Try connecting as the leaky user -- should fail when saturated
  if docker exec postgres-demo psql -U leaky -d postgres -c "SELECT 1" 2>&1 | grep -q "too many"; then
    echo "SUCCESS: Postgres connection limit reached (confirmed 'too many connections')"
    exit 0
  fi
  sleep 2
done

echo "ERROR: Broken state not reached within 60 seconds"
exit 1
```

### Discovery Commands for postgres-troubleshoot
```typescript
// Add to DISCOVERY_COMMANDS in src/api/routes/debug.ts
'postgres-troubleshoot': [
  { command: 'docker ps --format "{{.Names}}"', label: 'Running containers' },
  {
    command: 'docker network inspect $(docker network ls --filter name=postgres -q) --format "{{range .Containers}}{{.Name}}:{{.IPv4Address}} {{end}}"',
    label: 'Container IP mapping',
  },
  {
    command: 'docker exec postgres-demo psql -U postgres -t -c "SELECT count(*) AS active FROM pg_stat_activity"',
    label: 'Active connection count',
  },
  {
    command: 'docker exec postgres-demo psql -U postgres -t -c "SHOW max_connections"',
    label: 'Max connections setting',
  },
  {
    command: 'docker exec postgres-demo psql -U postgres -t -A -c "SELECT pid, state, client_addr, usename, query, state_change FROM pg_stat_activity WHERE state = \'idle\' ORDER BY state_change"',
    label: 'Idle connections detail',
  },
],
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `pg_cancel_backend()` | `pg_terminate_backend()` | Always available | Cancel only stops query; terminate closes connection. Use terminate for leaked idle connections. |
| `superuser_reserved_connections=3` (PG16 default) | Override to `2` for demo | PG16 introduced `reserved_connections` alongside | Must explicitly set to match the "2 slots for diagnostics" design |
| `SHOW max_connections` only | `pg_stat_activity` count + `max_connections` | Always available | Saturation ratio (count/max) is the diagnostic signal |

**Deprecated/outdated:**
- None relevant -- pg_stat_activity and pg_terminate_backend are stable PostgreSQL features dating back to PG9+.

## Open Questions

1. **init.sql vs POSTGRES_INITDB_ARGS for leaky user creation**
   - What we know: PostgreSQL Docker image runs `/docker-entrypoint-initdb.d/*.sql` on first start
   - What's unclear: Whether to use init.sql or create the user via POSTGRES_USER env (making leaky the default user and creating a separate superuser)
   - Recommendation: Use init.sql in `leaky-app/` directory mounted into postgres container. Simpler and more explicit. Claude's discretion area.

2. **Discovery command for network topology: shell expansion in DISCOVERY_COMMANDS**
   - What we know: The `runDiscovery` function uses `parseCommand()` which may not handle `$()` subshell expansion
   - What's unclear: Whether `docker network inspect $(docker network ls ...)` works through the runner
   - Recommendation: Use hardcoded network name (e.g., `postgres_pgnet`) since the compose file defines it. Or use two separate discovery commands. Verify during implementation.

3. **E2E test: how to get deterministic container IPs for canned fix plan**
   - What we know: Docker assigns IPs from the subnet. In a freshly created network, the first container usually gets .2, second .3.
   - What's unclear: Whether this is reliable enough for canned plans
   - Recommendation: The canned fix plan should use `client_addr` filtering (e.g., match by username `leaky` instead of IP) OR the test should query the actual IP dynamically in beforeAll and inject it into the canned plan. Dynamic approach is more robust.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest (existing) |
| Config file | vitest.config.ts |
| Quick run command | `npx vitest run tests/e2e/poc-postgres-connleak.test.ts` |
| Full suite command | `npx vitest run` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SCEN-01 | Docker Compose starts with connection-saturated Postgres | e2e (beforeAll) | `npx vitest run tests/e2e/poc-postgres-connleak.test.ts -t "broken environment"` | No -- Wave 0 |
| SCEN-02 | postgres-troubleshoot.md skill diagnoses and generates fix plan | e2e | `npx vitest run tests/e2e/poc-postgres-connleak.test.ts -t "diagnoses"` | No -- Wave 0 |
| SCEN-03 | reset-postgres.sh reproduces broken state idempotently | e2e (beforeAll calls reset) | `bash demo/postgres/reset-postgres.sh` | No -- Wave 0 |
| E2E-01 | Full DPEV loop: diagnose -> plan -> execute -> verify recovery | e2e | `npx vitest run tests/e2e/poc-postgres-connleak.test.ts` | No -- Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run tests/e2e/poc-postgres-connleak.test.ts`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `demo/postgres/docker-compose.yml` -- Postgres + leaky-app compose environment
- [ ] `demo/postgres/leaky-app/Dockerfile` + `leak.py` -- connection leak simulator
- [ ] `demo/postgres/reset-postgres.sh` -- idempotent broken state setup
- [ ] `skills/postgres-troubleshoot.md` -- diagnostic skill file
- [ ] `src/api/routes/debug.ts` -- add postgres-troubleshoot discovery commands
- [ ] `tests/e2e/poc-postgres-connleak.test.ts` -- E2E test file
- [ ] `demo/nginx/` -- restructured nginx demo files (move from demo/ root)
- [ ] `tests/e2e/poc-nginx-502.test.ts` -- updated paths after nginx demo move

## Sources

### Primary (HIGH confidence)
- `skills/nginx-troubleshoot.md` -- template for postgres-troubleshoot.md skill file format
- `tests/e2e/poc-nginx-502.test.ts` -- template for E2E test pattern (vitest + supertest + mocked LLM)
- `src/api/routes/debug.ts` lines 84-89 -- DISCOVERY_COMMANDS registry pattern
- `src/execution/executor.ts` -- rolling context injection via onBeforeStep (lines 104-108)
- `src/execution/context-builder.ts` -- RollingContext class that compresses older step results
- `demo/docker-compose.yml` + `demo/reset.sh` -- template for demo environment structure

### Secondary (MEDIUM confidence)
- [PostgreSQL 16 Docs: Connections and Authentication](https://www.postgresql.org/docs/16/runtime-config-connection.html) -- `superuser_reserved_connections` defaults to 3, must override to 2
- [PostgreSQL Docs: pg_stat_activity](https://www.postgresql.org/docs/current/monitoring-stats.html) -- system view columns confirmed
- [CYBERTEC: Terminating database connections](https://www.cybertec-postgresql.com/en/terminating-database-connections-in-postgresql/) -- pg_terminate_backend usage patterns
- [CYBERTEC: reserve_connections in PG16](https://www.cybertec-postgresql.com/en/reserve-connections-in-postgresql-16/) -- PG16 reserved_connections feature details

### Tertiary (LOW confidence)
- None -- all findings verified with official docs or codebase inspection.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- locked decisions from CONTEXT.md, verified PostgreSQL 16 behavior
- Architecture: HIGH -- direct 1:1 template from existing Nginx scenario in codebase
- Pitfalls: HIGH -- superuser_reserved_connections math verified with official PG16 docs; other pitfalls from codebase analysis

**Research date:** 2026-03-13
**Valid until:** 2026-04-13 (stable domain -- PostgreSQL system views and Docker Compose are mature)
