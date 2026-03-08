# Phase 2: Skill System and Orchestrator - Context

**Gathered:** 2026-03-08
**Status:** Ready for planning

<domain>
## Phase Boundary

Orchestrator can load Markdown skill files, select the right skill for a problem, and produce a diagnostic assessment with a structured fix plan. Includes: skill file format/loader/validator, LLM-based orchestrator routing, planning skill, verification skill, and log analysis skill.

Requirements: CORE-03, CORE-04, CORE-05, SKIL-01, SKIL-02, SKIL-03, SKIL-04

</domain>

<decisions>
## Implementation Decisions

### Skill File Format
- Follow obra/superpowers format closely: YAML frontmatter (name, description, triggers), ## System Prompt, ## Tools, ## Examples
- Per-skill tool allowlist in frontmatter -- each skill declares which shell commands it's allowed to use (e.g. log-analysis can call grep/journalctl but NOT rm). Orchestrator enforces this on top of global safety rules
- Malformed skill files are rejected with clear error messages (which section is missing/invalid). Other valid skills still load normally
- Default skills directory is skills/ at project root, but path is configurable via .infrabrain/config.json. Admin can point to any directory

### Orchestrator Selection
- LLM-based routing: send user input + skill summaries (from frontmatter descriptions) to the LLM, it picks the best match
- Always show skill selection to admin: "Using skill: Log Analysis -- detected log-related query." One line before proceeding
- Admin can override with explicit flag: /infra:debug "502 error" --skill=log-analysis
- Skill context injected as multi-message conversation: base system prompt as system message, skill context as assistant message, user input as user message

### Fix Plan Structure
- Single command per step granularity -- each step = one shell command or one config change. Maximum control and auditability
- Per-step rollback information -- each step defines its undo command (e.g. Step: docker stop nginx -> Rollback: docker start nginx). Phase 3 execution engine uses this for automatic rollback on safety halt
- Both JSON and Markdown storage -- JSON for the execution engine (steps array with command, rollback, risk, status fields), auto-generated Markdown summary for human review in session directory
- No time estimates -- LLM estimates are unreliable for infra operations. Show step count and plan complexity instead
- Plan displayed as numbered CLI table: # | Command | Risk | Status

### Log Analysis Behavior
- Two-pass filtering: first pass grep for relevant patterns, second pass LLM analyzes filtered set. If too many matches, LLM picks the most relevant subset
- All four log formats supported in v1: syslog, JSON structured, Docker, journald. Each gets a parser that normalizes to a common format (timestamp, level, message, source)
- Log access via shell commands through existing safety layer -- skill declares allowed commands (grep, journalctl, docker logs) in its frontmatter tool allowlist
- Log context fits within existing diagnosis token budget (4K tokens, ~200 lines). Pre-filter must get it down to that. If more matches, truncate with note ("Showing 200 of 1,423 matches")

### Claude's Discretion
- Exact YAML frontmatter schema fields beyond name/description/triggers/tools
- Log format auto-detection heuristics within each parser
- Skill routing prompt engineering (how to present skill summaries to LLM)
- Fix plan Markdown template layout
- Error message formatting for malformed skills

</decisions>

<specifics>
## Specific Ideas

- Skill file format should feel familiar to anyone who's used obra/superpowers -- low barrier to writing new skills
- Tool allowlist is defense-in-depth: even if the LLM suggests a dangerous command, the per-skill allowlist blocks it before global safety even sees it
- Multi-message conversation injection leverages the LLM's native conversation format for better instruction following vs simple string concatenation
- Two-pass log filtering is more accurate than simple grep -- the LLM can pick the most diagnostically relevant entries from a large grep result

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/llm/provider.ts`: LLM provider with streamDiagnosis/generateCommand -- orchestrator will extend this with skill-aware prompt injection
- `src/safety/classifier.ts` + `src/safety/validator.ts`: Command validation pipeline -- log analysis skill routes commands through this
- `src/cli/commands.ts`: registerCommands with /infra:debug -- needs generalization for skill-based routing
- `src/config/loader.ts` + `src/config/types.ts`: Zod-based config loading -- extend for skills directory path
- `src/audit/logger.ts`: Structured audit logging -- skill selection and plan generation should be logged

### Established Patterns
- Feature-based flat layout: src/llm/, src/cli/, src/safety/ -- new modules go in src/skills/, src/orchestrator/
- Zod schemas for validation (config types) -- use same pattern for skill file validation
- Write-through dual storage (file + SQLite) -- fix plans stored same way
- Commander.js for CLI commands -- extend with --skill flag

### Integration Points
- Orchestrator sits between CLI commands and LLM provider -- intercepts user input, selects skill, injects context, then calls existing provider
- Skill loader runs at startup, populates an in-memory skill registry
- Fix plan JSON stored in session state via existing store.ts
- Per-skill tool allowlist checked before existing safety validator

</code_context>

<deferred>
## Deferred Ideas

None -- discussion stayed within phase scope

</deferred>

---

*Phase: 02-skill-system-and-orchestrator*
*Context gathered: 2026-03-08*
