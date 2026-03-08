# Requirements: InfraBrain

**Defined:** 2026-03-07
**Core Value:** The AI diagnoses, plans, and fixes infrastructure problems autonomously while the human admin retains full control — every critical action requires approval, every decision is auditable, and the system can be taught any IT system through simple Markdown files.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Core Engine

- [x] **CORE-01**: System provides an abstracted LLM provider interface with Ollama as default backend
- [x] **CORE-02**: System supports pluggable LLM providers (vLLM, llama.cpp) without code changes
- [x] **CORE-03**: System loads and parses Markdown skill files containing prompts and tool definitions
- [x] **CORE-04**: System validates skill files against a defined format spec on load
- [x] **CORE-05**: Orchestrator reads user input and selects appropriate skills from the library
- [ ] **CORE-06**: Orchestrator executes the Diagnose → Plan → Execute → Verify loop end-to-end
- [ ] **CORE-07**: Each sub-agent task runs in a separate LLM conversation with isolated context
- [ ] **CORE-08**: Each sub-agent task runs in a sandboxed child process (execFile/spawn, no shell)
- [x] **CORE-09**: System tracks context token budget and prevents silent truncation by Ollama
- [x] **CORE-10**: System validates all generated commands against a whitelist/blocklist before execution

### Safety & Trust

- [x] **SAFE-01**: Read-only commands auto-approve without human intervention
- [x] **SAFE-02**: Write commands require explicit Y/N approval from the admin
- [x] **SAFE-03**: Destructive commands require typed confirmation from the admin
- [ ] **SAFE-04**: Circuit breaker halts execution after max retries per task (configurable, default 3)
- [ ] **SAFE-05**: Damage budget limits total state changes per fix plan (configurable)
- [ ] **SAFE-06**: Failed retries consume double the damage budget
- [ ] **SAFE-07**: System captures pre-execution state snapshot before every write operation
- [ ] **SAFE-08**: System automatically rolls back to last-known-good state when safety limits are hit
- [x] **SAFE-09**: System logs every decision as structured JSON (what was diagnosed, options considered, why chosen)
- [x] **SAFE-10**: System captures before/after state diffs for every change made
- [ ] **SAFE-11**: Audit log is queryable via SQLite
- [ ] **SAFE-12**: System alerts the admin when circuit breaker or damage budget triggers

### Interface

- [x] **INTF-01**: Admin can run diagnostic commands via CLI (e.g., `/infra:debug "Why is Nginx returning 502?"`)
- [ ] **INTF-02**: Admin can check system and session status via CLI (`/infra:status`)
- [ ] **INTF-03**: Admin can view audit history via CLI (`/infra:history`)
- [ ] **INTF-04**: CLI supports machine-parseable JSON output mode for scripting
- [x] **INTF-05**: REST API backend serves all CLI functionality
- [x] **INTF-06**: System persists fix plan state to disk (human-readable file + SQLite)
- [ ] **INTF-07**: Admin can resume an interrupted fix plan from where it left off
- [x] **INTF-08**: Lock system prevents concurrent fixes on the same target
- [x] **INTF-09**: Admin sees "fix in progress by [admin]" when a target is locked
- [x] **INTF-10**: Admin can force-override a lock with explicit confirmation

### Skills (Standard Library)

- [x] **SKIL-01**: Core planning skill decomposes problems into 2-5 minute fix plan steps
- [x] **SKIL-02**: Core verification skill writes health checks that fail before fix and pass after
- [x] **SKIL-03**: Log analysis skill pre-filters logs (grep, journalctl) before LLM analysis
- [x] **SKIL-04**: Log analysis skill handles common formats (syslog, JSON structured, Docker, journald)

### POC Scenario

- [ ] **POC-01**: Docker Compose test environment with intentionally broken Nginx (returns 502)
- [ ] **POC-02**: End-to-end demo: admin triggers debug → system diagnoses → writes fix plan → generates corrected config → admin approves → fix applied → health check passes
- [ ] **POC-03**: Demo shows full audit trail of the fix including decision reasoning and state diffs

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Differentiators

- **DIFF-01**: Progressive autonomy levels (Observe / Guided / Autonomous per skill and environment)
- **DIFF-02**: Composable skill chaining (skills invoke other skills as sub-steps)
- **DIFF-03**: Infrastructure mapping skill (nmap, osquery, Docker topology)

### Additional Skills

- **SKIL-05**: Database troubleshooting skill (SQL query analysis, connection pool issues)
- **SKIL-06**: Security auditing skill (open ports, outdated packages, CVE checks)

### Distribution

- **DIST-01**: Standalone binary via Node.js SEA (no Node.js required on target)
- **DIST-02**: Cross-platform support (Linux, macOS)

### Enterprise

- **ENTR-01**: Multi-team support with RBAC
- **ENTR-02**: Private skill repositories via git integration
- **ENTR-03**: ChatOps integration (Slack/Teams)

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Web UI / dashboard | Doubles development surface; CLI-first, API is the product. Web UI is a consumer of the API for v2+ |
| Full autonomous mode (no human) | Existential risk; EU AI Act requires human oversight; one bad `rm -rf` ends the company |
| Cloud-hosted SaaS | Contradicts core value prop (100% on-premise). Separate product if demand materializes |
| GraphRAG / Neo4j | Overkill for v1; JSON/SQLite state is sufficient. Upgrade when managing 1000+ node environments |
| Public skill marketplace | Requires trust infrastructure, hosting, moderation. Ship after community exists |
| Multi-tenant architecture | Massive auth/RBAC complexity; v1 is single-instance single-team |
| Real-time streaming dashboards | Not an observability platform; integrate with existing tools (Prometheus, Grafana) via skills |
| Natural language for everything | LLMs unreliable for parsing ambiguous NL into precise commands; structured CLI for actions, NL for diagnostics |
| OAuth/SAML authentication | v1 is local single-team; filesystem permissions as stopgap |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| CORE-01 | Phase 1 | Complete |
| CORE-02 | Phase 1 | Complete |
| CORE-03 | Phase 2 | Complete |
| CORE-04 | Phase 2 | Complete |
| CORE-05 | Phase 2 | Complete |
| CORE-06 | Phase 3 | Pending |
| CORE-07 | Phase 3 | Pending |
| CORE-08 | Phase 3 | Pending |
| CORE-09 | Phase 1 | Complete |
| CORE-10 | Phase 1 | Complete |
| SAFE-01 | Phase 1 | Complete |
| SAFE-02 | Phase 1 | Complete |
| SAFE-03 | Phase 1 | Complete |
| SAFE-04 | Phase 3 | Pending |
| SAFE-05 | Phase 3 | Pending |
| SAFE-06 | Phase 3 | Pending |
| SAFE-07 | Phase 3 | Pending |
| SAFE-08 | Phase 3 | Pending |
| SAFE-09 | Phase 1 | Complete |
| SAFE-10 | Phase 1 | Complete |
| SAFE-11 | Phase 4 | Pending |
| SAFE-12 | Phase 3 | Pending |
| INTF-01 | Phase 1 | Complete |
| INTF-02 | Phase 4 | Pending |
| INTF-03 | Phase 4 | Pending |
| INTF-04 | Phase 4 | Pending |
| INTF-05 | Phase 1 | Complete |
| INTF-06 | Phase 1 | Complete |
| INTF-07 | Phase 4 | Pending |
| INTF-08 | Phase 3 | Complete |
| INTF-09 | Phase 3 | Complete |
| INTF-10 | Phase 3 | Complete |
| SKIL-01 | Phase 2 | Complete |
| SKIL-02 | Phase 2 | Complete |
| SKIL-03 | Phase 2 | Complete |
| SKIL-04 | Phase 2 | Complete |
| POC-01 | Phase 5 | Pending |
| POC-02 | Phase 5 | Pending |
| POC-03 | Phase 5 | Pending |

**Coverage:**
- v1 requirements: 39 total
- Mapped to phases: 39
- Unmapped: 0

---
*Requirements defined: 2026-03-07*
*Last updated: 2026-03-07 after roadmap creation*
