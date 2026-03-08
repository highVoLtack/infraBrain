# Phase 4: Session Management and CLI Polish - Context

**Gathered:** 2026-03-08
**Status:** Ready for planning

<domain>
## Phase Boundary

Admin has full operational visibility -- status checks, audit history, session resumability, and machine-parseable output for scripting. Includes: `/infra:status` dashboard, `/infra:history` with filters, `--json` output mode across all commands, and fix plan resume from interrupted session.

Requirements: INTF-02, INTF-03, INTF-04, INTF-07, SAFE-11

</domain>

<decisions>
## Implementation Decisions

### Status Command (`/infra:status`)
- Dashboard overview: one-screen summary showing system health, active fix plans with progress, active locks, and recent sessions
- Live Ollama health check on every status call -- ping the model endpoint, show "connected" with model name + response time or "disconnected" with error
- Show active fix plans first, then last 3 completed sessions (date, outcome, step count)
- Lock section only appears when there are active locks -- "No active locks" is noise, keep dashboard clean

### Audit History (`/infra:history`)
- Four filter flags: `--session <id>`, `--type <event>`, `--risk <level>`, `--since` / `--until` (time range)
- Default: last 20 entries, `--limit` flag to change
- Compact table display: one line per entry — TIMESTAMP | TYPE | RISK | COMMAND/DECISION (truncated). `--verbose` flag for expanded view
- Filters are combinable (AND logic): `--type approval --risk destructive --since '1h ago'`

### JSON Output Mode (`--json`)
- Standard envelope format across ALL commands: `{ "ok": true/false, "command": "status", "data": {...}, "error": null }`
- Consistent shape -- callers always know the structure regardless of command
- Buffer then output for streaming commands (diagnosis): wait for full response, then output complete JSON envelope. One JSON.parse() call for scripting
- Pure JSON only when --json is set: no chalk colors, no spinners, no prompts on stdout. Approval gates auto-approve in JSON mode (same as one-shot CLI). Stderr for errors only

### Fix Plan Resumability
- Both auto-detect and explicit resume paths: auto-detect on `/infra:debug` (detects incomplete plan, asks "Resume from step 3/5 or start fresh?") AND explicit `/infra:resume <session-id>` command
- When resuming, ask the admin: show the failed step with its error and offer "Retry this step" or "Skip to next"
- 24-hour resumability window (configurable). Sessions older than 24h show warning: "This plan is X old. Infrastructure state may have changed. Resume anyway?"
- Warning only on resume, no state re-verification -- admin is responsible for knowing their environment. Fast resume over safe-but-slow re-checks

### Claude's Discretion
- Exact table column widths and formatting for status/history display
- Time parsing strategy for --since/--until (relative like "1h ago" vs ISO timestamps)
- How auto-detect matches an incomplete plan to a new debug query (target matching, similarity)
- Health check timeout value for Ollama ping
- How to handle --json combined with --verbose for history

</decisions>

<specifics>
## Specific Ideas

- Status dashboard should feel like `docker ps` -- glanceable, operational, not a report
- History compact table should feel like `git log --oneline` -- scannable, each line tells you what happened
- JSON envelope makes it easy to pipe into jq: `infrabrain /infra:status --json | jq '.data.locks'`
- Resume UX: when auto-detecting, show a clear summary of what was done and what remains before asking to continue

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/state/store.ts`: WriteThrough with SQLite queries -- extend with history query methods
- `src/state/db.ts`: SQLite with audit_log table, indexes on session_id, timestamp, event_type -- ready for filtered queries
- `src/state/session.ts`: Session with UUID, directory structure -- extend with resume detection
- `src/execution/executor.ts`: ExecutionResult with step-by-step status tracking -- provides resume point data
- `src/locks/manager.ts`: Lock listing for status display
- `src/cli/commands.ts`: Commander.js command registration -- add new commands and global --json option
- `src/audit/types.ts`: AuditEventType enum -- used for --type filter validation
- `src/safety/types.ts`: RiskLevel enum -- used for --risk filter validation

### Established Patterns
- Commander.js with `.option()` for flags (Phase 1)
- CLI calls API internally -- API is the single execution path (Phase 1)
- Factory pattern for routes with injectable dependencies (Phase 1)
- chalk for CLI colors, suppressed in JSON mode (Phase 1)

### Integration Points
- New API routes: GET /status, GET /history (with query params for filters)
- New CLI commands: /infra:status, /infra:history, /infra:resume
- Global --json option on Commander program (applies to all commands)
- Session state extended with resume metadata (last completed step, interruption reason)

</code_context>

<deferred>
## Deferred Ideas

- Tab-completion for commands and dynamic suggestions for targets/session-ids from SQLite -- UX enhancement, could be its own phase
- AI-powered natural language query parser for /infra:history (e.g., "show me all destructive commands from today") that translates NL into structured SQL filters -- strong differentiator ("first Admin-Terminal that converts natural language to forensic database queries"), but requires LLM-to-SQL pipeline which is a separate capability

</deferred>

---

*Phase: 04-session-management-and-cli-polish*
*Context gathered: 2026-03-08*
