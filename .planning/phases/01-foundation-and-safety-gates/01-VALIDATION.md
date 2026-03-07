---
phase: 1
slug: foundation-and-safety-gates
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-07
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest ^3.0.0 |
| **Config file** | `vitest.config.ts` — Wave 0 installs |
| **Quick run command** | `npx vitest run --reporter=verbose` |
| **Full suite command** | `npx vitest run --coverage` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --reporter=verbose`
- **After every plan wave:** Run `npx vitest run --coverage`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 01-01-01 | 01 | 1 | CORE-01 | integration | `npx vitest run tests/llm/provider.test.ts -t "provider"` | ❌ W0 | ⬜ pending |
| 01-01-02 | 01 | 1 | CORE-02 | unit | `npx vitest run tests/llm/provider.test.ts -t "pluggable"` | ❌ W0 | ⬜ pending |
| 01-01-03 | 01 | 1 | CORE-09 | unit | `npx vitest run tests/llm/token-budget.test.ts` | ❌ W0 | ⬜ pending |
| 01-02-01 | 02 | 1 | CORE-10 | unit | `npx vitest run tests/safety/validator.test.ts` | ❌ W0 | ⬜ pending |
| 01-02-02 | 02 | 1 | SAFE-01 | unit | `npx vitest run tests/safety/approval.test.ts -t "read"` | ❌ W0 | ⬜ pending |
| 01-02-03 | 02 | 1 | SAFE-02 | unit | `npx vitest run tests/safety/approval.test.ts -t "write"` | ❌ W0 | ⬜ pending |
| 01-02-04 | 02 | 1 | SAFE-03 | unit | `npx vitest run tests/safety/approval.test.ts -t "destructive"` | ❌ W0 | ⬜ pending |
| 01-03-01 | 03 | 2 | SAFE-09 | unit | `npx vitest run tests/audit/logger.test.ts` | ❌ W0 | ⬜ pending |
| 01-03-02 | 03 | 2 | SAFE-10 | unit | `npx vitest run tests/audit/logger.test.ts -t "diff"` | ❌ W0 | ⬜ pending |
| 01-03-03 | 03 | 2 | INTF-01 | integration | `npx vitest run tests/cli/commands.test.ts` | ❌ W0 | ⬜ pending |
| 01-03-04 | 03 | 2 | INTF-05 | integration | `npx vitest run tests/api/routes.test.ts` | ❌ W0 | ⬜ pending |
| 01-03-05 | 03 | 2 | INTF-06 | unit | `npx vitest run tests/state/store.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `vitest.config.ts` — framework configuration
- [ ] `tests/llm/provider.test.ts` — LLM provider interface tests (mock Ollama)
- [ ] `tests/llm/token-budget.test.ts` — token budget tracking
- [ ] `tests/safety/validator.test.ts` — command validation (allowlist/blocklist)
- [ ] `tests/safety/approval.test.ts` — risk classification and approval logic
- [ ] `tests/safety/classifier.test.ts` — risk level classification
- [ ] `tests/audit/logger.test.ts` — audit logging and state diffs
- [ ] `tests/cli/commands.test.ts` — CLI command parsing and routing
- [ ] `tests/api/routes.test.ts` — Express route integration tests
- [ ] `tests/state/store.test.ts` — write-through dual storage
- [ ] `tests/state/db.test.ts` — SQLite schema and queries
- [ ] Framework install: `npm install -D vitest @vitest/coverage-v8`

*If none: "Existing infrastructure covers all phase requirements."*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| REPL interactive experience | INTF-01 | Readline prompts require TTY | Start `npm run dev`, type `/infra:debug "test"`, verify prompt/response flow |
| Streaming output display | CORE-01 | Visual verification of token streaming | Run debug command, verify tokens appear incrementally |
| Destructive confirmation UX | SAFE-03 | Requires interactive typed input | Trigger destructive command, verify typed confirmation prompt works |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
