# Phase 1: Foundation and Safety Gates - Context

**Gathered:** 2026-03-07
**Status:** Ready for planning

<domain>
## Phase Boundary

Admin can connect to a local LLM, issue a CLI command, and see safety-gated command validation with full audit logging. This is the platform skeleton that everything else builds on. Includes: LLM provider abstraction, state storage, CLI shell, HITL approval, command validation, and audit logging.

Requirements: CORE-01, CORE-02, CORE-09, CORE-10, SAFE-01, SAFE-02, SAFE-03, SAFE-09, SAFE-10, INTF-01, INTF-05, INTF-06

</domain>

<decisions>
## Implementation Decisions

### Project Structure & CLI
- Both REPL and one-shot CLI modes: interactive REPL is primary, one-shot commands for scripting/CI
- Custom REPL built on Node.js readline + Commander.js for command parsing
- Feature-based flat repo layout: src/llm/, src/cli/, src/safety/, src/state/, src/audit/
- Express with minimal routes (/debug, /health) for the REST API backend
- CLI calls the API internally; API is the single execution path

### LLM Provider Interface
- Vercel AI SDK with Ollama adapter for LLM communication (research needed: validate AI SDK v6 compatibility with Ollama)
- Streaming with buffered sections: stream diagnostic reasoning live to CLI, buffer command/action outputs for safety validation before display
- Fixed context window budget per task type (e.g., 4K for diagnosis, 2K for commands) -- hard limits prevent silent truncation
- Llama 3.3 70B as the only model for Phase 1; Qwen 2.5 Coder 7B deferred to Phase 3 sub-agents

### State Storage & Audit Trail
- Session-based file structure: .infrabrain/sessions/{session-id}/ containing state.json, audit.jsonl, diffs/
- better-sqlite3 for SQLite (synchronous API, fastest Node binding, battle-tested)
- Audit entries capture: what was diagnosed, options LLM considered, why it chose this option, before/after state diffs (no full LLM transcripts)
- Write-through sync model: every state change writes to both file and SQLite atomically; files are source of truth, SQLite is queryable index

### Command Validation & Risk Classification
- Hardcoded safety defaults (never rm -rf /, etc.) + config file overrides for allowlist/blocklist patterns
- Pattern-based regex rules for risk tier classification: read-only (docker ps, cat, etc.), write (docker restart, etc.), destructive (docker rm -f, etc.)
- Inline approval UX with context: read commands auto-approve with log line, write commands get [Y/n] prompt, destructive commands require typed confirmation of target name
- Hard stop on rejected/blocked commands: log the rejection, explain why to admin, no automatic retry or LLM-suggested alternatives

### Claude's Discretion
- Express route structure and middleware setup
- REPL prompt styling and UX details
- SQLite schema design (tables, indexes)
- Exact regex patterns for command classification defaults
- Config file format (YAML vs JSON) for allowlist/blocklist overrides

</decisions>

<specifics>
## Specific Ideas

- REPL should feel like a dedicated tool (similar to psql or node REPL), not a chatbot
- Approval UX for destructive commands mirrors Docker's pattern: type the target name to confirm
- Streaming diagnostic reasoning gives the admin real-time visibility into the AI's thinking
- Files are source of truth over SQLite -- if they diverge, files win
- Hardcoded safety rules are belt-and-suspenders: even if config is misconfigured, core dangers are blocked

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- No existing code -- greenfield project

### Established Patterns
- No patterns yet -- Phase 1 establishes the foundational patterns for all subsequent phases

### Integration Points
- Ollama must be running locally (default http://localhost:11434)
- .infrabrain/ directory created in project/working directory
- Express API server starts on configurable port

</code_context>

<deferred>
## Deferred Ideas

None -- discussion stayed within phase scope

</deferred>

---

*Phase: 01-foundation-and-safety-gates*
*Context gathered: 2026-03-07*
