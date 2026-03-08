---
phase: 4
slug: session-management-and-cli-polish
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-08
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.x |
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
| 04-01-01 | 01 | 0 | INTF-04 | unit | `npx vitest run tests/cli/json-output.test.ts` | ❌ W0 | ⬜ pending |
| 04-01-02 | 01 | 0 | SAFE-11 | unit | `npx vitest run tests/state/history-query.test.ts` | ❌ W0 | ⬜ pending |
| 04-02-01 | 02 | 0 | INTF-02 | unit+int | `npx vitest run tests/api/status.test.ts tests/cli/status.test.ts` | ❌ W0 | ⬜ pending |
| 04-02-02 | 02 | 0 | INTF-03 | unit | `npx vitest run tests/cli/history.test.ts` | ❌ W0 | ⬜ pending |
| 04-03-01 | 03 | 0 | INTF-07 | unit | `npx vitest run tests/state/resume.test.ts tests/execution/resume.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/cli/json-output.test.ts` — stubs for INTF-04 (JSON envelope, chalk suppression)
- [ ] `tests/cli/status.test.ts` — stubs for INTF-02 (status dashboard formatting)
- [ ] `tests/cli/history.test.ts` — stubs for INTF-03 (history table formatting, --verbose)
- [ ] `tests/state/history-query.test.ts` — stubs for SAFE-11, INTF-03 (SQLite filter queries)
- [ ] `tests/state/resume.test.ts` — stubs for INTF-07 (incomplete session detection)
- [ ] `tests/execution/resume.test.ts` — stubs for INTF-07 (resume execution from step N)
- [ ] `tests/api/status.test.ts` — stubs for INTF-02 (status API route)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live Ollama health check in status | INTF-02 | Requires running Ollama instance | Run `/infra:status` and verify "connected" with response time |
| Resume auto-detect UX | INTF-07 | Requires interrupted session + new debug query | Start a fix, interrupt, re-run debug on same target, verify resume prompt |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
