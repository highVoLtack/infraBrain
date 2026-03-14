---
phase: 12
slug: linux-filesystem-permission-trap
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-14
---

# Phase 12 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (existing) |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run tests/e2e/poc-permission-trap.test.ts` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~30 seconds (E2E with Docker) |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run tests/e2e/poc-permission-trap.test.ts`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 12-01-01 | 01 | 1 | SCEN-07 | e2e | `npx vitest run tests/e2e/poc-permission-trap.test.ts -t "broken environment"` | ❌ W0 | ⬜ pending |
| 12-01-02 | 01 | 1 | SCEN-07 | e2e | `npx vitest run tests/e2e/poc-permission-trap.test.ts -t "diagnoses"` | ❌ W0 | ⬜ pending |
| 12-01-03 | 01 | 1 | SCEN-07 | e2e | `npx vitest run tests/e2e/poc-permission-trap.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `demo/permission-trap/docker-compose.yml` — scenario infrastructure
- [ ] `demo/permission-trap/app/Dockerfile` + `app.py` — victim app
- [ ] `demo/permission-trap/reset-permission-trap.sh` — idempotent reset
- [ ] `skills/linux-filesystem-troubleshoot.md` — diagnostic skill
- [ ] `src/api/routes/debug.ts` — DISCOVERY_COMMANDS entry (modification)
- [ ] `tests/e2e/poc-permission-trap.test.ts` — full DPEV E2E test
- [ ] `src/safety/rules.ts` — add chown, chmod as WRITE and id, stat as READ (modification)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Full live DPEV with real LLM | SCEN-07 | Requires running Ollama + model | Run `/infra:debug` against live permission-trap scenario |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
