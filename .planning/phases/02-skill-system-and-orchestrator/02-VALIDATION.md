---
phase: 2
slug: skill-system-and-orchestrator
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-08
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.0.18 |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run --reporter=verbose` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --reporter=verbose`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 02-01-01 | 01 | 0 | CORE-03 | unit | `npx vitest run tests/skills/loader.test.ts -t "loads valid skill file"` | ❌ W0 | ⬜ pending |
| 02-01-02 | 01 | 0 | CORE-04 | unit | `npx vitest run tests/skills/loader.test.ts -t "rejects malformed"` | ❌ W0 | ⬜ pending |
| 02-01-03 | 01 | 0 | CORE-05 | unit | `npx vitest run tests/orchestrator/router.test.ts -t "selects skill"` | ❌ W0 | ⬜ pending |
| 02-01-04 | 01 | 0 | SKIL-01 | unit | `npx vitest run tests/orchestrator/planner.test.ts -t "generates fix plan"` | ❌ W0 | ⬜ pending |
| 02-01-05 | 01 | 0 | SKIL-02 | unit | `npx vitest run tests/skills/verification.test.ts -t "generates health check"` | ❌ W0 | ⬜ pending |
| 02-01-06 | 01 | 0 | SKIL-03 | unit | `npx vitest run tests/log-analysis/filter.test.ts -t "pre-filters"` | ❌ W0 | ⬜ pending |
| 02-01-07 | 01 | 0 | SKIL-04 | unit | `npx vitest run tests/log-analysis/parsers.test.ts -t "parses"` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/skills/loader.test.ts` — stubs for CORE-03, CORE-04 (skill loading and validation)
- [ ] `tests/orchestrator/router.test.ts` — stubs for CORE-05 (skill selection)
- [ ] `tests/orchestrator/planner.test.ts` — stubs for SKIL-01 (fix plan generation)
- [ ] `tests/skills/verification.test.ts` — stubs for SKIL-02 (health check generation)
- [ ] `tests/log-analysis/filter.test.ts` — stubs for SKIL-03 (log pre-filtering)
- [ ] `tests/log-analysis/parsers.test.ts` — stubs for SKIL-04 (format parsing)
- [ ] `tests/fixtures/skills/` — sample valid and malformed .md skill files
- [ ] `tests/fixtures/logs/` — sample log files in each of 4 formats

*Existing infrastructure covers test framework (vitest already configured).*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| LLM skill routing accuracy | CORE-05 | Requires live LLM inference with real prompts | Run `/infra:debug "502 error"` and verify correct skill selected |
| LLM fix plan quality | SKIL-01 | Plan content depends on LLM reasoning | Review generated plan for a known failure scenario |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
