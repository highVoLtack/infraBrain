---
phase: 17
slug: mempalace-semantic-memory
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-11
---

# Phase 17 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (via `vitest run`) |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run tests/memory/ --reporter=verbose` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run tests/memory/ --reporter=verbose`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 17-01-T1 | 01 | 1 | MEM-08, MEM-09 | unit | `npx vitest run tests/memory/wal.test.ts --reporter=verbose` | ❌ W0 | ⬜ pending |
| 17-02-T1 | 02 | 2 | MEM-01, MEM-03, MEM-08 | unit | `npx vitest run tests/memory/incident-store.test.ts tests/memory/entity-store.test.ts --reporter=verbose` | ❌ W0 | ⬜ pending |
| 17-02-T2 | 02 | 2 | MEM-06, MEM-07 | unit | `npx vitest run tests/memory/entity-extractor.test.ts tests/memory/memory-scoring.test.ts --reporter=verbose` | ❌ W0 | ⬜ pending |
| 17-03-T1 | 03 | 3 | MEM-02, MEM-04 | unit | `npx vitest run tests/memory/memory-search.test.ts tests/memory/wake-up.test.ts --reporter=verbose` | ❌ W0 | ⬜ pending |
| 17-03-T2 | 03 | 3 | MEM-02, MEM-04 | unit | `npx vitest run tests/orchestrator/ tests/context/ --reporter=verbose` | ✅ | ⬜ pending |
| 17-04-T1 | 04 | 4 | MEM-05 | unit | `npx vitest run tests/memory/intent-classifier.test.ts tests/memory/memory-skill.test.ts --reporter=verbose` | ❌ W0 | ⬜ pending |
| 17-04-T2 | 04 | 4 | MEM-01, MEM-05 | unit | `npx vitest run tests/api/ tests/memory/ --reporter=verbose` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/memory/incident-store.test.ts` — stubs for MEM-01, MEM-08
- [ ] `tests/memory/entity-store.test.ts` — stubs for MEM-03, MEM-06
- [ ] `tests/memory/entity-extractor.test.ts` — stubs for MEM-06
- [ ] `tests/memory/memory-search.test.ts` — stubs for MEM-02, MEM-07
- [ ] `tests/memory/wake-up.test.ts` — stubs for MEM-04
- [ ] `tests/memory/intent-classifier.test.ts` — stubs for MEM-05
- [ ] `tests/memory/wal.test.ts` — stubs for MEM-09

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| L0 identity text quality | MEM-04 | LLM-generated text needs human judgment | Inspect L0 output in dev logging after 3+ incidents stored |
| Memory skill German queries | MEM-05 | Natural language understanding varies | Ask "Hatten wir das schon mal?" and verify relevant results |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
