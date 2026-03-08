# Phase 5: POC Scenario and Integration - Context

**Gathered:** 2026-03-08
**Status:** Ready for planning

<domain>
## Phase Boundary

Docker/Nginx 502 end-to-end demo proving the full Diagnose-Plan-Execute-Verify loop with full audit trail. Includes: Docker Compose broken environment, Nginx troubleshooting skill, integration wiring through the DPEV loop, and scripted E2E test. This is the investor/customer proof point.

Requirements: POC-01, POC-02, POC-03

</domain>

<decisions>
## Implementation Decisions

### Demo Environment Setup
- Docker Compose with Nginx (frontend network) proxying to httpbin (backend network) — wrong network causes 502
- httpbin as backend target — predictable API allows the Scenario Factory to simulate diverse failures via Nginx config changes alone
- One-command `demo/reset.sh` designed as a modular "Scenario Factory" — tears down, recreates broken environment, extensible for future failure scenarios
- Backend on separate Docker network (`backend`) while Nginx is on `frontend` — forces cross-layer diagnosis (Nginx logs + Docker network metadata)

### Nginx Diagnostic Skill
- Single `skills/nginx-troubleshoot.md` skill covering full loop (diagnosis + fix) — "Environment-Aware Expertise" with Docker tool access
- Skill prompt enforces a "Diagnostic Ladder" (ordered investigation sequence): 1) HTTP response check, 2) Nginx error log analysis, 3) Docker network inspection, 4) Cross-layer correlation
- Skill acts as a state machine internally: gather evidence first, then propose plan, then execute after approval — prevents hasty actions
- Docker commands included in the Nginx skill's tool allowlist (docker, curl, nginx, cat, grep, ss) — avoids skill-chaining complexity in v1
- TOON encoding compresses diagnostic evidence at each ladder rung, maximizing context density for the cross-correlation step

### Fix Strategy
- Surgical live remediation via `docker network connect frontend backend` — single-command fix, no container restart
- Demonstrates immediate MTTR reduction and exercises the "single command per step" architecture
- Rollback: `docker network disconnect frontend backend`
- Verification: `curl http://localhost:8080/get` expecting HTTP 200
- Declarative config-file synchronization deferred to future "Config-Drift" skill

### Demo Flow (CLI UX)
- Entry point: `/infra:debug "Why is Nginx returning 502?"` — natural language triggers LLM-based skill routing
- Progressive disclosure output: each DPEV phase shown clearly with key findings, full verbose data streamed to SQLite in background
- Post-fix summary shows: verification status, budget used, session ID, and hint to run `/infra:history --session <id>`
- "Executive Summary" in CLI, "Full Verbose" in audit log — clean for humans, 100% auditable for machines

### Audit Trail Presentation
- `/infra:history --session <id> --verbose` shows complete trail: every diagnostic step, command, approval, state diffs
- LLM reasoning stored in audit log — "Reasoning Audits" enable senior engineers to review AI decision-making and fine-tune skills
- State diffs prove "Command output capture" strategy — shows exactly how infrastructure was transformed (before/after Docker network state)
- Audit log as "Black Box of IT-Ops, made transparent" — the forensic record

### E2E Integration Test
- Scripted E2E test (`tests/e2e/poc-nginx-502.test.ts`) validates the full DPEV loop programmatically
- Test sequence: start broken env → POST /debug → verify diagnosis → check fix plan → POST /execute (autoApprove: true for test mode) → verify HTTP 200 → check audit trail completeness
- "Test-Driven Infrastructure Repair" — serves as primary benchmark for evaluating new LLMs and skills
- Built on the Scenario Factory pattern — extensible for future failure scenarios

### Secret Sauce Integration
- TOON encoder compresses Docker inspect and Nginx config data before sending to the 70B model — reduces tokens, maximizes reasoning context
- Failure scenario requires cross-tool correlation (Nginx error logs + Docker network metadata) — proves the system "thinks across stack layers"
- Diagnostic Ladder is the "Reasoning Protocol" — transforms LLM from chatbot to systematic engineer

### Claude's Discretion
- Exact Nginx error log patterns to match for 502 diagnosis
- httpbin endpoint selection for verification (/get vs /status/200)
- Docker Compose version and image tags
- E2E test timeout values and retry strategy
- Exact TOON encoding thresholds for diagnostic evidence

</decisions>

<specifics>
## Specific Ideas

- The Diagnostic Ladder is the core differentiator — it shows systematic engineering, not guessing
- Progressive disclosure: "Executive Summary" for CLI, "Full Verbose" in SQLite — two audiences, one system
- Scenario Factory (reset.sh) should be modular enough to inject different failure states for future integration testing
- Audit trail as "Black Box of IT-Ops, made transparent" — investor pitch line
- LLM reasoning in audit enables "Reasoning Audits" — transforms audit log into continuous learning dataset
- Post-fix summary naturally leads to audit trail demo (hint: /infra:history --session <id>)
- Future deferred idea: `/infra:report <session-id>` generates professional post-mortem report (PDF/Markdown)

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/orchestrator/router.ts`: Skill selection via `selectSkill()` + `generateObject` — entry point for natural language routing
- `src/orchestrator/planner.ts`: Fix plan generation with Zod schemas — produces FixPlan consumed by executor
- `src/execution/executor.ts`: Full safety pipeline (lock → budget → snapshot → approval → execute → rollback) — the engine
- `src/cli/commands.ts`: All CLI commands wired (`/infra:debug`, `/infra:status`, `/infra:history`, `/infra:resume`)
- `src/api/routes/debug.ts`: POST /debug route — orchestrator diagnosis + plan generation
- `src/api/routes/execute.ts`: POST /execute route — executor with circuit breaker and damage budget
- `src/api/routes/history.ts`: GET /history with filter query params — audit trail query
- `src/cli/formatter.ts`: `formatHistoryTable` with compact/verbose modes — audit display
- `src/llm/toon-encoder.ts`: `encodeToon`, `encodeForLLM`, `measureSavings` — context compression
- `src/execution/snapshot.ts`: Pre-execution state capture — before/after diffs
- `skills/planning.md`, `skills/verification.md`, `skills/log-analysis.md` — existing skill library

### Established Patterns
- File-first dual storage (file = source of truth, SQLite = queryable index)
- Factory pattern for routes with injectable dependencies
- Risk-based approval: auto for READ, Y/n for WRITE, typed confirmation for DESTRUCTIVE
- Diagnostic Ladder aligns with existing orchestrator phases (diagnose → plan → execute → verify)
- TOON encoding already wired into orchestrator context and execution context builder

### Integration Points
- `src/api/routes/debug.ts`: Wire diagnosis → plan generation → executor in a single request flow
- `src/orchestrator/context.ts`: Inject Nginx skill context with TOON-encoded diagnostic evidence
- `src/execution/executor.ts`: `autoApprove` mode needed for E2E test (bypass readline approval)
- `src/api/server.ts`: All routes already mounted — may need minor wiring adjustments
- `skills/` directory: Add `nginx-troubleshoot.md` alongside existing skills
- `demo/` directory: New — Docker Compose files, reset script, Nginx config

</code_context>

<deferred>
## Deferred Ideas

- `/infra:report <session-id>` — automated post-mortem report generation (PDF/Markdown) for management
- Config-Drift skill — declarative config-file synchronization as alternative fix approach
- Multi-fault scenarios — multiple simultaneous issues requiring compound fixes
- Scenario Factory expansion — programmatic failure injection for comprehensive integration testing
- Separate `docker-infra` skill for non-Nginx Docker issues

</deferred>

---

*Phase: 05-poc-scenario-and-integration*
*Context gathered: 2026-03-08*
