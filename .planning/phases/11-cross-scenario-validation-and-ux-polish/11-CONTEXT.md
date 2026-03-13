# Phase 11: Cross-Scenario Validation and UX Polish - Context

**Gathered:** 2026-03-13
**Status:** Ready for planning

<domain>
## Phase Boundary

Formalize the audit trail as a compliance-grade DPEV sequence, standardize the E2E test suite into a rigid Scenario Factory archetype, and add usability improvements to `/infra:history`. This phase closes v1.1 by ensuring every scenario has verified audit completeness and the history command becomes the admin's primary post-fix review tool.

Requirements: E2E-03, UX-01, UX-02

</domain>

<decisions>
## Implementation Decisions

### Audit Trail Depth — Sequence-Based Validation (E2E-03)
- Implement **Logical Phase Gating**: enforce DPEV phase order (S→D→E→V) but allow multiple sub-events within each phase
- Add a new `verification` event type to formalize the "V" in DPEV — audit trail becomes a result-oriented compliance record, not just command history
- Event sequence: `skill_selection` → `decision` → `execution_start` → `step_complete` (1+ per step) → `execution_complete` → `verification`
- No payload content assertions — verify event types and phase ordering only, for maintainability at scale
- Create shared `assertDPEVSequence(entries)` helper as the formal validator of the InfraBrain Operational Standard
- Helper lives in `tests/e2e/helpers/` — every scenario E2E test imports it as the single source of truth

### History Default Behavior (UX-01/UX-02)
- **No-args default (UX-01):** `/infra:history` with no flags auto-resolves to the most recent session — "Contextual Continuity"
- **Compact DPEV Summary** as default output format: `S: nginx-troubleshoot → D: 502 upstream → E: 3 steps (2 approved) → V: recovered`. Full forensic table available via `--verbose`
- Footer hint on default view: `Showing latest session. Use --list to see all sessions.`
- **Session aliases (UX-02):** `--session last` and `--session previous` — resolved server-side via SQLite `ORDER BY timestamp DESC LIMIT 2`
- **Session list:** `--list` flag under history (not a separate command) shows high-density session overview table with session ID as primary key for drill-down
- Session alias resolution happens in the API route (server-side), not the CLI client

### E2E Test Archetype — Scenario Factory Blueprint
- Define a rigid E2E Test Archetype: Setup Environment → Trigger DPEV Loop → Assert Result → Validate Audit Sequence
- **Zero Legacy policy:** Refactor all 3 existing E2E tests (nginx-502, postgres-connleak, docker-storage) to the new archetype
- Shared `createMockLLMProvider(responses)` factory — centralizes provider boilerplate (registry, generateObject/generateText wiring), each test passes scenario-specific response arrays ("Mock Infrastructure as Code")
- Helpers directory: `tests/e2e/helpers/` containing `assertDPEVSequence`, `createMockLLMProvider`, and any shared setup utilities
- Each scenario test becomes a data-driven script: define responses, import archetype, assert results

### Claude's Discretion
- Exact compact DPEV summary format and chalk coloring
- Session list table columns and formatting
- How to extract DPEV summary from raw audit entries (grouping/aggregation logic)
- `verification` event emission point in the existing DPEV loop code
- Test archetype file structure details (e.g., whether helpers are separate files or one barrel export)

</decisions>

<specifics>
## Specific Ideas

- **"Sequence-Based Validation"** — the audit trail is the heart of the transparency promise; verifying exact DPEV order ensures the orchestrator never violates the reasoning chain
- **"assertDPEVSequence is the formal validator of the InfraBrain Operational Standard"** — single source of truth for all scenario E2E tests
- **"Compact DPEV Summary is the TL;DR of infrastructure repair"** — distills complex multi-step process into one readable string
- **"Mock Infrastructure as Code"** — separate execution plumbing from scenario intelligence; adding new failure patterns = defining responses, not writing test logic
- **"Zero Legacy"** — all existing tests migrate to archetype, no inconsistency in the Scenario Factory foundation

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/api/routes/history.ts`: History route with filter support (session, type, risk, since, until, limit, verbose) — extend with `--list` and session alias resolution
- `src/state/store.ts`: `queryAuditLog(filters)` with parameterized SQL — needs `getLatestSessionId()` and `getSessionList()` methods
- `src/cli/commands.ts`: History CLI command with `--session` option — add `--list` flag, default-to-latest logic
- `src/cli/formatter.ts`: `formatHistoryTable` — add `formatDPEVSummary` and `formatSessionList`
- `tests/e2e/poc-nginx-502.test.ts`, `poc-postgres-connleak.test.ts`, `poc-docker-storage.test.ts`: All three already have audit trail assertion blocks to refactor

### Established Patterns
- JSON envelope `{ ok, command, data, error }` for all CLI output
- Audit event types: `skill_selection`, `decision`, `execution_start`, `step_complete`, `execution_complete` — add `verification`
- Mock LLM provider pattern used across all 3 E2E tests (slight variations to standardize)
- `parseTimeInput` for time-based filters in history route

### Integration Points
- `src/api/routes/history.ts`: Add `--list` endpoint, session alias resolution (`last`, `previous`), default-to-latest behavior
- `src/state/store.ts`: Add session listing and latest-session queries
- `src/cli/commands.ts`: Wire new flags and default behavior
- `src/cli/formatter.ts`: Add DPEV summary and session list formatters
- DPEV loop (debug/execute routes): Emit new `verification` audit event after verify step
- `tests/e2e/helpers/`: New shared test utilities directory

</code_context>

<deferred>
## Deferred Ideas

- Tab-completion for `--session` flag (zsh/bash completions, show last 3 sessions) — future UX enhancement
- `--session last~N` git-style offset aliases — future if `last`/`previous` prove insufficient
- Automated scenario generation from archetype template — future "Chaos Monkey" tooling
- Cross-scenario correlation in audit trail (linking related sessions) — future multi-domain feature

</deferred>

---

*Phase: 11-cross-scenario-validation-and-ux-polish*
*Context gathered: 2026-03-13*
