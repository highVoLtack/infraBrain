# Phase 3: Execution Engine and Safety Net - Context

**Gathered:** 2026-03-08
**Status:** Ready for planning

<domain>
## Phase Boundary

System can execute fix plan steps through isolated sub-agents with circuit breaker, damage budget, automatic rollback, and concurrency protection. Includes: sub-agent process isolation, rolling LLM context, circuit breaker, damage budget tracking, pre-execution state snapshots, automatic rollback, target locking, and force-override.

Requirements: CORE-06, CORE-07, CORE-08, SAFE-04, SAFE-05, SAFE-06, SAFE-07, SAFE-08, SAFE-12, INTF-08, INTF-09, INTF-10

</domain>

<decisions>
## Implementation Decisions

### Sub-agent Isolation
- Each command runs via `child_process.execFile` as safe default (no shell injection risk, captures stdout/stderr separately, timeout support)
- Shell mode (`spawn` with shell) available for commands that need pipes/redirects, but only with HITL approval -- admin must explicitly approve shell execution
- Same model (Llama 3.3 70B) for both orchestrator and sub-agents -- simpler architecture, one model to manage
- Sub-agents execute commands exactly as planned from the fix plan -- no adaptation or re-planning on failure. If a step fails, the circuit breaker handles retries
- Rolling context within plan: each step sees the results of prior steps for continuity. Automatic context compression when token budget gets tight (summarize older step results to 1-2 lines). This enables the LLM to react to prior step outcomes

### Circuit Breaker & Damage Budget
- Circuit breaker: 3 retries per step (configurable in .infrabrain/config.json), then halt entire plan and alert admin
- Damage budget: WRITE commands cost 1 point, DESTRUCTIVE commands cost 2 points. Default budget: 10 per plan (configurable). READ commands are free
- Failed retries consume double damage budget (per SAFE-06 requirement)
- When damage budget is exceeded: full halt -- no more automated actions of any kind. Admin reviews and decides next steps manually
- Alert mechanism: bold red CLI warning + full details in audit.jsonl. No external notifications in v1

### Rollback Behavior
- On safety trigger: roll back only the failing step (run its rollback command). Previous successful steps stay applied -- they already passed approval and worked correctly
- Pre-execution state snapshots via command output capture: before executing a WRITE/DESTRUCTIVE command, run a corresponding READ command to capture current state (e.g., `docker inspect nginx` before `docker stop nginx`). Store as JSON in session's snapshots/ directory
- If rollback itself fails: log as CRITICAL audit event, alert admin with what was attempted, what failed, and the original snapshot state. No automatic retry of rollback -- human must intervene
- Rollback commands are auto-approved (no HITL gate) since the admin already approved the plan which included rollback definitions. Speed matters during safety recovery

### Concurrency & Locking
- Per-target locking: lock by target identifier (e.g., "nginx", "postgres"). Multiple admins can fix different targets simultaneously
- File-based locks: .infrabrain/locks/{target}.lock containing session ID, admin name, timestamp. Other sessions check for file existence. Visible, debuggable
- Force-override via typed confirmation: same pattern as destructive command approval. Admin must type the target name to override. Shows who holds the lock and since when
- Stale lock detection: timeout-based (default: 1 hour, configurable). Locks older than timeout are treated as stale with a warning. Admin can also manually delete lock files

### Claude's Discretion
- Exact READ command to run for state snapshot capture per command type
- Context compression strategy (how to summarize prior step results when budget is tight)
- Lock file JSON schema (what metadata to store beyond session ID, admin, timestamp)
- Error message formatting for circuit breaker and damage budget alerts
- How to derive target identifier from diagnosis/fix plan

</decisions>

<specifics>
## Specific Ideas

- Shell mode for commands needing pipes should feel like an explicit escalation -- the admin sees a clear message that this command requires shell execution and gets an extra approval step
- Rolling context should feel natural -- the LLM should reference prior step results seamlessly, like "Since step 1 confirmed the config file exists at /etc/nginx/nginx.conf, we can now..."
- Lock conflict message should be informative: "Target 'nginx' is locked by session abc123 (started 15 minutes ago). Type 'nginx' to force-override or wait."
- Damage budget display in CLI: show running total like "Budget: 3/10 used (2 WRITE, 1 DESTRUCTIVE)" after each step

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/orchestrator/types.ts`: FixStep (command, rollback, risk) and FixPlan (steps, complexity) -- direct input for execution engine
- `src/safety/validator.ts`: Multi-layer validation pipeline (skill allowlist -> global safety) -- extend with damage budget check
- `src/safety/classifier.ts`: RiskLevel enum (READ/WRITE/DESTRUCTIVE/BLOCKED) -- used for damage budget scoring
- `src/cli/approval.ts`: Approval gate with typed confirmation for DESTRUCTIVE -- reuse pattern for lock force-override
- `src/state/store.ts`: WriteThrough (file-first + SQLite) -- extend for snapshot storage
- `src/audit/logger.ts`: AuditLogger with logStateDiff, logError -- extend with circuit breaker and damage budget events
- `src/state/session.ts`: Session with UUID v7, directory structure -- extend with snapshots/ subdirectory
- `src/llm/token-budget.ts`: checkBudget() and estimateTokens() -- use for rolling context compression decisions

### Established Patterns
- File-first dual storage (file = source of truth, SQLite = queryable index)
- Factory pattern for routes with injectable dependencies (createDebugRoute)
- Risk-based approval: auto for READ, Y/n for WRITE, typed confirmation for DESTRUCTIVE
- Graceful degradation when components are unavailable
- Zod schemas for structured LLM output (generateObject)

### Integration Points
- Debug route (`src/api/routes/debug.ts`): Currently generates fix plans but doesn't execute them. Execution engine hooks in after plan approval
- Session directory (`.infrabrain/sessions/{id}/`): Add `snapshots/` and execution state
- Config (`src/config/types.ts`): Add circuitBreaker and damageBudget config sections
- Locks directory (`.infrabrain/locks/`): New directory for target lock files

</code_context>

<deferred>
## Deferred Ideas

None -- discussion stayed within phase scope

</deferred>

---

*Phase: 03-execution-engine-and-safety-net*
*Context gathered: 2026-03-08*
