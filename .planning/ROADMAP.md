# Roadmap: InfraBrain

## Overview

InfraBrain goes from zero to a working AI IT operations platform in five phases. We start by laying the foundation -- LLM abstraction, state persistence, CLI shell, and the critical safety gates that must exist before any command ever touches infrastructure. Then we build the skill system that gives the orchestrator its "brain," followed by the execution engine with full safety net (circuit breakers, damage budgets, rollback). Session management and CLI polish come next, and finally the Docker/Nginx 502 POC proves the entire Diagnose-Plan-Execute-Verify loop end-to-end.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Foundation and Safety Gates** - LLM provider, state storage, CLI shell, HITL approval, command validation, and audit logging (completed 2026-03-07)
- [x] **Phase 2: Skill System and Orchestrator** - Markdown skill loader, skill validation, orchestrator reasoning, and core skill library (completed 2026-03-08)
- [x] **Phase 3: Execution Engine and Safety Net** - Sub-agent isolation, circuit breaker, damage budget, rollback, and concurrency locks (completed 2026-03-08)
- [x] **Phase 4: Session Management and CLI Polish** - Status/history commands, JSON output, session resumability, TOON encoder, and queryable audit (completed 2026-03-08)
- [x] **Phase 5: POC Scenario and Integration** - Docker/Nginx 502 end-to-end demo proving the full DPEV loop (completed 2026-03-08)
- [x] **Phase 6: Resume Wiring and Audit Completeness** - Gap closure: wire resume persistence, lock audit events, real resume runner (audit-identified) (completed 2026-03-12)
- [ ] **Phase 7: Audit Metadata and Integration Polish** - Gap closure: SQLite audit metadata, log-analysis runtime wiring, rolling context injection (audit-identified)

## Phase Details

### Phase 1: Foundation and Safety Gates
**Goal**: Admin can connect to a local LLM, issue a CLI command, and see safety-gated command validation with full audit logging -- the platform skeleton that everything else builds on
**Depends on**: Nothing (first phase)
**Requirements**: CORE-01, CORE-02, CORE-09, CORE-10, SAFE-01, SAFE-02, SAFE-03, SAFE-09, SAFE-10, INTF-01, INTF-05, INTF-06
**Success Criteria** (what must be TRUE):
  1. Admin can start InfraBrain and it connects to a running Ollama instance, sends a prompt, and receives a response
  2. Admin can issue a CLI command (e.g., `/infra:debug "test"`) and see it accepted and routed through the system
  3. System classifies commands by risk level and applies correct approval gate (read auto-approves, write needs Y/N, destructive needs typed confirmation)
  4. System validates generated commands against allowlist/blocklist and rejects disallowed commands before they reach approval
  5. Every decision and state change is logged as structured JSON to both human-readable files and SQLite
**Plans**: 5 plans

Plans:
- [x] 01-01-PLAN.md — Project scaffolding, LLM provider abstraction, and token budget enforcement
- [x] 01-02-PLAN.md — State storage, session management, and structured audit logging
- [x] 01-03-PLAN.md — Command validation, risk classification, and approval gates
- [x] 01-04-PLAN.md — Express REST API, CLI REPL, and full application wiring
- [x] 01-05-PLAN.md — Gap closure: wire token budget enforcement and approval gate into execution path

### Phase 2: Skill System and Orchestrator
**Goal**: Orchestrator can load Markdown skill files, select the right skill for a problem, and produce a diagnostic assessment with a structured fix plan
**Depends on**: Phase 1
**Requirements**: CORE-03, CORE-04, CORE-05, SKIL-01, SKIL-02, SKIL-03, SKIL-04
**Success Criteria** (what must be TRUE):
  1. System loads Markdown skill files from a skills directory and validates them against the format spec (rejects malformed files with clear errors)
  2. Orchestrator selects an appropriate skill based on user input and injects skill context into the LLM prompt
  3. Planning skill decomposes a problem into a structured fix plan with discrete steps
  4. Verification skill generates health checks that can determine pass/fail for a given fix
  5. Log analysis skill pre-filters logs before LLM analysis and handles syslog, JSON, Docker, and journald formats
**Plans**: 3 plans

Plans:
- [x] 02-01-PLAN.md — Skill types, loader, validator, registry, allowlist, and core skill files
- [x] 02-02-PLAN.md — Log analysis parsers, format detector, and pre-filter with token budget truncation
- [x] 02-03-PLAN.md — Orchestrator router, context builder, fix plan generator, and CLI/API wiring

### Phase 3: Execution Engine and Safety Net
**Goal**: System can execute fix plan steps through isolated sub-agents with circuit breaker, damage budget, automatic rollback, and concurrency protection
**Depends on**: Phase 2
**Requirements**: CORE-06, CORE-07, CORE-08, SAFE-04, SAFE-05, SAFE-06, SAFE-07, SAFE-08, SAFE-12, INTF-08, INTF-09, INTF-10
**Success Criteria** (what must be TRUE):
  1. Each sub-agent task runs in a separate child process with its own LLM context -- no shared state between sub-agents
  2. Circuit breaker halts execution after configured max retries and alerts the admin
  3. Damage budget tracks cumulative state changes per fix plan and halts when budget is exceeded (with failed retries consuming double)
  4. System captures pre-execution state snapshots and automatically rolls back to last-known-good state when safety limits trigger
  5. Lock system prevents concurrent fixes on the same target, shows lock status to other admins, and supports force-override
**Plans**: 3 plans

Plans:
- [x] 03-01-PLAN.md — Execution types, config extensions, command runner, circuit breaker, and damage budget
- [x] 03-02-PLAN.md — Target locking system with conflict detection, stale locks, and force-override
- [x] 03-03-PLAN.md — Snapshot capture, rollback, rolling context, executor loop, and API/CLI wiring

### Phase 4: Session Management and CLI Polish
**Goal**: Admin has full operational visibility -- status checks, audit history, session resumability, and machine-parseable output for scripting
**Depends on**: Phase 3
**Requirements**: INTF-02, INTF-03, INTF-04, INTF-07, SAFE-11
**Success Criteria** (what must be TRUE):
  1. Admin can check system and session status via `/infra:status` and see current fix plans, locks, and agent state
  2. Admin can view audit history via `/infra:history` with queryable filters over the SQLite audit log
  3. All CLI commands support `--json` flag for machine-parseable output suitable for scripting
  4. Admin can resume an interrupted fix plan from where it left off without re-running completed steps
**Plans**: 4 plans

Plans:
- [x] 04-01-PLAN.md — JSON envelope, global --json option, status API route, and /infra:status command
- [x] 04-02-PLAN.md — Audit query methods, history API route, and /infra:history command with filters
- [x] 04-03-PLAN.md — Session resume types, executor startFromStep, /infra:resume command, and debug auto-detect
- [x] 04-04-PLAN.md — TOON encoder for LLM context optimization

### Phase 5: POC Scenario and Integration
**Goal**: The Docker/Nginx 502 demo proves the entire Diagnose-Plan-Execute-Verify loop end-to-end with full audit trail -- the investor/customer proof point
**Depends on**: Phase 4
**Requirements**: POC-01, POC-02, POC-03
**Success Criteria** (what must be TRUE):
  1. Docker Compose test environment starts with intentionally broken Nginx that returns 502 errors
  2. Admin triggers `/infra:debug "Why is Nginx returning 502?"` and the system diagnoses the root cause, generates a fix plan, executes (with approval), and verifies the fix via health check -- all without manual intervention beyond approval
  3. Full audit trail is available showing decision reasoning, options considered, commands executed, and before/after state diffs for every change
**Plans**: 2 plans

Plans:
- [x] 05-01-PLAN.md — Docker demo environment, Nginx troubleshoot skill, debug route fix plan generation, and snapshot extensions
- [x] 05-02-PLAN.md — E2E integration test proving full DPEV loop with audit trail verification

### Phase 6: Resume Wiring and Audit Completeness
**Goal**: Close all integration gaps found by v1.0 milestone audit — resume flow works end-to-end from real execution halts, lock operations are audited, and dead code is cleaned up
**Depends on**: Phase 5
**Requirements**: INTF-07 (resume wiring), SAFE-09 (lock audit events)
**Gap Closure**: Closes 2 integration gaps + 1 broken flow from v1.0-MILESTONE-AUDIT.md
**Success Criteria** (what must be TRUE):
  1. When executor halts (circuit breaker or damage budget), `updateSessionForResume` is called and `resumeMetadata` is persisted to disk and SQLite
  2. `/infra:resume <session-id>` finds and loads interrupted sessions from real execution halts (not just mocked data)
  3. Resume route executes commands via real `runCommand` (not a no-op stub)
  4. Lock acquire/release operations emit `lock_acquired` and `lock_released` audit events
  5. `formatResumeSummary` is called in the CLI resume command (no dead imports)
**Plans**: 2 plans

Plans:
- [x] 06-01-PLAN.md — Lock audit events: emit lock_acquired, lock_released, lock_conflict, lock_override in executor
- [x] 06-02-PLAN.md — Resume wiring: halt persistence in execute route, real runner in resume route, formatResumeSummary in CLI

### Phase 7: Audit Metadata and Integration Polish
**Goal**: Close remaining integration quality gaps from v1.0 re-audit — audit history shows full execution event details, log-analysis parsers activate at runtime, and rolling context feeds into multi-step executor LLM calls
**Depends on**: Phase 6
**Requirements**: SAFE-11 (audit metadata), INTF-03 (history display), SKIL-03 (log pre-filter runtime), SKIL-04 (log format runtime), CORE-07 (rolling context injection)
**Gap Closure**: Closes 3 integration gaps from v1.0-MILESTONE-AUDIT.md (re-audit)
**Success Criteria** (what must be TRUE):
  1. `audit_log` SQLite table has a `metadata` column and `appendAudit` persists `JSON.stringify(entry.metadata)` — execution events show meaningful summaries in `/infra:history`
  2. Debug route detects log-heavy prompts and passes them through `preFilterLogs` before sending to the LLM, reducing token usage
  3. `executePlan` injects `rollingContext.getContext()` into sub-agent LLM calls so multi-step plans have awareness of prior step results
**Plans**: 0 plans (pending)

Plans:
(none yet — run `/gsd:plan-phase 7`)

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation and Safety Gates | 5/5 | Complete   | 2026-03-07 |
| 2. Skill System and Orchestrator | 3/3 | Complete   | 2026-03-08 |
| 3. Execution Engine and Safety Net | 3/3 | Complete   | 2026-03-08 |
| 4. Session Management and CLI Polish | 4/4 | Complete | 2026-03-08 |
| 5. POC Scenario and Integration | 2/2 | Complete   | 2026-03-08 |
| 6. Resume Wiring and Audit Completeness | 2/2 | Complete | 2026-03-12 |
| 7. Audit Metadata and Integration Polish | 0/? | Pending | - |

---
*Roadmap created: 2026-03-07*
*Last updated: 2026-03-12 — Phase 7 added for audit re-audit gap closure*
