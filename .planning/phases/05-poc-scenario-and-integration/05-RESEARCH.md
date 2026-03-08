# Phase 5: POC Scenario and Integration - Research

**Researched:** 2026-03-08
**Domain:** Docker/Nginx E2E integration, skill authoring, scenario-based testing
**Confidence:** HIGH

## Summary

Phase 5 is an integration phase, not a feature-building phase. All core components exist (orchestrator, executor, audit logger, CLI, skills system, TOON encoder). The work is: (1) create the Docker Compose broken environment, (2) author the `nginx-troubleshoot.md` skill, (3) wire the full DPEV loop end-to-end through existing components, and (4) write an E2E test proving it works.

The biggest technical challenge is the debug route's current architecture: it generates a diagnosis and optionally a fix plan, but only triggers the planner when the selected skill is literally named "planning". For the Nginx troubleshoot skill, the debug route needs to produce a diagnosis AND a fix plan from a single skill that is NOT named "planning". This is the primary integration gap.

**Primary recommendation:** Wire the full DPEV loop by extending the debug route to generate fix plans from any diagnostic skill (not just "planning"), create the Docker Compose scenario with network isolation as the failure mechanism, author the Nginx troubleshoot skill with Diagnostic Ladder prompting, and validate everything with a supertest-based E2E test against the Express app (mocking LLM responses but running real Docker commands).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Docker Compose with Nginx (frontend network) proxying to httpbin (backend network) -- wrong network causes 502
- httpbin as backend target -- predictable API allows the Scenario Factory to simulate diverse failures via Nginx config changes alone
- One-command `demo/reset.sh` designed as a modular "Scenario Factory" -- tears down, recreates broken environment, extensible for future failure scenarios
- Backend on separate Docker network (`backend`) while Nginx is on `frontend` -- forces cross-layer diagnosis (Nginx logs + Docker network metadata)
- Single `skills/nginx-troubleshoot.md` skill covering full loop (diagnosis + fix) -- "Environment-Aware Expertise" with Docker tool access
- Skill prompt enforces a "Diagnostic Ladder" (ordered investigation sequence): 1) HTTP response check, 2) Nginx error log analysis, 3) Docker network inspection, 4) Cross-layer correlation
- Skill acts as a state machine internally: gather evidence first, then propose plan, then execute after approval -- prevents hasty actions
- Docker commands included in the Nginx skill's tool allowlist (docker, curl, nginx, cat, grep, ss) -- avoids skill-chaining complexity in v1
- TOON encoding compresses diagnostic evidence at each ladder rung, maximizing context density for the cross-correlation step
- Surgical live remediation via `docker network connect frontend backend` -- single-command fix, no container restart
- Rollback: `docker network disconnect frontend backend`
- Verification: `curl http://localhost:8080/get` expecting HTTP 200
- Entry point: `/infra:debug "Why is Nginx returning 502?"` -- natural language triggers LLM-based skill routing
- Progressive disclosure output: each DPEV phase shown clearly with key findings, full verbose data streamed to SQLite in background
- Post-fix summary shows: verification status, budget used, session ID, and hint to run `/infra:history --session <id>`
- `/infra:history --session <id> --verbose` shows complete trail
- LLM reasoning stored in audit log
- State diffs prove "Command output capture" strategy
- Scripted E2E test (`tests/e2e/poc-nginx-502.test.ts`) validates the full DPEV loop programmatically
- Test sequence: start broken env -> POST /debug -> verify diagnosis -> check fix plan -> POST /execute (autoApprove: true for test mode) -> verify HTTP 200 -> check audit trail completeness

### Claude's Discretion
- Exact Nginx error log patterns to match for 502 diagnosis
- httpbin endpoint selection for verification (/get vs /status/200)
- Docker Compose version and image tags
- E2E test timeout values and retry strategy
- Exact TOON encoding thresholds for diagnostic evidence

### Deferred Ideas (OUT OF SCOPE)
- `/infra:report <session-id>` -- automated post-mortem report generation (PDF/Markdown) for management
- Config-Drift skill -- declarative config-file synchronization as alternative fix approach
- Multi-fault scenarios -- multiple simultaneous issues requiring compound fixes
- Scenario Factory expansion -- programmatic failure injection for comprehensive integration testing
- Separate `docker-infra` skill for non-Nginx Docker issues
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| POC-01 | Docker Compose test environment with intentionally broken Nginx (returns 502) | Docker Compose with `frontend`/`backend` network separation; Nginx proxy_pass to httpbin on wrong network; `demo/reset.sh` Scenario Factory |
| POC-02 | End-to-end demo: admin triggers debug -> system diagnoses -> writes fix plan -> generates corrected config -> admin approves -> fix applied -> health check passes | Full DPEV loop via debug route (diagnosis + plan) -> execute route (approval + execution) -> verification step; requires extending debug route to generate fix plans from diagnostic skills |
| POC-03 | Demo shows full audit trail of the fix including decision reasoning and state diffs | AuditLogger already captures all events to SQLite; history route already queries with filters; need state diff capture for `docker network connect` via snapshot module extension |
</phase_requirements>

## Standard Stack

### Core (Already Installed)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| express | ^5.2.1 | HTTP API server | Already wired, all routes mounted |
| vitest | ^4.0.18 | Test framework | Project standard, 311 tests passing |
| supertest | ^7.2.2 | HTTP assertion library | Already used in API tests |
| better-sqlite3 | ^12.6.2 | Audit trail storage | WriteThrough dual-write pattern established |
| zod | ^4.3.6 | Schema validation | FixPlanSchema, SkillFrontmatterSchema already defined |
| @toon-format/toon | ^2.1.0 | Token compression | encodeToon/encodeForLLM already integrated |

### New Dependencies Needed
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| None | - | - | All dependencies already installed |

### Docker Images Needed (for demo environment)
| Image | Tag | Purpose |
|-------|-----|---------|
| nginx | alpine (latest stable) | Reverse proxy returning 502 |
| kennethreitz/httpbin | latest | Predictable backend API |

**Installation:** No npm installs needed. Docker images pulled by `docker compose up`.

## Architecture Patterns

### Recommended Project Structure (New Files)
```
demo/
├── docker-compose.yml    # Broken Nginx + httpbin with network isolation
├── nginx.conf            # Proxy config pointing to httpbin
├── reset.sh              # Scenario Factory: tear down + recreate broken env
skills/
├── nginx-troubleshoot.md # New skill: Diagnostic Ladder for Nginx 502
tests/
├── e2e/
│   └── poc-nginx-502.test.ts  # E2E integration test
```

### Pattern 1: Diagnostic Ladder Skill
**What:** The `nginx-troubleshoot.md` skill encodes a systematic investigation sequence in its system prompt, directing the LLM through ordered diagnostic steps before proposing a fix.
**When to use:** Any skill that requires cross-layer correlation (multiple tools, multiple evidence sources).
**Skill structure:**
```markdown
---
name: nginx-troubleshoot
description: "Diagnoses Nginx issues using systematic Diagnostic Ladder..."
triggers:
  - nginx
  - 502
  - bad gateway
  - proxy
tools:
  - docker
  - curl
  - nginx
  - cat
  - grep
  - ss
priority: 10
---

## System Prompt
[Diagnostic Ladder instructions: HTTP check -> error logs -> Docker network -> correlation -> fix plan]

## Tools
[Tool descriptions for docker, curl, nginx, cat, grep, ss]

## Examples
[Nginx 502 due to network isolation example with expected diagnostic steps and fix plan]
```

### Pattern 2: DPEV Loop Integration (Debug -> Execute -> Verify)
**What:** The current debug route only generates fix plans when the skill is literally named "planning". For POC, diagnosis + plan generation must work from any diagnostic skill.
**Critical integration gap:** In `src/api/routes/debug.ts` line 139: `if (selection.skill.frontmatter.name === 'planning')` -- this must be extended to generate fix plans from any skill that produces diagnostic output.
**Solution:** After diagnosis, always attempt fix plan generation using the diagnosis output. The planner module already accepts a diagnosis string and generates structured FixPlan via generateObject.

### Pattern 3: Docker Network Isolation as Failure Mechanism
**What:** Nginx on `frontend` network, httpbin on `backend` network. Nginx config has `proxy_pass http://backend:8080` but cannot reach the backend container because they are on different networks.
**Fix command:** `docker network connect frontend backend` -- joins the backend container to the frontend network.
**Why this works:** Single command, no restart needed, immediately verifiable, clean rollback via `docker network disconnect frontend backend`.

### Pattern 4: E2E Test with Mocked LLM
**What:** The E2E test does NOT require a running Ollama instance. Instead, mock the LLM provider to return predetermined diagnosis and fix plan responses. Real Docker commands execute against the actual Docker Compose environment.
**Why:** LLM responses are non-deterministic; testing the integration wiring (routing -> diagnosis -> plan -> execution -> verification -> audit) is what matters.

### Anti-Patterns to Avoid
- **Testing LLM output directly:** LLM responses vary per run. Mock the LLM, test the wiring.
- **Hardcoding container names in tests:** Use Docker Compose project name prefix for isolation.
- **Starting Ollama for E2E tests:** The test validates the pipeline, not the LLM. Mock it.
- **Putting fix plan generation only in "planning" skill:** The DPEV loop should generate plans from any diagnostic skill's output.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Audit trail | Custom file logger | Existing `AuditLogger` + `WriteThrough` | Already captures all event types, dual-write to file + SQLite |
| Fix plan schema | Custom plan format | Existing `FixPlanSchema` + `generateFixPlan()` | Zod validated, executor consumes it directly |
| Command execution | Custom shell runner | Existing `executePlan()` pipeline | Lock -> budget -> snapshot -> approval -> execute -> rollback |
| Skill loading | Custom parser | Existing `SkillRegistry.populate()` | gray-matter YAML frontmatter + section parser already works |
| TOON encoding | Custom compression | Existing `encodeForLLM()` | Already wired into orchestrator context builder |
| HTTP testing | Custom fetch calls | supertest against Express app | Already used in 3 test files |

**Key insight:** Phase 5 is 90% integration of existing components. The only new code is: Docker Compose files, Nginx skill, minor debug route extension, snapshot command mapping for `docker network connect`, and the E2E test.

## Common Pitfalls

### Pitfall 1: Debug Route Only Plans for "planning" Skill
**What goes wrong:** The debug route checks `selection.skill.frontmatter.name === 'planning'` before generating a fix plan. The new `nginx-troubleshoot` skill will never trigger plan generation.
**Why it happens:** Phase 2 only had a "planning" skill, so the conditional was sufficient.
**How to avoid:** Extend the debug route to generate fix plans from any skill's diagnosis output. Use a flag like `generatePlan: true` in the request body or always attempt plan generation after diagnosis.
**Warning signs:** Debug endpoint returns diagnosis but no `fixPlan` field when using the nginx-troubleshoot skill.

### Pitfall 2: Docker Network Not Cleaned Up Between Test Runs
**What goes wrong:** If the E2E test connects the backend to the frontend network but doesn't disconnect on teardown, the next test run starts with a "fixed" environment.
**Why it happens:** Test cleanup not running on failure.
**How to avoid:** Use `afterAll` / `afterEach` with `docker compose down` to tear down completely. The `demo/reset.sh` script should be the canonical reset.
**Warning signs:** Test passes on second run but fails on first (or vice versa).

### Pitfall 3: Snapshot Module Missing Docker Network Commands
**What goes wrong:** The `SNAPSHOT_COMMANDS` map in `src/execution/snapshot.ts` doesn't have entries for `docker network connect` or `docker network disconnect`. No before/after state diffs captured.
**Why it happens:** Phase 3 only mapped `docker stop/rm/restart` and `systemctl`/file commands.
**How to avoid:** Add `docker network connect` and `docker network disconnect` to SNAPSHOT_COMMANDS. Snapshot command: `docker network inspect <network-name>`.
**Warning signs:** Audit trail shows execution steps but no `state_change` events.

### Pitfall 4: Execute Route Session/Config Dependency
**What goes wrong:** The execute route is only mounted when `deps.config && deps.sessionId && deps.sessionDir` are all provided (see `server.ts` lines 67-74). In test setup, missing any of these silently skips route mounting.
**Why it happens:** Defensive mounting in createServer.
**How to avoid:** In E2E test setup, provide all required ServerDeps including sessionId, sessionDir, config, and store.
**Warning signs:** POST /execute returns 404.

### Pitfall 5: Shell Mode Commands in Executor
**What goes wrong:** Commands like `docker network connect frontend backend` are fine (no shell operators), but if the skill generates piped commands like `docker logs nginx | grep 502`, the executor warns about shell mode and `parseCommand()` won't handle pipes.
**Why it happens:** `execFile` doesn't support shell operators.
**How to avoid:** Ensure the skill's system prompt instructs the LLM to use individual commands (no pipes). The tool allowlist already enforces this per-command, but piped commands would be treated as a single string.
**Warning signs:** Commands with `|` fail silently or produce empty output.

## Code Examples

### Docker Compose for Broken Nginx Environment
```yaml
# demo/docker-compose.yml
services:
  nginx:
    image: nginx:alpine
    ports:
      - "8080:80"
    volumes:
      - ./nginx.conf:/etc/nginx/conf.d/default.conf:ro
    networks:
      - frontend
    depends_on:
      - backend

  backend:
    image: kennethreitz/httpbin
    networks:
      - backend   # Intentionally NOT on frontend -- causes 502

networks:
  frontend:
    driver: bridge
  backend:
    driver: bridge
```

### Nginx Config Proxying to Backend
```nginx
# demo/nginx.conf
server {
    listen 80;

    location / {
        proxy_pass http://backend:80;
        proxy_connect_timeout 5s;
        proxy_read_timeout 10s;
    }
}
```

### Scenario Factory Reset Script
```bash
#!/usr/bin/env bash
# demo/reset.sh -- Scenario Factory: tear down and recreate broken environment
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Tearing down existing environment..."
docker compose -f "$SCRIPT_DIR/docker-compose.yml" down --remove-orphans 2>/dev/null || true

echo "Starting broken environment (Nginx 502 scenario)..."
docker compose -f "$SCRIPT_DIR/docker-compose.yml" up -d

echo "Waiting for Nginx to start..."
sleep 2

echo "Verifying broken state (expecting 502)..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/get 2>/dev/null || echo "000")
if [ "$HTTP_CODE" = "502" ]; then
    echo "Environment ready: Nginx returns 502 as expected"
else
    echo "WARNING: Expected 502, got $HTTP_CODE"
fi
```

### Nginx Troubleshoot Skill Structure
```markdown
---
name: nginx-troubleshoot
description: "Diagnoses Nginx 502/connectivity issues using systematic Diagnostic Ladder with Docker awareness"
triggers:
  - nginx
  - 502
  - bad gateway
  - proxy
  - upstream
  - gateway
tools:
  - docker
  - curl
  - nginx
  - cat
  - grep
  - ss
priority: 10
---

## System Prompt

You are an Nginx troubleshooting specialist with Docker infrastructure awareness.

Follow the Diagnostic Ladder strictly in order:

### Step 1: HTTP Response Check
Run `curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/get` to confirm the failure state.

### Step 2: Nginx Error Log Analysis
Run `docker logs <nginx-container>` and look for upstream connection errors (connect() failed, connection refused, no live upstreams).

### Step 3: Docker Network Inspection
Run `docker network ls` then `docker network inspect <network>` for each relevant network. Identify which containers are on which networks.

### Step 4: Cross-Layer Correlation
Correlate Nginx error logs with Docker network topology. If Nginx cannot reach the upstream, check if the upstream container is on the same Docker network as Nginx.

### Step 5: Fix Proposal
Based on the diagnosis, propose a fix plan with:
- Single command per step
- Risk level for each step
- Rollback command for each step
- Verification command

Output your diagnosis as structured findings, then propose the fix plan.

## Tools

- `docker`: Docker CLI for container and network management (inspect, logs, network ls/inspect/connect/disconnect)
- `curl`: HTTP client for testing endpoints
- `nginx`: Nginx management (nginx -t for config test, nginx -s reload)
- `cat`: Read configuration files
- `grep`: Search patterns in logs and configs
- `ss`: Socket statistics for port checking

## Examples

**Example: Nginx 502 due to Docker network isolation**

Diagnostic Ladder execution:
1. `curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/get` -> 502 (confirmed)
2. `docker logs demo-nginx-1 --tail 20` -> "connect() failed (111: Connection refused) while connecting to upstream"
3. `docker network inspect demo_frontend` -> Nginx is on frontend, backend is NOT
4. Cross-correlation: Nginx tries to reach "backend" hostname, but backend container is only on "demo_backend" network. DNS resolution fails across isolated networks.

Fix plan:
1. `docker network connect demo_frontend demo-backend-1` (write) -- Connect backend to frontend network. Rollback: `docker network disconnect demo_frontend demo-backend-1`
2. `curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/get` (read) -- Verify fix. Expected: 200
```

### Extending Debug Route for Fix Plan Generation from Any Skill
```typescript
// In src/api/routes/debug.ts, replace the planning-only check:
// BEFORE: if (selection.skill.frontmatter.name === 'planning') {
// AFTER:  Always attempt fix plan generation from diagnosis

// After generating diagnosis:
try {
  const planningSkill = registry?.get('planning');
  if (planningSkill) {
    fixPlan = await generateFixPlan({
      model: provider.model,
      skill: planningSkill,
      userInput: prompt,
      diagnosis,
    });
    planMarkdown = generatePlanMarkdown(fixPlan);
    planTable = formatPlanTable(fixPlan);
  }
} catch (planErr) {
  auditLogger.logError(`Fix plan generation failed: ${(planErr as Error).message}`);
}
```

### Adding Docker Network Commands to Snapshot Module
```typescript
// Add to SNAPSHOT_COMMANDS in src/execution/snapshot.ts:
'docker network connect': (args) => `docker network inspect ${args[0]}`,
'docker network disconnect': (args) => `docker network inspect ${args[0]}`,
```

### E2E Test Structure (Mock LLM, Real Docker)
```typescript
// tests/e2e/poc-nginx-502.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import request from 'supertest';
// ... setup server with mocked LLM provider

describe('POC: Nginx 502 End-to-End', () => {
  beforeAll(() => {
    execSync('bash demo/reset.sh', { timeout: 30000 });
  });

  afterAll(() => {
    execSync('docker compose -f demo/docker-compose.yml down --remove-orphans', { timeout: 15000 });
  });

  it('diagnoses broken Nginx and generates fix plan', async () => {
    const res = await request(app)
      .post('/debug')
      .send({ prompt: 'Why is Nginx returning 502?' });
    expect(res.status).toBe(200);
    expect(res.body.diagnosis).toBeDefined();
    expect(res.body.fixPlan).toBeDefined();
    expect(res.body.fixPlan.steps.length).toBeGreaterThan(0);
  });

  it('executes fix plan and verifies health', async () => {
    const res = await request(app)
      .post('/execute')
      .send({ sessionId, fixPlan, target: 'nginx', adminName: 'admin' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('completed');

    // Verify fix
    const httpCode = execSync('curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/get').toString().trim();
    expect(httpCode).toBe('200');
  });

  it('audit trail contains full DPEV evidence', async () => {
    const res = await request(app)
      .get('/history')
      .query({ session: sessionId, verbose: 'true' });
    expect(res.body.entries.length).toBeGreaterThan(0);

    const eventTypes = res.body.entries.map((e: any) => e.eventType);
    expect(eventTypes).toContain('skill_selection');
    expect(eventTypes).toContain('decision');
    expect(eventTypes).toContain('execution_start');
    expect(eventTypes).toContain('step_complete');
    expect(eventTypes).toContain('execution_complete');
  });
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Plan generation only from "planning" skill | Plan generation from any skill's diagnosis | Phase 5 (now) | Enables DPEV loop for all diagnostic skills |
| Snapshot only for docker stop/rm, systemctl, files | Snapshot also for docker network commands | Phase 5 (now) | Captures before/after state for network changes |
| No E2E tests | E2E tests with Docker Compose scenarios | Phase 5 (now) | Proves full integration, regression safety |

## Open Questions

1. **Container naming with Docker Compose project prefix**
   - What we know: Docker Compose prefixes container names with project directory name (e.g., `demo-nginx-1`, `demo-backend-1`)
   - What's unclear: Exact prefix depends on `--project-name` flag or directory name
   - Recommendation: Use explicit `container_name:` in docker-compose.yml OR detect names via `docker compose ps --format json`

2. **LLM mock strategy for E2E test**
   - What we know: Mock provider should return predetermined diagnosis text and fix plan
   - What's unclear: Whether to mock at LLM provider level or at generateObject level
   - Recommendation: Mock at LLM provider level (`provider.generateCommand` returns canned diagnosis, `generateObject` mocked to return canned FixPlan) for maximum integration coverage

3. **Execute route sessionId coupling**
   - What we know: Execute route is created with a fixed sessionId/sessionDir at server startup (see server.ts lines 67-74)
   - What's unclear: Whether the debug route's returned sessionId matches the execute route's expected sessionId
   - Recommendation: The E2E test should create a fresh server instance with matching sessionId, or the execute route should accept sessionId from the request body (it already does per the POST body validation)

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.0.18 |
| Config file | vitest.config.ts |
| Quick run command | `npx vitest run tests/e2e/poc-nginx-502.test.ts` |
| Full suite command | `npx vitest run` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| POC-01 | Docker Compose starts with broken Nginx returning 502 | e2e | `npx vitest run tests/e2e/poc-nginx-502.test.ts -t "broken environment"` | No -- Wave 0 |
| POC-02 | Full DPEV loop: debug -> diagnose -> plan -> execute -> verify | e2e | `npx vitest run tests/e2e/poc-nginx-502.test.ts -t "fix plan"` | No -- Wave 0 |
| POC-03 | Audit trail contains decision reasoning and state diffs | e2e | `npx vitest run tests/e2e/poc-nginx-502.test.ts -t "audit trail"` | No -- Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run tests/e2e/poc-nginx-502.test.ts`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/e2e/poc-nginx-502.test.ts` -- covers POC-01, POC-02, POC-03
- [ ] `tests/e2e/` directory -- does not exist yet
- [ ] Docker must be running on the host machine for E2E tests

## Sources

### Primary (HIGH confidence)
- Project codebase -- all source files read directly: `src/api/routes/debug.ts`, `src/execution/executor.ts`, `src/orchestrator/router.ts`, `src/orchestrator/planner.ts`, `src/api/server.ts`, `src/skills/registry.ts`, `src/skills/types.ts`, `src/execution/snapshot.ts`, `src/audit/logger.ts`, `src/audit/types.ts`, `src/config/types.ts`
- Existing skill files -- `skills/planning.md`, `skills/log-analysis.md`, `skills/verification.md`
- Existing test patterns -- `tests/api/routes.test.ts` (supertest + vitest + mocked LLM)
- CONTEXT.md -- all user decisions verified against codebase capabilities

### Secondary (MEDIUM confidence)
- Docker Compose networking -- well-known Docker behavior (network isolation between named networks)
- httpbin container -- standard test API image, widely used

### Tertiary (LOW confidence)
- None -- all findings based on direct codebase analysis

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries already installed and tested in prior phases
- Architecture: HIGH -- all integration points verified by reading actual source code
- Pitfalls: HIGH -- identified by tracing actual code paths (debug route planning conditional, snapshot command map, server route mounting)

**Research date:** 2026-03-08
**Valid until:** 2026-04-08 (stable -- internal integration, no external API dependencies)
