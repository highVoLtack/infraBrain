# Phase 12: Linux Filesystem Permission Trap Scenario - Research

**Researched:** 2026-03-14
**Domain:** Linux filesystem permissions, Docker UID mapping, DPEV scenario
**Confidence:** HIGH

## Summary

Phase 12 implements the third scenario in the Chaos Library: a Docker container crashes with "Permission Denied" because the app runs as UID 1000 but the target directory `/app/data` is owned by root:root with 700 permissions. InfraBrain's Technical Lead (Qwen 32B, `preferred_model: default`) must autonomously diagnose the ownership mismatch and fix it.

This phase follows the exact same Scenario-per-Directory pattern established in Phases 9 (Postgres) and 10 (Docker Storage): `demo/permission-trap/` with Docker Compose, reset script, skill file, discovery commands in `debug.ts`, and mocked E2E test. The only novel element is the domain -- Linux filesystem permissions instead of database connections or disk storage.

The key technical insight is that this scenario is deliberately simple from an infrastructure perspective (no shared volumes, no multi-container coordination, no service-specific protocols). The complexity is in the diagnostic reasoning: the LLM must read logs, inspect permissions, check the running user, and correlate the mismatch. This proves InfraBrain can handle generic OS-level troubleshooting beyond database-specific skills.

**Primary recommendation:** Follow the Phase 10 template exactly. The scenario setup is simpler (single container, no shared volumes). The skill's diagnostic ladder has 4 steps focused on permission investigation. All infrastructure (executor, rolling context, audit, E2E scaffolding) is proven.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Create `demo/permission-trap/` directory
- Docker Compose: Simple Python app that tries to write to `/app/data/status.pid`
- The Sabotage: `/app/data` directory is owned by root:root with 700 permissions, but app runs as UID 1000
- Result: App crashes with "Permission Denied"
- Create `linux-filesystem-troubleshoot.md` skill file
- Diagnostic Ladder: 1) Check container logs (see Permission Denied), 2) Check directory permissions (`ls -ld /app/data`), 3) Check current user (`id` / `whoami`), 4) Correlate: Owner mismatch
- Fix: `chown 1000:1000 /app/data` or `chmod 777`
- Reuse existing DPEV loop, sub-agent execution, and Engine-First patterns
- No DB-specific logic -- pure OS-level troubleshooting
- Follow same patterns as Nginx 502, Postgres, Docker Storage scenarios

### Claude's Discretion
- Specific Python app implementation details (minimal is fine)
- Skill file structure (follow existing skill patterns)
- E2E test implementation approach
- Whether to add new tool allowlist entries for filesystem commands

### Deferred Ideas (OUT OF SCOPE)
None -- this is a focused scenario insertion.
</user_constraints>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Docker Compose | v2+ | Container orchestration for demo scenario | Already used in Phases 9, 10 |
| Python | 3.x-slim | Victim app that crashes on permission denied | Minimal, produces clear error in logs |
| vitest | existing | E2E test framework | Already used in all E2E tests |
| supertest | existing | HTTP assertions for E2E tests | Already used in all E2E tests |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @toon-format/toon | existing | TOON encoding for discovery output | Discovery commands TOON-encode results before LLM injection |

### Alternatives Considered
None -- all locked by CONTEXT.md decisions and established scenario patterns.

**Installation:**
No new dependencies required. All libraries already in project.

## Architecture Patterns

### Recommended Project Structure
```
demo/permission-trap/
  docker-compose.yml           # Single Python app service
  app/
    Dockerfile                 # Python 3-slim, USER 1000, COPY app.py
    app.py                     # Tries to write /app/data/status.pid, crashes
  reset-permission-trap.sh     # Idempotent reset script

skills/
  linux-filesystem-troubleshoot.md   # 4-step Diagnostic Ladder skill

src/api/routes/debug.ts        # Add DISCOVERY_COMMANDS['linux-filesystem-troubleshoot'] entry

tests/e2e/
  poc-permission-trap.test.ts  # Full DPEV loop E2E test
```

### Pattern 1: Permission Trap via Dockerfile (CRITICAL)
**What:** Create a container where the app directory exists but is owned by root with restrictive permissions, while the app runs as a non-root user.
**When to use:** This specific scenario.
**Confidence:** HIGH (standard Docker USER + filesystem permission behavior)
**Example:**
```dockerfile
# demo/permission-trap/app/Dockerfile
FROM python:3-slim

WORKDIR /app

# Create the data directory as root with restrictive permissions
RUN mkdir -p /app/data && \
    chown root:root /app/data && \
    chmod 700 /app/data

COPY app.py /app/app.py

# Switch to non-root user UID 1000
USER 1000

CMD ["python", "/app/app.py"]
```

Key points:
- `mkdir -p /app/data` creates directory while still running as root (default in Dockerfile before USER)
- `chown root:root` + `chmod 700` = only root can read/write/enter
- `USER 1000` switches to non-root user for CMD
- When app.py tries to write to `/app/data/status.pid`, it gets PermissionError
- The container will exit immediately (crash), not stay running -- reset script must account for this

### Pattern 2: Minimal Python App
**What:** The app just tries to write a PID file and crashes.
**Confidence:** HIGH
**Example:**
```python
# demo/permission-trap/app/app.py
import os
import sys

pid_path = "/app/data/status.pid"
print(f"Writing PID to {pid_path}...")

try:
    with open(pid_path, "w") as f:
        f.write(str(os.getpid()))
    print(f"PID {os.getpid()} written successfully.")
except PermissionError as e:
    print(f"FATAL: Permission denied writing to {pid_path}: {e}", file=sys.stderr)
    sys.exit(1)
```

Key points:
- Minimal -- no dependencies, no frameworks
- Prints clear error message mentioning "Permission denied" and the path
- Exits with code 1 so Docker marks container as exited/crashed
- The error message in logs is what InfraBrain's diagnostic ladder reads first

### Pattern 3: Docker Compose (Single Service)
**What:** Simpler than previous scenarios -- just one service, no shared volumes, no networks.
**Confidence:** HIGH
**Example:**
```yaml
# demo/permission-trap/docker-compose.yml
services:
  permission-app:
    build: ./app
    container_name: permission-app
```

Key points:
- Single service -- much simpler than postgres (2 services + network) or docker-storage (2 services + shared volume)
- Container name `permission-app` is unique across all demos
- No ports needed -- app doesn't serve anything
- No volumes needed -- everything is inside the container
- Container will be in "exited" state after crash, which is the intended broken state

### Pattern 4: Reset Script (Exited Container)
**What:** Unlike previous scenarios where broken state = running container with errors, here broken state = container has exited with non-zero code.
**Confidence:** HIGH
**Example:**
```bash
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.yml"

echo "==> Tearing down existing permission-trap environment..."
docker compose -f "$COMPOSE_FILE" down --remove-orphans 2>/dev/null || true

echo "==> Building and starting permission-app..."
docker compose -f "$COMPOSE_FILE" up -d --build

echo "==> Waiting for app to crash (max 30s)..."
for i in $(seq 1 15); do
  STATUS=$(docker inspect --format '{{.State.Status}}' permission-app 2>/dev/null || echo "missing")
  if [ "$STATUS" = "exited" ]; then
    EXIT_CODE=$(docker inspect --format '{{.State.ExitCode}}' permission-app 2>/dev/null || echo "0")
    if [ "$EXIT_CODE" != "0" ]; then
      echo "SUCCESS: permission-app crashed with exit code $EXIT_CODE"
      exit 0
    fi
  fi
  sleep 2
done

echo "ERROR: App did not crash within 30 seconds"
exit 1
```

Key differences from previous reset scripts:
- Checks for container "exited" state, not running-but-broken state
- Uses `docker inspect --format '{{.State.Status}}'` instead of application-level health checks
- Shorter timeout (30s) since crash should be nearly instant
- No need to poll application health -- the crash IS the broken state

### Pattern 5: Diagnostic Ladder Skill (OS-Level)
**What:** 4-step diagnostic ladder focused on filesystem permissions -- no DB-specific or application-specific logic.
**Confidence:** HIGH
**Diagnostic steps:**

| Step | Action | Purpose | Command |
|------|--------|---------|---------|
| 0 | Container Discovery | Find container names and status | `docker ps -a --format "{{.Names}} {{.Status}}"` |
| 1 | Log Analysis | Read crash logs for error | `docker logs permission-app` |
| 2 | Permission Check | Inspect directory ownership/mode | `docker exec permission-app ls -ld /app/data` (NOTE: will fail on exited container -- see Pitfall 2) |
| 3 | User Check | Identify running user | Read from Dockerfile or `docker inspect` |
| 4 | Correlate + Fix | Match owner mismatch, propose chown | `docker exec` with `chown` |

**CRITICAL INSIGHT:** Since the container is exited/crashed, `docker exec` will NOT work. The diagnostic must use alternative approaches:
- `docker logs permission-app` -- works on exited containers
- `docker inspect permission-app` -- works on exited containers
- To fix: start a temporary container or use `docker run` with the same image to inspect and fix, or `docker cp` + restart approach

This creates a more realistic diagnostic challenge -- the LLM must recognize that `docker exec` fails on a stopped container and adapt its approach.

### Pattern 6: Discovery Commands for Permission Trap
**What:** Add `linux-filesystem-troubleshoot` entry to `DISCOVERY_COMMANDS` in `debug.ts`.
**Confidence:** HIGH
**Example:**
```typescript
'linux-filesystem-troubleshoot': [
  { command: 'docker ps -a --format "{{.Names}} {{.Status}}"', label: 'All containers (including exited)' },
  { command: 'docker logs permission-app --tail 50', label: 'App crash logs' },
  {
    command: 'docker inspect permission-app --format "{{.Config.User}}"',
    label: 'Container user configuration',
  },
  {
    command: 'docker run --rm --entrypoint ls permission-trap-permission-app -ld /app/data',
    label: 'Directory permissions on /app/data',
  },
  {
    command: 'docker run --rm --entrypoint id permission-trap-permission-app',
    label: 'User identity when running as configured user',
  },
],
```

**Key difference from previous discovery:** Uses `docker ps -a` (not just `docker ps`) because the container is exited. Uses `docker run --rm --entrypoint` to inspect the filesystem inside the image since `docker exec` won't work on a stopped container. The image name follows Docker Compose convention: `<project>-<service>` = `permission-trap-permission-app`.

**Alternative approach (simpler):** Instead of `docker run`, the discovery could start a helper container that mounts the same build context. However, this adds complexity. A cleaner approach is to keep the container running by having the app sleep after crash:

```python
# Alternative app.py that stays running for docker exec
import os, sys, time

try:
    with open("/app/data/status.pid", "w") as f:
        f.write(str(os.getpid()))
except PermissionError as e:
    print(f"FATAL: Permission denied: {e}", file=sys.stderr)
    # Don't exit -- stay alive for diagnostics
    while True:
        time.sleep(60)
```

**Recommendation (Claude's discretion):** Keep the app running after the error (sleep loop) so `docker exec` works for diagnostics. This matches the pattern from docker-storage (logger stays alive). Simpler discovery commands, simpler E2E test, and `docker exec chown` works directly as the fix. The broken state is: container running but app failed to write PID file + logs show Permission Denied.

### Anti-Patterns to Avoid
- **Exiting container immediately:** Makes `docker exec` impossible, complicating both discovery and fix execution. Keep container alive with sleep loop.
- **Using `chmod 777` as the fix in the skill:** While technically valid, `chown 1000:1000 /app/data` is the proper fix. `chmod 777` is a security anti-pattern. The skill should prefer `chown`.
- **Running discovery as root:** Discovery commands must run as the app user to see the permission problem from the app's perspective.
- **Hardcoding container/image names in skill:** Must come from discovery ground truth.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Permission trap setup | Complex entrypoint scripts | Dockerfile RUN + USER directives | Docker's built-in USER instruction is the standard way to switch users |
| Container crash detection | Custom health check logic | `docker inspect --format '{{.State.Status}}'` | Standard Docker API |
| E2E test scaffold | New test framework | Copy poc-docker-storage.test.ts | Identical pattern: mock LLM, real Docker, sequential DPEV tests |
| Skill template | New format | Follow docker-storage.md structure | Proven structure with Zod validation |
| TOON encoding | Custom serialization | `@toon-format/toon` (already in deps) | Established pattern in discovery command output |

## Common Pitfalls

### Pitfall 1: Container Exits Before Diagnostics
**What goes wrong:** App crashes and container exits. `docker exec` returns "container is not running".
**Why it happens:** Python exits with sys.exit(1) on PermissionError.
**How to avoid:** Keep the container alive with a sleep loop after the error. The "broken state" is the app failing to write, not the container being down.
**Warning signs:** Discovery commands with `docker exec` return errors in E2E test.

### Pitfall 2: docker exec as Root vs App User
**What goes wrong:** `docker exec` runs as root by default, so `ls -ld /app/data` shows accessible permissions (root can access 700 directories).
**Why it happens:** Docker exec uses root unless `--user` is specified.
**How to avoid:** Use `docker exec --user 1000 permission-app` for user-perspective commands. Or better: the diagnostic should check `id` output and then correlate with `ls -ld` output -- the mismatch is visible regardless of who runs `ls`.
**Warning signs:** LLM doesn't see a problem because root can read everything.

### Pitfall 3: Image Name vs Container Name
**What goes wrong:** `docker run --entrypoint` uses the wrong image name.
**Why it happens:** Docker Compose generates image names as `<project>-<service>` but container names as `container_name` from compose file.
**How to avoid:** If keeping app alive (recommended), use `docker exec` with container name only. Avoid `docker run` in discovery.
**Warning signs:** "No such image" errors in discovery.

### Pitfall 4: Safety Rules - chown/chmod Not Classified
**What goes wrong:** `chown` and `chmod` commands are not in the DEFAULT_RULES in `src/safety/rules.ts`. They'll fall through to the default classification.
**Why it happens:** Previous scenarios only needed `docker`, `redis-cli`, `df`, `du`, `truncate`, `psql`.
**How to avoid:** Check what the default classification is for unrecognized commands. May need to add `chown` and `chmod` to safety rules as WRITE-level commands. Also need `id`, `ls`, `stat` classified (some already are: `ls` is READ, `whoami` is READ).
**Warning signs:** Fix plan steps with `chown` get unexpected risk classification.

### Pitfall 5: BLOCKED_PATTERNS Match on chmod
**What goes wrong:** `chmod -R 777 /` is in BLOCKED_PATTERNS. If the LLM generates `chmod 777 /app/data`, the regex `/chmod\s+-R\s+777\s+\//` should NOT match (no `-R` flag, not root `/`). But if the LLM hallucinates `chmod -R 777 /app/data`, it still shouldn't match because the path isn't bare `/`. However, verify this.
**Why it happens:** Safety blocklist uses regex that specifically targets `chmod -R 777 /` (recursive on root).
**How to avoid:** The skill should recommend `chown 1000:1000 /app/data` as the fix, not `chmod`. If `chmod` is used, ensure it's targeted (e.g., `chmod 755 /app/data`), not `777`.
**Warning signs:** Fix plan blocked by safety rules.

### Pitfall 6: Container Name Collisions
**What goes wrong:** `permission-app` conflicts with other running containers.
**Why it happens:** Multiple demo scenarios may run simultaneously.
**How to avoid:** Use unique container name (`permission-app`) and verify it doesn't conflict with `demo-nginx`, `demo-backend`, `postgres-demo`, `leaky-app`, `storage-logger`, `storage-redis`.
**Warning signs:** `docker compose up` fails with "name already in use".

## Code Examples

### Skill Frontmatter
```yaml
# Source: Adapted from skills/docker-storage.md
---
name: linux-filesystem-troubleshoot
description: "Diagnoses Linux filesystem permission issues in Docker containers -- ownership mismatches, mode restrictions, and UID mapping problems"
triggers:
  - permission denied
  - permission
  - chown
  - chmod
  - access denied
  - filesystem
  - ownership
tools:
  - docker
  - ls
  - id
  - stat
  - chown
  - chmod
  - cat
  - whoami
preferred_model: default
priority: 10
---
```

### Skill System Prompt Structure
```markdown
## System Prompt

You are a surgical Linux filesystem permission analyst. You diagnose permission denied errors by correlating file ownership, directory modes, and process UID. You are a production execution engine, not a tutor.

## STRICT RULES
[Same 6 rules as docker-storage.md and postgres-troubleshoot.md]

### Diagnostic Ladder

**Step 0: Container Discovery (MANDATORY)**
Run: `docker ps -a --format "{{.Names}} {{.Status}}"` and `docker logs <container>`
Purpose: Discover container names, status, and crash logs. Note: use `docker ps -a` to include exited containers.

**Step 1: Log Analysis**
Run: `docker logs <container> --tail 50`
Purpose: Find the Permission Denied error message, identify which path failed.
Output: Error message with file path.

**Step 2: Permission Inspection**
Run: `docker exec <container> ls -ld <path>` (must run inside container)
Purpose: Check directory ownership (user:group) and mode bits.
Output: Permission string, owner, group for the target directory.

**Step 3: User Identity Check**
Run: `docker exec <container> id`
Purpose: Determine which UID/GID the process runs as.
Output: uid=1000(?) gid=1000(?) groups=...

**Step 4: Correlation and Fix**
Purpose: Correlate: directory owned by root:root mode 700, process runs as UID 1000.
Fix: `docker exec <container> chown 1000:1000 <path>` -- requires running exec as root.
Note: `docker exec` runs as root by default, so chown will succeed even though the app user can't access the directory.

### Important Rules
- Use `docker ps -a` (not `docker ps`) to see exited/crashed containers.
- `docker exec` runs as root by default -- this is how chown works even on restricted directories.
- Prefer `chown` over `chmod 777` -- changing ownership is the correct fix, not opening permissions to everyone.
- After fix, the app may need restart: `docker restart <container>`.
```

### Discovery Commands (for debug.ts)
```typescript
'linux-filesystem-troubleshoot': [
  { command: 'docker ps -a --format "{{.Names}} {{.Status}}"', label: 'All containers with status' },
  { command: 'docker logs permission-app --tail 50', label: 'App crash logs' },
  {
    command: 'docker exec permission-app ls -ld /app/data',
    label: 'Target directory permissions',
  },
  {
    command: 'docker exec permission-app id',
    label: 'App user identity',
  },
],
```
Note: These `docker exec` commands work because the app stays alive (sleep loop after error). The discovery reveals: logs show "Permission denied", `ls -ld` shows `drwx------ root root`, `id` shows `uid=1000`.

### Canned Fix Plan (for E2E test)
```typescript
const cannedFixPlan: FixPlan = {
  summary: 'Fix directory ownership to match app user and restart',
  complexity: 'simple',
  steps: [
    {
      command: 'docker exec permission-app ls -ld /app/data',
      description: 'Verify directory ownership and permissions',
      risk: 'read',
      rollback: 'N/A',
    },
    {
      command: 'docker exec -u 0 permission-app chown 1000:1000 /app/data',
      description: 'Change directory ownership to app user (UID 1000)',
      risk: 'write',
      rollback: 'docker exec -u 0 permission-app chown root:root /app/data',
    },
    {
      command: 'docker restart permission-app',
      description: 'Restart app to retry PID file write',
      risk: 'write',
      rollback: 'docker stop permission-app',
    },
    {
      command: 'docker logs permission-app --tail 5',
      description: 'Verify app started successfully after fix',
      risk: 'read',
      rollback: 'N/A',
    },
  ],
};
```

Note: `docker exec -u 0` ensures chown runs as root. Without `-u 0`, exec defaults to root anyway, but being explicit is safer and clearer in the skill.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Exit container on error | Keep alive with sleep loop | InfraBrain pattern | Enables `docker exec` for diagnostics |
| `chmod 777` | `chown` to correct UID | Security best practice | Proper fix, not security hole |
| Root containers | Non-root USER in Dockerfile | Docker security hardening | Standard practice, this scenario exploits the UID mismatch |

## Open Questions

1. **Safety rule classification for chown/chmod**
   - What we know: `chown` and `chmod` are not in DEFAULT_RULES. `ls` and `whoami` are READ. `chmod -R 777 /` is in BLOCKED_PATTERNS.
   - What's unclear: What happens when an unclassified command goes through the safety classifier. Need to verify default behavior.
   - Recommendation: Add `chown` and `chmod` as WRITE-level commands in safety rules, and `id` and `stat` as READ-level. Verify at implementation time that unclassified commands don't silently pass or silently block.

2. **docker exec -u 0 for fix commands**
   - What we know: `docker exec` defaults to root. But to be explicit and safe, `-u 0` is better.
   - What's unclear: Whether the safety classifier handles `docker exec -u 0` correctly (pattern is `^docker\s+exec` which isn't in DEFAULT_RULES currently -- only `docker ps`, `docker logs`, `docker inspect`, `docker restart`, etc. are classified).
   - Recommendation: Verify that `docker exec` commands flow through the skill allowlist (which allows `docker`) rather than needing individual safety rule entries.

3. **App restart verification**
   - What we know: After `chown` fix + `docker restart`, the app should successfully write the PID file.
   - What's unclear: Whether the app's success message will appear in `docker logs` after restart (it should, since restart recreates the process).
   - Recommendation: The verification step should check `docker logs --tail 5` for the success message "PID written successfully" and confirm no "Permission denied" in recent logs.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest (existing) |
| Config file | vitest.config.ts |
| Quick run command | `npx vitest run tests/e2e/poc-permission-trap.test.ts` |
| Full suite command | `npx vitest run` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| (no ID) | Docker Compose env starts with permission-denied crash | e2e (beforeAll + test 1) | `npx vitest run tests/e2e/poc-permission-trap.test.ts -t "broken environment"` | No -- Wave 0 |
| (no ID) | linux-filesystem-troubleshoot.md skill diagnoses and generates fix plan | e2e (test 2) | `npx vitest run tests/e2e/poc-permission-trap.test.ts -t "diagnoses"` | No -- Wave 0 |
| (no ID) | Reset script reproduces broken state idempotently | e2e (beforeAll) | `bash demo/permission-trap/reset-permission-trap.sh` | No -- Wave 0 |
| (no ID) | Full DPEV loop automated E2E test | e2e (tests 2-4) | `npx vitest run tests/e2e/poc-permission-trap.test.ts` | No -- Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run tests/e2e/poc-permission-trap.test.ts`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `demo/permission-trap/docker-compose.yml` -- scenario infrastructure
- [ ] `demo/permission-trap/app/Dockerfile` + `app.py` -- victim app
- [ ] `demo/permission-trap/reset-permission-trap.sh` -- idempotent reset
- [ ] `skills/linux-filesystem-troubleshoot.md` -- diagnostic skill
- [ ] `src/api/routes/debug.ts` -- DISCOVERY_COMMANDS entry (modification, not new file)
- [ ] `tests/e2e/poc-permission-trap.test.ts` -- full DPEV E2E test
- [ ] `src/safety/rules.ts` -- add `chown`, `chmod` as WRITE and `id`, `stat` as READ (modification)

## Sources

### Primary (HIGH confidence)
- Phase 10 implementation: `demo/docker-storage/`, `skills/docker-storage.md`, `tests/e2e/poc-docker-storage.test.ts` -- direct templates
- Phase 9 implementation: `demo/postgres/`, `skills/postgres-troubleshoot.md` -- pattern origin
- `src/api/routes/debug.ts` -- DISCOVERY_COMMANDS registry pattern (lines 131-174)
- `src/safety/rules.ts` -- safety classification rules and BLOCKED_PATTERNS
- `src/skills/types.ts` -- SkillFrontmatterSchema (Zod validation)
- `docs/templates/base-skill-template.md` -- skill authoring template with STRICT RULES

### Secondary (MEDIUM confidence)
- Docker USER instruction behavior -- standard Docker documentation
- Linux filesystem permission model (uid/gid, mode bits) -- stable OS-level knowledge

### Tertiary (LOW confidence)
- None -- this phase relies entirely on established InfraBrain patterns and well-understood Linux/Docker concepts.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- identical to Phases 9/10, all libraries proven
- Architecture: HIGH -- direct template from Phase 10 with simpler scenario (single container)
- Pitfalls: HIGH -- all pitfalls are about InfraBrain integration (safety rules, docker exec on exited containers), not external unknowns
- Scenario domain: HIGH -- Linux filesystem permissions are the most stable, well-understood domain possible

**Research date:** 2026-03-14
**Valid until:** 2026-04-14 (stable -- Linux permissions and Docker USER behavior do not change)
