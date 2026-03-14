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
- [x] 12-03-PLAN.md — Full DPEV loop E2E test -- completed 2026-03-14

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

### Phase 12.1: Dynamic Command Rewriter (INSERTED)

**Goal:** Replace the hardcoded SQL Rewriter with a universal, skill-driven command rewriting engine. Each skill declares rewrite rules (container targeting, privilege escalation, command wrapping) in its frontmatter — the engine applies them dynamically. No new TypeScript code needed per scenario.

**Plans:** 3/3 plans complete

Plans:
- [x] 12.1-01-PLAN.md — Dynamic rewriter pure function + Zod schema + TDD unit tests
- [x] 12.1-02-PLAN.md — Skill frontmatter schema extension + rewrite_rules migration for 3 skills
- [x] 12.1-03-PLAN.md — Wire dynamic rewriter into debug.ts, deprecate old rewriter, full suite green

**Scope:**
1. New `src/execution/dynamic-rewriter.ts` — reads rewrite rules from skill metadata, applies container wrapping + privilege escalation + command wrapping
2. Migrate existing SQL Rewriter logic into postgres-troubleshoot.md `rewrite_rules` frontmatter
3. Add `rewrite_rules` to linux-filesystem-troubleshoot.md (container auto-detect, `-u 0` for chown/chmod)
4. Add `rewrite_rules` to docker-storage.md
5. Update runner.ts to call dynamic rewriter instead of hardcoded `rewriteForContainer()`
6. All existing E2E tests must pass (backwards-compatible)
7. Re-test Permission Trap with dynamic rewriter (live DPEV)

**Success criteria:**
1. Skills declare rewrite rules in frontmatter — engine applies them without scenario-specific code
2. All 3 existing scenarios (Nginx, Postgres, Docker Storage, Permission Trap) work with dynamic rewriter
3. `rewriteForContainer()` and `stripHostFlag()` removed or deprecated — logic lives in skill metadata
4. Adding a new scenario requires zero TypeScript changes to the rewriter

**Dependencies:** Phase 12 (Permission Trap proved the need)
**Requirements:** ENGN-03

### Phase 12.2: Skill-Driven Discovery (INSERTED)

**Goal:** Eliminate the hardcoded `DISCOVERY_COMMANDS` constant from debug.ts. Each skill declares its own discovery commands in frontmatter — the orchestrator reads them dynamically. Skills without discovery simply skip the discovery phase. This completes the Agnostic Engine transition: 100% of domain knowledge lives in Markdown skill files.

**Plans:** 2/2 plans complete

Plans:
- [ ] 12.2-01-PLAN.md — Discovery schema + skill YAML migration (DiscoveryCommandSchema, 4 skills)
- [ ] 12.2-02-PLAN.md — Orchestrator refactor + DISCOVERY_COMMANDS removal

**Scope:**
1. Add `discovery` field to `SkillFrontmatterSchema` — array of `{ command: string, label: string }`
2. Refactor `runDiscovery` in debug.ts to read from `skill.frontmatter.discovery` instead of `DISCOVERY_COMMANDS`
3. Migrate all 4 skills (nginx, postgres, docker-storage, linux-filesystem) — move discovery commands from debug.ts into skill YAML
4. Remove `DISCOVERY_COMMANDS` constant entirely from debug.ts
5. If a skill has no `discovery` section, orchestrator skips discovery (graceful fallback)
6. All existing E2E tests must pass

**Success criteria:**
1. `DISCOVERY_COMMANDS` constant removed from debug.ts
2. All 4 skills declare discovery commands in frontmatter
3. Skills without discovery gracefully skip (no error)
4. debug.ts loses ~100 lines of hardcoded domain knowledge
5. Adding a new scenario requires zero TypeScript changes for discovery

**Dependencies:** Phase 12.1 (Dynamic Rewriter pattern established)
**Requirements:** ENGN-04

## Progress

| Phase | Milestone | Plans | Status | Completed |
|-------|-----------|-------|--------|-----------|
| 1-7 | v1.0 | 22/22 | Complete | 2026-03-12 |
| 8-11 | v1.1 | 10/10 | Complete | 2026-03-13 |
| 12 | v1.2 | 3/3 | Complete | 2026-03-14 |
| 12.1 | v1.2 | 3/3 | Complete | 2026-03-14 |
| 12.2 | 2/2 | Complete    | 2026-03-14 | — |

---
*Roadmap created: 2026-03-07*
*Last updated: 2026-03-14 — Phase 12.2 planned (Skill-Driven Discovery)*
