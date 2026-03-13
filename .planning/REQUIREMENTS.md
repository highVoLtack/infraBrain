# Requirements: InfraBrain

**Defined:** 2026-03-12
**Core Value:** The AI diagnoses, plans, and fixes infrastructure problems autonomously while the human admin retains full control — every critical action requires approval, every decision is auditable, and the system can be taught any IT system through simple Markdown files.

## v1.1 Requirements

Requirements for v1.1 The Scenario Factory. Each maps to roadmap phases.

### Scenarios (Chaos Library)

- [x] **SCEN-01**: Docker Compose environment starts with Postgres hitting max_connections from connection-leaking app
- [x] **SCEN-02**: `postgres-troubleshoot.md` skill diagnoses pg_stat_activity, identifies idle/leaked connections, generates fix plan to terminate and recover
- [x] **SCEN-03**: Postgres scenario has reset script (`demo/postgres/reset-postgres.sh`) that reproduces the broken state idempotently
- [ ] **SCEN-04**: Docker Compose environment starts with a container whose volume is 100% full, causing crashes
- [x] **SCEN-05**: `docker-storage.md` skill diagnoses via `df -h` / `docker system df`, generates fix plan to prune or truncate
- [ ] **SCEN-06**: Docker volume scenario has reset script (`demo/reset-docker-storage.sh`) that reproduces the broken state idempotently

### E2E Validation

- [x] **E2E-01**: Postgres scenario has automated E2E test proving full DPEV loop (diagnose → plan → execute → verify recovery)
- [ ] **E2E-02**: Docker volume scenario has automated E2E test proving full DPEV loop
- [ ] **E2E-03**: Both E2E tests verify audit trail completeness (skill_selection, decision, execution events)

### Engine Enhancement

- [x] **ENGN-01**: `executePlan` injects `rollingContext.getContext()` into sub-agent LLM calls so multi-step plans maintain awareness of prior step results
- [x] **ENGN-02**: Execute and resume routes pass rolling context to LLM provider for follow-up interactions

### UX Polish

- [ ] **UX-01**: `/infra:history` defaults to the most recent session when no `--session` flag provided
- [ ] **UX-02**: `/infra:history --session last` resolves to the latest session_id from SQLite

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Distribution

- **DIST-01**: Standalone binary via Node.js SEA (no Node.js required on target)
- **DIST-02**: Cross-platform support (Linux, macOS)

### Ecosystem (v2.0+)

- **ECO-01**: OCI registry distribution for Skills and LoRA Expert Packs
- **ECO-02**: Day 0 Setup Wizard with Discovery Agents (Nmap, AD, Docker, K8s)
- **ECO-03**: Auto-Provisioning based on detected tech stack
- **ECO-04**: Local Knowledge Base with Qdrant vector DB (air-gapped)
- **ECO-05**: Intelligence Forge LoRA production pipeline

### Enterprise

- **ENTR-01**: Multi-team support with RBAC
- **ENTR-02**: Private skill repositories via git integration
- **ENTR-03**: ChatOps integration (Slack/Teams)

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| RAG / Vector DB integration | Deferred to v2.0+ — prove engine with procedural skills first |
| Elastic Intelligence Brokerage | Deferred to v2.0+ — need proven scenario library first |
| LoRA training / Expert Packs | Deferred to v2.0+ — need scenario coverage before domain specialization |
| Day 0 Discovery / Auto-Provisioning | Deferred to v2.0+ — ecosystem infrastructure |
| Web UI / dashboard | CLI-first, API is the product |
| Full autonomous mode (no human) | EU AI Act requires human oversight |
| Cloud-hosted SaaS | 100% on-premise only |
| New domain skills beyond Postgres/Docker storage | v1.1 focuses on depth (2 scenarios well-proven), not breadth |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| ENGN-01 | Phase 8 | Complete |
| ENGN-02 | Phase 8 | Complete |
| SCEN-01 | Phase 9 | Complete |
| SCEN-02 | Phase 9 | Complete |
| SCEN-03 | Phase 9 | Complete |
| E2E-01 | Phase 9 | Complete |
| SCEN-04 | Phase 10 | Pending |
| SCEN-05 | Phase 10 | Complete |
| SCEN-06 | Phase 10 | Pending |
| E2E-02 | Phase 10 | Pending |
| E2E-03 | Phase 11 | Pending |
| UX-01 | Phase 11 | Pending |
| UX-02 | Phase 11 | Pending |

**Coverage:**
- v1.1 requirements: 13 total
- Mapped to phases: 13
- Unmapped: 0

---
*Requirements defined: 2026-03-12*
*Last updated: 2026-03-12 — traceability updated for v1.1 roadmap*
