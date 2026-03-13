# Phase 10: Docker Storage Failure Scenario - Research

**Researched:** 2026-03-13
**Domain:** Docker storage diagnostics, tmpfs volumes, DPEV loop scenario
**Confidence:** HIGH

## Summary

Phase 10 implements the second scenario in the Chaos Library: a Docker volume-full failure where a logger container fills a shared tmpfs volume, crashing a Redis container. The implementation follows the exact same patterns established in Phase 9 (Postgres connection leak scenario) -- Scenario-per-Directory layout, Diagnostic Ladder skill, idempotent reset script, and mocked E2E test.

The key technical discovery is that **Docker tmpfs mounts cannot be shared between containers** as per-service tmpfs declarations. The solution is a **named volume** with `driver: local` and `driver_opts: type: tmpfs, o: size=10m, device: tmpfs`. This creates a tmpfs-backed named volume that both containers can mount, with an enforced size cap.

**Primary recommendation:** Follow the Phase 9 template exactly. The only novel element is the tmpfs-backed named volume configuration and the Causal Deduplication reasoning in the skill. All infrastructure (executor, rolling context, audit, E2E test scaffolding) is already proven.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Mixed bloat scenario: Container A ("logger") spams log files, Container B ("redis") crashes when RDB save fails on full disk
- tmpfs chosen for atomicity, speed, environment-agnostic behavior
- 5-step Diagnostic Ladder following Archetype Protocol with storage-tailored rung names
- 5 discovery commands pre-inject all evidence; LLM does pure reasoning
- Skill uses `preferred_model: default` (Qwen)
- Tool allowlist: `docker`, `redis-cli`, `df`, `du`, `truncate`
- 4-step fix plan proving rolling context: identify bloat -> truncate logs -> restart redis -> dual verify
- `truncate -s 0` chosen over `rm` to preserve inode
- Dual verification: `df -h` shows free space AND `redis-cli PING` returns PONG
- Scenario-per-Directory pattern: `demo/docker-storage/`
- Reset script: idempotent, 60s timeout, dual broken-state verification (tmpfs 100% full + redis-cli PING fails)
- E2E test: mocked LLM responses, validates full DPEV loop, 60s timeout for Docker operations
- Logger fills tmpfs via `dd if=/dev/zero of=/shared/bloat.log bs=1M count=9` in entrypoint (instant, deterministic)
- Host port for Redis: non-default to avoid collisions

### Claude's Discretion
- Exact logger container implementation (base image, entrypoint script details)
- Docker network naming and configuration
- Redis configuration (RDB save frequency, persistence settings to ensure crash on disk-full)
- Exact discovery command formatting and TOON encoding
- E2E test mock response content and assertion details
- tmpfs size (10MB suggested, Claude may adjust for optimal demo behavior)

### Deferred Ideas (OUT OF SCOPE)
- `infra:test-all` / "Chaos Monkey" auto-discovery -- future automation phase
- LLM-Integration-Mode flag for full-stack E2E tests -- future test infrastructure
- `docker system prune` as alternative cleanup -- different scenario
- Image bloat scenario (dangling images) -- separate scenario
- ROADMAP.md path correction -- separate docs update
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SCEN-04 | Docker Compose environment starts with a container whose volume is 100% full, causing crashes | Named tmpfs volume with size cap; logger fills via `dd`; Redis crashes on RDB save failure |
| SCEN-05 | `docker-storage.md` skill diagnoses via `df -h` / `docker system df`, generates fix plan to prune or truncate | 5-step Diagnostic Ladder skill following postgres-troubleshoot.md template; 5 discovery commands in debug.ts |
| SCEN-06 | Docker volume scenario has reset script that reproduces broken state idempotently | reset-docker-storage.sh following reset-postgres.sh template; dual verification loop |
| E2E-02 | Docker volume scenario has automated E2E test proving full DPEV loop | poc-docker-storage.test.ts following poc-postgres-connleak.test.ts template with mocked LLM |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Docker Compose | v2+ | Container orchestration for demo scenario | Already used in Phase 9 postgres scenario |
| Redis | 7-alpine | Victim container (crashes on disk-full RDB save) | Lightweight, well-known, fast crash behavior |
| Alpine Linux | 3.x | Logger container base image | Minimal footprint, has `dd` built-in |
| vitest | existing | E2E test framework | Already used in poc-nginx-502 and poc-postgres tests |
| supertest | existing | HTTP assertions for E2E tests | Already used in existing E2E tests |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @toon-format/toon | existing | TOON encoding for discovery output | Discovery commands TOON-encode results before LLM injection |

### Alternatives Considered
None -- all locked by CONTEXT.md decisions and established Phase 9 patterns.

## Architecture Patterns

### Recommended Project Structure
```
demo/docker-storage/
  docker-compose.yml         # Logger + Redis + shared tmpfs volume
  logger/
    Dockerfile               # Alpine + entrypoint.sh
    entrypoint.sh            # dd bloat + slow continuous writes
  reset-docker-storage.sh    # Idempotent reset script

skills/
  docker-storage.md          # 5-step Diagnostic Ladder skill

src/api/routes/debug.ts      # Add DISCOVERY_COMMANDS['docker-storage'] entry

tests/e2e/
  poc-docker-storage.test.ts # Full DPEV loop E2E test
```

### Pattern 1: Shared tmpfs-backed Named Volume (CRITICAL)
**What:** Docker per-service `tmpfs:` declarations CANNOT be shared between containers. Use a named volume with tmpfs driver instead.
**When to use:** Any time two containers must share a size-limited in-memory filesystem.
**Confidence:** HIGH (verified via Docker Compose GitHub issues #5907 and #5682)
**Example:**
```yaml
# docker-compose.yml
volumes:
  shared-tmpfs:
    driver: local
    driver_opts:
      type: tmpfs
      o: "size=10m"
      device: tmpfs

services:
  logger:
    build: ./logger
    container_name: storage-logger
    volumes:
      - shared-tmpfs:/shared

  redis:
    image: redis:7-alpine
    container_name: storage-redis
    command: redis-server --save 1 1 --dir /shared --dbfilename dump.rdb
    ports:
      - "6380:6379"
    volumes:
      - shared-tmpfs:/shared
```

Key points:
- `driver: local` with `driver_opts: type: tmpfs` creates a kernel tmpfs mount
- `o: "size=10m"` enforces the 10MB cap at the kernel level
- Both containers mount it at `/shared` -- same filesystem, same inode space
- Redis `--save 1 1` triggers an RDB save every 1 second if at least 1 key changed -- this ensures Redis attempts writes frequently and crashes quickly when disk is full
- Redis `--dir /shared` puts the RDB file on the shared tmpfs
- Port 6380 on host avoids collision with any local Redis on default 6379

### Pattern 2: Deterministic Bloat Generation
**What:** Logger fills tmpfs instantly using `dd`, then optionally continues slow writes.
**Example:**
```dockerfile
# logger/Dockerfile
FROM alpine:3
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
```
```bash
#!/bin/sh
# entrypoint.sh -- fill shared tmpfs to trigger Redis crash
dd if=/dev/zero of=/shared/bloat.log bs=1M count=9 2>/dev/null
# Keep container alive for diagnostic commands
while true; do sleep 60; done
```
- `dd` writes 9MB of zeros instantly -- leaves ~1MB which Redis RDB will fight over
- Container stays alive so `docker exec` works for diagnostics
- No dependencies, no language runtime, just Alpine + shell

### Pattern 3: Diagnostic Ladder Skill (Archetype Protocol)
**What:** 5-step diagnostic following the same DPEV structure as postgres-troubleshoot.md but with storage-specific rung names.
**Template:** Direct port of `skills/postgres-troubleshoot.md` structure with these rungs:
- Step 0: Container Discovery (`docker ps`, `docker network inspect`)
- Step 1: Capacity Check (`df -h` inside containers, `docker system df`)
- Step 2: Ownership Analysis (`du -sh` per directory on shared volume)
- Step 3: Causal Deduplication (LLM classifies: log bloat = safe, Redis data = critical)
- Step 4: Risk-Tiered Remediation (4-step fix plan with truncate + restart)

### Pattern 4: Discovery Commands Registration
**What:** Add `docker-storage` entry to `DISCOVERY_COMMANDS` in `src/api/routes/debug.ts`.
**Example (5 commands per CONTEXT.md):**
```typescript
'docker-storage': [
  { command: 'docker ps --format "{{.Names}}"', label: 'Running containers' },
  {
    command: 'docker network inspect docker-storage_default --format "{{range .Containers}}{{.Name}}:{{.IPv4Address}} {{end}}"',
    label: 'Container IP mapping',
  },
  {
    command: 'docker exec storage-logger df -h /shared',
    label: 'Shared volume capacity (logger view)',
  },
  {
    command: 'docker exec storage-logger du -sh /shared/*',
    label: 'Shared volume ownership breakdown',
  },
  {
    command: 'docker system df',
    label: 'Docker system storage overview',
  },
],
```
Note: The network name follows Docker Compose convention: `<project-dir>_default` which will be `docker-storage_default`. Verify at implementation time.

### Pattern 5: E2E Test Structure (Mocked LLM)
**What:** Follows the exact same test scaffold as `poc-postgres-connleak.test.ts`.
**Structure:**
1. `beforeAll`: Run reset script, verify broken state (tmpfs full + redis-cli PING fails), set up mocks
2. Test 1: "broken environment shows full volume and crashed redis"
3. Test 2: "diagnoses storage bloat and generates fix plan" (POST /debug)
4. Test 3: "executes fix plan and verifies recovery" (POST /execute)
5. Test 4: "audit trail contains full DPEV evidence"
6. `afterAll`: Tear down Docker environment, clean temp dir

### Anti-Patterns to Avoid
- **Per-service tmpfs instead of named volume:** Will NOT create shared storage -- each container gets its own isolated tmpfs
- **Using `rm` instead of `truncate -s 0`:** Removes the inode; if logger still has an open file handle, it creates a ghost file consuming space that can never be reclaimed without restart
- **Skipping Redis restart after truncation:** Freeing disk space does not restart a crashed Redis -- the fix is incomplete without `docker restart`
- **Single verification (only df -h):** "False Green" -- volume may show free space but Redis is still down. Must verify BOTH disk recovery AND application health

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Shared tmpfs volume | Per-service tmpfs declarations | Named volume with `driver: local, type: tmpfs` | Per-service tmpfs is NOT shared between containers |
| Bloat generation | Complex app writing files gradually | `dd if=/dev/zero bs=1M count=9` | Instant, deterministic, no dependencies |
| Redis crash trigger | Custom crash logic | `redis-server --save 1 1 --dir /shared` | Redis naturally crashes on BGSAVE failure to full disk |
| E2E test scaffold | New test framework | Copy poc-postgres-connleak.test.ts | Identical pattern: mock LLM, real Docker, sequential DPEV tests |
| TOON encoding | Custom serialization | `@toon-format/toon` (already in deps) | Established pattern in discovery command output |

## Common Pitfalls

### Pitfall 1: tmpfs Sharing Confusion
**What goes wrong:** Using per-service `tmpfs:` key instead of named volumes. Each container gets its own isolated tmpfs.
**Why it happens:** Docker docs describe `tmpfs` as a service-level key. Easy to assume shared.
**How to avoid:** Always use named volume with `driver: local, driver_opts: type: tmpfs`.
**Warning signs:** `df -h` shows different usage in logger vs redis container.

### Pitfall 2: Redis Not Crashing Fast Enough
**What goes wrong:** Reset script timeout expires before Redis crashes.
**Why it happens:** Default Redis `save` interval is `save 3600 1 300 100 60 10000` -- very infrequent saves.
**How to avoid:** Configure `--save 1 1` to trigger RDB save every second with any change. Redis will attempt BGSAVE, fail on full disk, and enter error state.
**Warning signs:** `redis-cli PING` still returns PONG after logger fills tmpfs.

### Pitfall 3: Docker Compose Network Name
**What goes wrong:** Discovery commands reference wrong network name.
**Why it happens:** Docker Compose generates network names from project directory name.
**How to avoid:** Name depends on the directory containing docker-compose.yml. If in `demo/docker-storage/`, default network is `docker-storage_default`. Can also define explicit network name in compose file.
**Warning signs:** `docker network inspect` returns error.

### Pitfall 4: Reset Script Race Condition
**What goes wrong:** Script checks broken state before logger finishes `dd` or before Redis attempts save.
**Why it happens:** `docker compose up -d` returns before entrypoints complete.
**How to avoid:** Poll loop with both conditions: `df` shows 100% AND `redis-cli PING` fails. 60s timeout.
**Warning signs:** Flaky test -- passes sometimes, fails on slower machines.

### Pitfall 5: Container Name Collisions
**What goes wrong:** E2E test fails because container names conflict with another running scenario.
**Why it happens:** Both postgres and docker-storage scenarios might run simultaneously.
**How to avoid:** Use unique container names (`storage-logger`, `storage-redis`) and non-default port (6380).
**Warning signs:** `docker compose up` fails with "name already in use".

## Code Examples

### Reset Script Template
```bash
#!/usr/bin/env bash
# Source: Phase 9 demo/postgres/reset-postgres.sh (adapted)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.yml"

echo "==> Tearing down existing Docker storage demo environment..."
docker compose -f "$COMPOSE_FILE" down --remove-orphans --volumes 2>/dev/null || true

echo "==> Starting logger + redis environment..."
docker compose -f "$COMPOSE_FILE" up -d --build

echo "==> Waiting for broken state (max 60s)..."
for i in $(seq 1 30); do
  # Check both conditions: tmpfs full AND redis unreachable
  USAGE=$(docker exec storage-logger df /shared --output=pcent 2>/dev/null | tail -1 | tr -d ' %' || echo "0")
  PING=$(docker exec storage-redis redis-cli PING 2>&1 || echo "FAIL")

  if [ "$USAGE" -ge 95 ] && [ "$PING" != "PONG" ]; then
    echo "SUCCESS: Storage full ($USAGE%) and Redis down"
    exit 0
  fi
  sleep 2
done

echo "ERROR: Broken state not reached within 60 seconds"
exit 1
```

### Skill Frontmatter Template
```yaml
# Source: skills/postgres-troubleshoot.md (adapted)
---
name: docker-storage
description: "Diagnoses Docker volume saturation and performs causal deduplication to distinguish safe-to-prune bloat from critical state data, then generates risk-tiered fix plan"
triggers:
  - docker
  - storage
  - volume
  - disk full
  - no space left
  - df
tools:
  - docker
  - redis-cli
  - df
  - du
  - truncate
preferred_model: default
priority: 10
---
```

### E2E Test: Canned Fix Plan
```typescript
// Source: tests/e2e/poc-postgres-connleak.test.ts (adapted)
const cannedFixPlan: FixPlan = {
  summary: 'Truncate bloated log file and restart crashed Redis',
  complexity: 'moderate',
  steps: [
    {
      command: 'docker exec storage-logger du -sh /shared/*',
      description: 'Identify bloat source files on shared volume',
      risk: 'read',
      rollback: 'N/A',
    },
    {
      command: 'docker exec storage-logger truncate -s 0 /shared/bloat.log',
      description: 'Truncate bloated log file (preserves inode)',
      risk: 'write',
      rollback: 'File will be re-created by logger if still running',
    },
    {
      command: 'docker restart storage-redis',
      description: 'Restart Redis to recover from crash state',
      risk: 'write',
      rollback: 'docker stop storage-redis',
    },
    {
      command: 'docker exec storage-redis redis-cli PING',
      description: 'Verify Redis recovered and responding',
      risk: 'read',
      rollback: 'N/A',
    },
  ],
};
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Per-service tmpfs | Named volume with tmpfs driver | Always (Docker limitation) | Per-service tmpfs cannot be shared |
| `rm` log files | `truncate -s 0` | Best practice | Preserves inode, prevents ghost file handle leaks |
| Single health check (disk only) | Dual verification (disk + app health) | InfraBrain v1.1 pattern | Eliminates "False Green" where resource freed but service still down |

## Open Questions

1. **Exact Redis crash behavior on full tmpfs**
   - What we know: Redis logs "Background saving error" and may refuse writes when BGSAVE fails
   - What's unclear: Whether Redis fully crashes (exits) or just enters error state refusing writes
   - Recommendation: Test at implementation time. If Redis doesn't exit, the broken state check should verify `redis-cli PING` returning an error OR `redis-cli SET test 1` being refused. The `--save 1 1` flag with `--stop-writes-on-bgsave-error yes` (default) should cause Redis to refuse writes but still respond to PING. May need `--oom-score-adj` or to check for write refusal instead of connection refusal.

2. **Docker Compose network naming with nested directories**
   - What we know: Default network is `<project>_default` where project is the directory name
   - What's unclear: When compose file is at `demo/docker-storage/docker-compose.yml`, project name is `docker-storage`
   - Recommendation: Explicitly set `name:` on network in compose file, or use `-p` project flag. Verify at implementation time.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest (existing) |
| Config file | vitest.config.ts |
| Quick run command | `npx vitest run tests/e2e/poc-docker-storage.test.ts` |
| Full suite command | `npx vitest run` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SCEN-04 | Docker Compose env starts with full volume + crashing container | e2e (beforeAll + test 1) | `npx vitest run tests/e2e/poc-docker-storage.test.ts -t "broken environment"` | No -- Wave 0 |
| SCEN-05 | docker-storage.md skill diagnoses and generates fix plan | e2e (test 2) | `npx vitest run tests/e2e/poc-docker-storage.test.ts -t "diagnoses"` | No -- Wave 0 |
| SCEN-06 | Reset script reproduces broken state idempotently | e2e (beforeAll) | `bash demo/docker-storage/reset-docker-storage.sh` | No -- Wave 0 |
| E2E-02 | Full DPEV loop automated E2E test | e2e (tests 2-4) | `npx vitest run tests/e2e/poc-docker-storage.test.ts` | No -- Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run tests/e2e/poc-docker-storage.test.ts`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `demo/docker-storage/docker-compose.yml` -- scenario infrastructure
- [ ] `demo/docker-storage/logger/Dockerfile` + `entrypoint.sh` -- bloat generator
- [ ] `demo/docker-storage/reset-docker-storage.sh` -- idempotent reset
- [ ] `skills/docker-storage.md` -- diagnostic skill
- [ ] `src/api/routes/debug.ts` -- DISCOVERY_COMMANDS entry (modification, not new file)
- [ ] `tests/e2e/poc-docker-storage.test.ts` -- full DPEV E2E test

## Sources

### Primary (HIGH confidence)
- Phase 9 implementation: `demo/postgres/` directory, `skills/postgres-troubleshoot.md`, `tests/e2e/poc-postgres-connleak.test.ts` -- direct templates
- `src/api/routes/debug.ts` lines 84-108 -- DISCOVERY_COMMANDS registry pattern
- Docker Compose GitHub issue #5907 -- named volume with tmpfs driver syntax

### Secondary (MEDIUM confidence)
- [Docker tmpfs mounts docs](https://docs.docker.com/engine/storage/tmpfs/) -- tmpfs cannot be shared per-service
- [Docker Compose issue #5682](https://github.com/docker/compose/issues/5682) -- top-level tmpfs volumes not supported natively
- [Docker volumes docs](https://docs.docker.com/engine/storage/volumes/) -- named volume driver_opts

### Tertiary (LOW confidence)
- Redis crash behavior on full disk with `--stop-writes-on-bgsave-error yes` -- needs implementation-time verification

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- identical to Phase 9, all libraries proven
- Architecture: HIGH -- direct template from Phase 9 with one novel element (tmpfs named volume)
- Pitfalls: HIGH -- tmpfs sharing limitation verified via official Docker sources
- Redis crash behavior: MEDIUM -- default `stop-writes-on-bgsave-error` is documented but exact crash vs error-state behavior needs testing

**Research date:** 2026-03-13
**Valid until:** 2026-04-13 (stable -- Docker Compose and Redis behavior rarely change)
