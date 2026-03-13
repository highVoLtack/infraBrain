---
phase: 10
slug: docker-storage-failure-scenario
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-13
---

# Phase 10 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (existing) |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run tests/e2e/poc-docker-storage.test.ts` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run tests/e2e/poc-docker-storage.test.ts`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 10-01-01 | 01 | 1 | SCEN-04 | e2e | `npx vitest run tests/e2e/poc-docker-storage.test.ts -t "broken environment"` | ❌ W0 | ⬜ pending |
| 10-01-02 | 01 | 1 | SCEN-05 | e2e | `npx vitest run tests/e2e/poc-docker-storage.test.ts -t "diagnoses"` | ❌ W0 | ⬜ pending |
| 10-01-03 | 01 | 1 | SCEN-06 | e2e | `bash demo/docker-storage/reset-docker-storage.sh` | ❌ W0 | ⬜ pending |
| 10-01-04 | 01 | 1 | E2E-02 | e2e | `npx vitest run tests/e2e/poc-docker-storage.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `demo/docker-storage/docker-compose.yml` — scenario infrastructure
- [ ] `demo/docker-storage/logger/Dockerfile` + `entrypoint.sh` — bloat generator
- [ ] `demo/docker-storage/reset-docker-storage.sh` — idempotent reset
- [ ] `skills/docker-storage.md` — diagnostic skill
- [ ] `src/api/routes/debug.ts` — DISCOVERY_COMMANDS entry (modification)
- [ ] `tests/e2e/poc-docker-storage.test.ts` — full DPEV E2E test

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Causal Deduplication reasoning quality | SCEN-05 | LLM reasoning quality is subjective | Review mock response matches expected bloat classification pattern |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
