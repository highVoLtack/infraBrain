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

### Phase 12.3: Agnostic Skills + Engine-Proof Rewriter (INSERTED)

**Goal:** Complete the Agnostic Engine transition by making skills truly domain-generic: no hardcoded container names, no docker exec in prompts or examples. Skills describe WHAT to diagnose and fix using bare commands — the engine handles WHERE (container targeting) and HOW (privilege escalation, wrapping). The rewriter becomes docker-exec-aware to handle LLM outputs that still include docker exec as belt-and-suspenders.

**Plans:** 2/2 plans complete

Plans:
- [ ] 12.3-01-PLAN.md — Docker-exec-aware rewriter (TDD: parseDockerExec + dynamicRewrite fix)
- [ ] 12.3-02-PLAN.md — COMMAND-ONLY skill prompts + E2E regression verification

**Scope:**
1. Rewriter: Parse pre-wrapped `docker exec` commands, extract inner command, apply rewrite rules, reassemble with injected flags (-u 0)
2. Skill prompts: All 4 skills refactored to COMMAND-ONLY mode — no docker exec in system prompts, examples use bare commands with `{container}` placeholder only in discovery
3. Discovery: Replace hardcoded container names with dynamic `{target}` or remove them (discovery commands should use container names from runtime, not skill file)
4. All existing E2E tests must pass (canned fix plans may need updating)

**Success criteria:**
1. Skills contain zero hardcoded container names in prompts/examples
2. LLM outputs bare commands, engine wraps them correctly
3. `docker exec <container> chown ...` gets `-u 0` injected (belt-and-suspenders)
4. Discovery commands work with any container name (not just demo-specific ones)
5. Permission Trap live test passes end-to-end
6. All existing E2E scenarios still pass

**Dependencies:** Phase 12.2
**Requirements:** ENGN-05

### Phase 12.4: Agnostic Skill Redesign (INSERTED)

**Goal:** Replace scenario-specific scripted skills with universal expert skills. Merge `tools[]` + `rewrite_rules[]` + safety rules into a single `tools: { name: { risk, user, wrapper } }` map. Replace Diagnostic Ladders with Domain Knowledge sections. Remove all hardcoded container names. Make the LLM reason instead of follow scripts. The Permission Trap live test must pass end-to-end.

**Plans:** 3/3 plans complete

Plans:
- [x] 12.4-01-PLAN.md — ToolDeclarationSchema + toolsToRewriteRules() adapter + engine wiring -- completed 2026-03-14
- [ ] 12.4-02-PLAN.md — Universal expert skills (linux-expert, postgres-expert, network-expert)
- [ ] 12.4-03-PLAN.md — E2E test updates + full suite verification

**Scope:**
1. New `ToolDeclarationSchema` — `{ risk, user?, wrapper?, strip_flags?, container? }`
2. `toolsToRewriteRules()` adapter — converts tool map to rewrite rules
3. Auto-generated tool list injection into LLM system prompt
4. Consolidate 4 scenario skills into 2-3 universal experts: `linux-expert`, `postgres-expert`, `network-expert`
5. Domain Knowledge sections replace Diagnostic Ladders
6. Generic discovery — no hardcoded container names
7. Update allowlist.ts for new format
8. All E2E tests + Permission Trap live DPEV pass

**Success criteria:**
1. Skills have zero hardcoded container names
2. `tools:` map = single source for allowlist + rewrite + risk
3. LLM reasons from domain knowledge, not scripts
4. Permission Trap live test succeeds
5. All E2E tests pass
6. New scenario = only a `.md` file, zero TypeScript

**Dependencies:** Phase 12.3
**Requirements:** ENGN-06

### Phase 12.5: Intelligent Routing + Framework Merge (INSERTED)

**Goal:** Fix the broken skill routing (triggers not used, log-analysis catches everything) and merge the best patterns from Superpowers (composable skills, trigger-based routing, CSO) and GSD (context engineering, verification gates, atomic execution) into InfraBrain's engine. The Permission Trap live test must finally pass end-to-end.

**Plans:** 3/3 plans complete

Plans:
- [ ] 12.5-01-PLAN.md — Schema extension + registry enrichment + skill frontmatter updates
- [ ] 12.5-02-PLAN.md — Two-tier routing engine (pre-filter + enriched LLM) + DPEV enforcement
- [ ] 12.5-03-PLAN.md — Permission Trap scenario remix + dynamic E2E test

**Scope:**
1. **Trigger-based pre-filtering:** Before LLM routing, filter skills by trigger keyword match against user prompt. Only matched skills go to LLM for final selection.
2. **Routing prompt enrichment:** Include triggers + "When NOT to Use" in the routing prompt, not just name + description.
3. **log-analysis trigger narrowing:** Remove overly broad triggers ("error", "debug", "diagnose") that hijack other skills.
4. **Superpowers CSO (Claude Search Optimization):** Skill descriptions optimized for LLM discovery — "Use when..." format, symptom keywords, error messages.
5. **GSD context engineering:** Ensure discovery GROUND TRUTH flows correctly into LLM context, TOON-encoded for token efficiency.
6. **Priority-based tie-breaking:** When multiple skills match, use `priority` field. Domain experts (10) beat utility skills (0).
7. **Live Permission Trap test must pass:** linux-expert selected → discovery runs → LLM diagnoses → chown with -u 0 → fix applied.

**Success criteria:**
1. "permission error" prompt → `linux-expert` selected (not log-analysis)
2. Trigger pre-filter reduces candidate skills to 2-3 max
3. Discovery Ground Truth injected into LLM context
4. Permission Trap live DPEV: chown applied with root escalation, app recovers
5. All E2E tests pass
6. Routing is deterministic for clear prompts, LLM-assisted for ambiguous ones

**Dependencies:** Phase 12.4
**Requirements:** ENGN-07

### Phase 12.6: Self-Healing Executor (INSERTED)

**Goal:** Replace the band-aid regex command sanitizer with a self-healing execution loop. When a command fails, the executor captures stderr + exit code, feeds them back to the LLM with the original command, and lets the LLM generate a corrected command — like a human reading `--help`. Merges the best patterns from Superpowers (systematic-debugging 4-phase protocol, verification-before-completion evidence gates) and GSD (deviation auto-fix rules, checkpoint state, goal-backward verification) into InfraBrain's execution engine. This makes even weak local LLMs (7B) effective because the SYSTEM compensates for model limitations through error-driven self-correction.

**Plans:** TBD

**Scope:**
1. Self-healing retry loop in executor: on command failure → capture stderr/exit code → LLM generates corrected command → retry (max N attempts, budget-tracked)
2. Remove fixKnownCommandErrors() regex band-aid — self-healing replaces it
3. Error context injection: failed command + stderr + exit code formatted as structured prompt for correction LLM call
4. Correction budget: each self-heal attempt costs damage budget points (prevents infinite loops)
5. Correction history: track original → corrected command pairs for learning/audit
6. Verification gate: after self-healed command succeeds, verify actual effect (not just exit code 0)
7. Permission Trap live DPEV must pass end-to-end with self-healing (no regex patches)

**Success criteria:**
1. LLM generates wrong `chown` syntax → executor catches error → LLM corrects → fix applies successfully
2. fixKnownCommandErrors() removed — zero regex command patches remain
3. Self-healing works across all skill types (linux-expert, postgres-expert, network-expert)
4. Correction budget prevents runaway retry loops (max 3 self-heal attempts per step)
5. All correction attempts audited (original command, error, corrected command, outcome)
6. Permission Trap live test passes without any hardcoded command fixes
7. All existing E2E tests pass (538+)

**Dependencies:** Phase 12.5
**Requirements:** ENGN-08

## Progress

| Phase | Milestone | Plans | Status | Completed |
|-------|-----------|-------|--------|-----------|
| 1-7 | v1.0 | 22/22 | Complete | 2026-03-12 |
| 8-11 | v1.1 | 10/10 | Complete | 2026-03-13 |
| 12 | v1.2 | 3/3 | Complete | 2026-03-14 |
| 12.1 | v1.2 | 3/3 | Complete | 2026-03-14 |
| 12.2 | v1.2 | 2/2 | Complete | 2026-03-14 |
| 12.3 | v1.2 | 2/2 | Complete | 2026-03-14 |
| 12.4 | v1.2 | 3/3 | Complete | 2026-03-14 |
| 12.5 | v1.2 | 3/3 | Complete | 2026-03-14 |
| 12.6 | v1.2 | 0/0 | Planning | — |

---
*Roadmap created: 2026-03-07*
*Last updated: 2026-03-14 — Phase 12.6 added (Self-Healing Executor)*
