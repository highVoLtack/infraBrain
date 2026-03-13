---
phase: 9
slug: postgres-failure-scenario
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-13
---

# Phase 9 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 1.x |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run --reporter=verbose tests/unit` |
| **Full suite command** | `npx vitest run --reporter=verbose` |
| **Estimated runtime** | ~30 seconds (unit), ~120 seconds (E2E with Docker) |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --reporter=verbose tests/unit`
- **After every plan wave:** Run `npx vitest run --reporter=verbose`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds (unit), 120 seconds (E2E)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 09-01-01 | 01 | 1 | SCEN-01 | integration | `docker compose -f demo/postgres/docker-compose.yml up -d && demo/postgres/reset-postgres.sh` | ❌ W0 | ⬜ pending |
| 09-01-02 | 01 | 1 | SCEN-03 | integration | `demo/postgres/reset-postgres.sh` | ❌ W0 | ⬜ pending |
| 09-02-01 | 02 | 1 | SCEN-02 | unit | `npx vitest run tests/skills/postgres-troubleshoot.test.ts` | ❌ W0 | ⬜ pending |
| 09-02-02 | 02 | 1 | SCEN-02 | unit | `npx vitest run tests/api/routes/debug-postgres.test.ts` | ❌ W0 | ⬜ pending |
| 09-03-01 | 03 | 2 | E2E-01 | e2e | `npx vitest run tests/e2e/poc-postgres-failover.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/e2e/poc-postgres-failover.test.ts` — E2E test stubs for SCEN-01, SCEN-02, SCEN-03, E2E-01
- [ ] `tests/skills/postgres-troubleshoot.test.ts` — skill loading/trigger matching tests
- [ ] `tests/api/routes/debug-postgres.test.ts` — debug route discovery commands for postgres

*Existing vitest infrastructure covers framework setup.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Docker Compose starts broken env | SCEN-01 | Requires Docker daemon | Run `cd demo/postgres && docker compose up -d`, verify leaky-app opens 18 connections |
| Reset script restores broken state | SCEN-03 | Requires Docker daemon | Run `demo/postgres/reset-postgres.sh`, verify "too many connections" error |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s (unit), < 120s (E2E)
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
