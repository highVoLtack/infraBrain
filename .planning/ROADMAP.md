# Roadmap: InfraBrain

## Milestones

- ✅ **v1.0 MVP** — Phases 1-7 (shipped 2026-03-12) | [Archive](milestones/v1.0-ROADMAP.md)
- ✅ **v1.1 The Scenario Factory** — Phases 8-11 (shipped 2026-03-13) | [Archive](milestones/v1.1-ROADMAP.md)

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

**Total:** 7 phases, 22 plans, 39/39 requirements, 354 tests

</details>

<details>
<summary>✅ v1.1 The Scenario Factory (Phases 8-11) — SHIPPED 2026-03-13</summary>

- [x] Phase 8: Rolling Context Injection (2/2 plans) — completed 2026-03-13
- [x] Phase 9: Postgres Failure Scenario (3/3 plans + Engine-First hardening) — completed 2026-03-13
- [x] Phase 10: Docker Storage Failure Scenario (3/3 plans) — completed 2026-03-13
- [x] Phase 11: Cross-Scenario Validation and UX Polish (2/2 plans) — completed 2026-03-13

**Total:** 4 phases, 10 plans, 13/13 requirements, 440 tests, Engine-First architecture

</details>

## v1.2 The Knowledge Layer

### Phase 12: Linux Filesystem Permission Trap Scenario (INSERTED)

**Goal:** Prove that the Technical Lead (Qwen 32B) can handle raw Linux OS-level troubleshooting without any DB-specific logic — autonomous diagnosis and repair of filesystem permission issues in Docker containers.

**Plans:** 3/3 plans complete

Plans:
- [x] 12-01-PLAN.md — Docker permission trap demo environment (compose, app, reset script) -- completed 2026-03-14
- [x] 12-02-PLAN.md — Diagnostic skill, discovery commands, and safety rule updates -- completed 2026-03-14
- [ ] 12-03-PLAN.md — Full DPEV loop E2E test

**Scope:**
1. Scenario setup: `demo/permission-trap/` with Docker Compose — Python app writing to `/app/data/status.pid`, directory owned by root:root with 700 permissions, app runs as UID 1000 → crashes with Permission Denied
2. New skill: `linux-filesystem-troubleshoot.md` with diagnostic ladder (logs → permissions → user check → correlate owner mismatch → fix)
3. E2E validation: InfraBrain autonomously diagnoses and fixes the permission issue

**Success criteria:**
1. Docker scenario starts and reproduces Permission Denied crash
2. InfraBrain diagnoses root cause (owner mismatch) via DPEV loop
3. Fix applied (chown/chmod) and verified (app writes successfully)
4. No DB-specific logic used — pure OS-level troubleshooting

**Dependencies:** Phases 1-11 (Engine-First architecture, DPEV loop, sub-agent execution)
**Requirements:** SCEN-07

## Progress

| Phase | Milestone | Plans | Status | Completed |
|-------|-----------|-------|--------|-----------|
| 1-7 | v1.0 | 22/22 | Complete | 2026-03-12 |
| 8-11 | v1.1 | 10/10 | Complete | 2026-03-13 |
| 12 | 3/3 | Complete   | 2026-03-14 | — |

---
*Roadmap created: 2026-03-07*
*Last updated: 2026-03-14 — Plan 12-02 complete (diagnostic skill + safety rules)*
