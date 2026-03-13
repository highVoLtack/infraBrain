# Roadmap: InfraBrain

## Milestones

- ✅ **v1.0 MVP** — Phases 1-7 (shipped 2026-03-12) | [Archive](milestones/v1.0-ROADMAP.md)
- 🚧 **v1.1 The Scenario Factory** — Phases 8-11 (in progress)

## Phases

<details>
<summary>✅ v1.0 MVP (Phases 1-7) — SHIPPED 2026-03-12</summary>

- [x] Phase 1: Foundation and Safety Gates (5/5 plans) — completed 2026-03-07
- [x] Phase 2: Skill System and Orchestrator (3/3 plans) — completed 2026-03-08
- [x] Phase 3: Execution Engine and Safety Net (3/3 plans) — completed 2026-03-08
- [x] Phase 4: Session Management and CLI Polish (4/4 plans) — completed 2026-03-08
- [x] Phase 5: POC Scenario and Integration (2/2 plans) — completed 2026-03-08
- [x] Phase 6: Resume Wiring and Audit Completeness (2/2 plans) — completed 2026-03-12
- [x] Phase 7: Audit Metadata and Integration Polish (3/3 plans) — completed 2026-03-12

**Total:** 7 phases, 22 plans, 39/39 requirements, 354 tests, 10,770 LOC

</details>

### 🚧 v1.1 The Scenario Factory (In Progress)

**Milestone Goal:** Prove the scalability of the v1.0 DPEV engine by expanding the skill library with complex, real-world failure scenarios and automated E2E validation — a "Chaos Library" that demonstrates autonomous diagnosis and repair.

- [x] **Phase 8: Rolling Context Injection** - Sub-agent LLM calls receive prior step results for multi-step plan awareness (completed 2026-03-13)
- [ ] **Phase 9: Postgres Failure Scenario** - Complete vertical slice: Docker Compose env, diagnostic skill, reset script, E2E test
- [ ] **Phase 10: Docker Storage Failure Scenario** - Complete vertical slice: Docker Compose env, storage skill, reset script, E2E test
- [ ] **Phase 11: Cross-Scenario Validation and UX Polish** - Audit trail completeness across both scenarios, history command improvements

## Phase Details

### Phase 8: Rolling Context Injection
**Goal**: Multi-step fix plans maintain awareness of prior step results during sub-agent execution
**Depends on**: Phase 7 (v1.0 complete — rolling context exposed on ExecutionResult but not injected)
**Requirements**: ENGN-01, ENGN-02
**Success Criteria** (what must be TRUE):
  1. When executePlan runs step 3 of a fix plan, the sub-agent LLM call includes a summary of what steps 1 and 2 produced
  2. Resume route passes accumulated rolling context to the LLM provider so resumed sessions do not lose prior step awareness
  3. A unit test confirms that rollingContext.getContext() output appears in the LLM prompt for steps after step 1
**Plans:** 2/2 plans complete
Plans:
- [x] 08-01-PLAN.md — Add onBeforeStep callback to executor for rolling context injection
- [x] 08-02-PLAN.md — Wire rolling context into execute and resume routes

### Phase 9: Postgres Failure Scenario
**Goal**: Users can demonstrate autonomous Postgres connection-limit diagnosis and recovery through a complete DPEV loop
**Depends on**: Phase 8 (rolling context needed for multi-step Postgres fix plans)
**Requirements**: SCEN-01, SCEN-02, SCEN-03, E2E-01
**Success Criteria** (what must be TRUE):
  1. Running `docker compose up` in the Postgres demo directory starts an environment where Postgres has hit max_connections from a connection-leaking app
  2. The `postgres-troubleshoot.md` skill queries pg_stat_activity, identifies idle/leaked connections, and produces a fix plan that terminates and recovers connections
  3. Running `demo/postgres/reset-postgres.sh` idempotently restores the broken state so the scenario can be re-run
  4. An automated E2E test proves the full DPEV loop: diagnose identifies the connection leak, plan proposes termination, execute runs it, verify confirms recovery
**Plans:** 2/3 plans executed
Plans:
- [ ] 09-01-PLAN.md — Demo directory restructure + Postgres Docker environment and reset script
- [ ] 09-02-PLAN.md — Postgres diagnostic skill and discovery commands
- [ ] 09-03-PLAN.md — E2E test proving full DPEV loop for Postgres scenario

### Phase 10: Docker Storage Failure Scenario
**Goal**: Users can demonstrate autonomous Docker volume-full diagnosis and recovery through a complete DPEV loop
**Depends on**: Phase 8 (rolling context needed for multi-step storage fix plans)
**Requirements**: SCEN-04, SCEN-05, SCEN-06, E2E-02
**Success Criteria** (what must be TRUE):
  1. Running `docker compose up` in the Docker storage demo directory starts an environment where a container volume is 100% full and the container is crashing
  2. The `docker-storage.md` skill diagnoses via `df -h` and `docker system df`, and produces a fix plan to prune or truncate
  3. Running `demo/docker-storage/reset-docker-storage.sh` idempotently restores the broken state so the scenario can be re-run
  4. An automated E2E test proves the full DPEV loop: diagnose identifies the full volume, plan proposes cleanup, execute runs it, verify confirms recovery
**Plans:** 2/3 plans executed
Plans:
- [x] 10-01-PLAN.md — Docker Compose environment with shared tmpfs volume and idempotent reset script
- [x] 10-02-PLAN.md — docker-storage diagnostic skill and discovery commands
- [ ] 10-03-PLAN.md — E2E test proving full DPEV loop for Docker storage scenario

### Phase 11: Cross-Scenario Validation and UX Polish
**Goal**: Both scenarios have verified audit trail completeness and the history command gets usability improvements
**Depends on**: Phase 9, Phase 10 (both scenarios must exist before cross-scenario validation)
**Requirements**: E2E-03, UX-01, UX-02
**Success Criteria** (what must be TRUE):
  1. Both E2E tests verify that audit trail contains skill_selection, decision, and execution events for every DPEV step
  2. Running `/infra:history` with no `--session` flag defaults to displaying the most recent session
  3. Running `/infra:history --session last` resolves to the latest session_id from SQLite and displays that session
**Plans**: TBD

## Progress

**Execution Order:** Phases execute in numeric order: 8 → 9 → 10 → 11

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Foundation and Safety Gates | v1.0 | 5/5 | Complete | 2026-03-07 |
| 2. Skill System and Orchestrator | v1.0 | 3/3 | Complete | 2026-03-08 |
| 3. Execution Engine and Safety Net | v1.0 | 3/3 | Complete | 2026-03-08 |
| 4. Session Management and CLI Polish | v1.0 | 4/4 | Complete | 2026-03-08 |
| 5. POC Scenario and Integration | v1.0 | 2/2 | Complete | 2026-03-08 |
| 6. Resume Wiring and Audit Completeness | v1.0 | 2/2 | Complete | 2026-03-12 |
| 7. Audit Metadata and Integration Polish | v1.0 | 3/3 | Complete | 2026-03-12 |
| 8. Rolling Context Injection | v1.1 | 2/2 | Complete | 2026-03-13 |
| 9. Postgres Failure Scenario | v1.1 | 2/3 | In Progress | - |
| 10. Docker Storage Failure Scenario | v1.1 | 2/3 | In Progress | - |
| 11. Cross-Scenario Validation and UX Polish | v1.1 | 0/? | Not started | - |

---
*Roadmap created: 2026-03-07*
*Last updated: 2026-03-13 — Phase 10 plan 01 complete (2/3 plans done)*
