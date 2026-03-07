# Feature Research

**Domain:** AI IT Operations Platform (AIOps + Runbook Automation + LLM-Powered Diagnostics)
**Researched:** 2026-03-07
**Confidence:** MEDIUM-HIGH

## Feature Landscape

### Table Stakes (Users Expect These)

Features users assume exist. Missing these = product feels incomplete or unsafe for production use.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Diagnose-Plan-Execute-Verify loop** | Core workflow every AIOps and runbook tool provides. Dynatrace Davis AI, PagerDuty, StackStorm all have detect-analyze-act-confirm cycles. Without this, it is not an operations tool. | HIGH | This is InfraBrain's central architecture. Must be rock-solid before anything else. Comparable to StackStorm's sensor-trigger-rule-action chain. |
| **Human-in-the-Loop approval for write operations** | Enterprise non-negotiable. EU AI Act Article 14 mandates human oversight for high-risk AI. Every competitor (Rundeck, Shoreline, PagerDuty) has approval gates. No enterprise buyer will deploy autonomous infra changes without this. | MEDIUM | Risk-based tiers: read-only auto-approves, write operations require explicit Y/N, destructive operations require typed confirmation. Rundeck does this with ACLs per job step. |
| **Structured audit trail** | SOC 2 Type II requires detailed logs of all processing activities with timestamps. Banks, government, Mittelstand (InfraBrain's target) all need this for compliance. PagerDuty and BigPanda log every incident action. | MEDIUM | Decision log + before/after state diffs + queryable JSON. Must answer: who approved what, when, what changed, what was the outcome. SQLite for queries, files for git-trackability. |
| **Automatic rollback on failure** | Every mature automation tool has this. Rundeck has error handlers per step. StackStorm has compensating workflows. Without rollback, a failed fix can leave infrastructure in a worse state than before. | HIGH | Capture pre-execution state snapshot. On circuit breaker trip or verification failure, restore to last-known-good. This is the safety net that makes enterprises trust the tool. |
| **Circuit breaker / damage budget** | StackStorm has retry limits. Rundeck has timeout and error handling. Any tool that executes commands on production infrastructure without blast-radius limits is a liability, not a product. | MEDIUM | Max retries per step, max total changes per fix plan, configurable blast radius (e.g., "only touch containers in namespace X"). Halt and alert when limits are hit. |
| **CLI interface with clear commands** | InfraBrain is CLI-first. Admins expect predictable command structure, help text, autocompletion, and machine-parseable output (JSON). Rundeck and Ansible both have strong CLI interfaces alongside their UIs. | MEDIUM | Commands like `/infra:debug`, `/infra:status`, `/infra:history`. Must support both interactive and scripted usage. Pipe-friendly JSON output mode. |
| **Log analysis and pattern recognition** | Every AIOps tool does this. Dynatrace auto-discovers topology. BigPanda correlates events. PagerDuty groups alerts by pattern. An IT ops tool that cannot parse and reason about logs is useless. | MEDIUM | Pre-filter logs (grep, journalctl) to avoid context window overflow, then LLM analyzes filtered output. Must handle common formats: syslog, JSON structured logs, Docker logs, journald. |
| **Skill/runbook definition system** | Rundeck has job definitions. StackStorm has packs (2000+). Ansible has playbooks. The ability to define reusable operational procedures is fundamental. InfraBrain's Markdown skills are the equivalent. | MEDIUM | Markdown-based skill files with structured sections: description, available tools, prompts, verification steps. Must be versionable (git), composable, and human-readable. |
| **Execution isolation** | StackStorm runs actions in isolated containers. Rundeck executes over SSH (inherent isolation). Ansible uses per-host execution. Shared execution context is a safety and correctness risk. | HIGH | Sub-agent isolation: separate LLM context window + sandboxed child process. Prevents context contamination across tasks and limits blast radius of any single execution. |
| **Session state and resumability** | If a multi-step fix plan is interrupted (network drop, admin steps away), the system must know where it left off. PagerDuty and FireHydrant both track incident state across sessions. | MEDIUM | Persist plan state to disk (both human-readable file + SQLite). On reconnect, show status and allow resume/abort. Lock file indicates active session on a target. |

### Differentiators (Competitive Advantage)

Features that set InfraBrain apart from Rundeck, StackStorm, PagerDuty, Dynatrace, and others.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **100% on-premise with local LLMs** | Critical differentiator. PagerDuty, BigPanda, Dynatrace are all cloud-dependent. Banks, government, and German Mittelstand legally cannot send infrastructure data to cloud AI. No major competitor offers fully local LLM-powered operations. | MEDIUM | Ollama default, pluggable for vLLM/llama.cpp. The trade-off is model quality vs. privacy. Llama-3.3-70B for orchestration is strong enough for planning; Qwen2.5-Coder-7B handles execution. |
| **Teach-any-system via Markdown skills** | Rundeck needs job definitions in XML/YAML. StackStorm needs Python packs. Ansible needs YAML playbooks with specific module knowledge. InfraBrain's natural-language Markdown skills let non-developers define new capabilities. This solves the B2B customization problem: customers write their own skills instead of requesting custom code. | MEDIUM | This is the "platform" play. The engine is agnostic; skills are the product. Must have clear skill authoring docs, validation, and a "getting started" template. Enterprise value: new hires write a skill file instead of spending months learning internal tooling. |
| **LLM-powered diagnostic reasoning** | Traditional runbooks are deterministic: if X then Y. InfraBrain's LLM can reason about novel problems it has never seen, combine evidence from multiple sources, and generate hypotheses. No traditional tool does this. Dynatrace Davis AI does causal analysis but only within Dynatrace's own telemetry. | HIGH | The LLM reads skill files + system state + logs and reasons about root cause. This is the core innovation. Risk: LLM hallucination on infrastructure commands. Mitigation: verification step + HITL approval. |
| **Transparent reasoning chain** | Dynatrace and BigPanda are black boxes. PagerDuty's ML is opaque. InfraBrain shows its full reasoning: "I checked X, found Y, concluded Z, plan to do W." Markdown skills are inspectable. Decision logs are human-readable. This is essential for enterprise trust and regulatory compliance. | LOW | Already built into the architecture. Decision log captures each reasoning step. Skills are plain Markdown anyone can read. This is a sales differentiator: "No black-box AI on your production systems." |
| **Composable skill inheritance and chaining** | StackStorm has workflow chaining. But InfraBrain can let skills reference other skills, creating composable diagnostic trees. E.g., "debug-nginx" skill can invoke "analyzing-logs" and "check-docker-health" skills as sub-steps. | MEDIUM | Skill files can declare dependencies on other skills. Orchestrator loads the dependency graph. Enables building complex workflows from simple, tested building blocks. |
| **Progressive autonomy levels** | Emerging industry trend: start with full HITL, gradually increase automation as trust builds. Rather than binary "manual vs autonomous," InfraBrain can offer configurable autonomy per skill, per environment, per risk level. Read operations auto-approve, known-safe fixes semi-auto, novel fixes require full approval. | MEDIUM | Three levels: OBSERVE (read-only, no approval needed), GUIDED (plan shown, step-by-step approval), AUTONOMOUS (pre-approved skills execute without confirmation). Configurable per skill, per target host, per environment. |
| **Verification-driven remediation (test-driven fixes)** | Inspired by TDD. Before executing a fix, the system writes a health check that currently fails (red). After the fix, the check must pass (green). No competitor requires verification as a first-class concept in the fix workflow. | MEDIUM | Each fix plan step must define a verification command. Execution is: capture state, apply change, run verification. If verification fails, rollback. This catches fixes that "succeed" but do not actually resolve the problem. |
| **Standalone binary distribution** | Rundeck requires Java. StackStorm requires Python + RabbitMQ + MongoDB. Ansible requires Python. InfraBrain as a standalone binary (via pkg/nexe) means zero runtime dependencies on the target admin workstation. Just download and run. | MEDIUM | Significant DX advantage for enterprise deployment. No "install Node.js first" step. Single binary + Ollama is the entire stack. |

### Anti-Features (Commonly Requested, Often Problematic)

Features that seem good but create problems. Deliberately NOT building these.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| **Web UI dashboard** | Looks impressive in demos. Every competitor has one. Stakeholders expect visual interfaces. | Doubles development surface. Creates security surface (auth, sessions, CORS). Splits team focus. CLI-first means the API is the product; a UI is a consumer of the API that can come later. Rundeck's UI is often cited as both its strength and its maintenance burden. | Build a clean REST/gRPC API. CLI is the v1 interface. A web UI is a v2+ feature that consumes the same API. Do not build it until the API is stable and validated. |
| **Real-time streaming dashboards** | Looks great for monitoring. Competitors like Dynatrace and Datadog have rich visualizations. | Requires WebSocket infrastructure, frontend framework, charting libraries. Massive scope increase for marginal v1 value. InfraBrain is not an observability platform; it is an operations platform that consumes observability data. | Integrate with existing monitoring tools (Prometheus, Grafana) via skills. Do not replicate their dashboards. Output structured data that existing tools can ingest. |
| **Full autonomous mode (no human approval)** | "Just fix it automatically." Appealing for reducing MTTR to near-zero. SRE teams want self-healing infrastructure. | Existential risk for the product. One autonomous LLM-driven `rm -rf` on production ends the company. EU AI Act requires human oversight. Enterprise buyers will not purchase a tool that acts without approval on production systems. Even mature platforms like Shoreline only auto-remediate pre-approved, deterministic actions. | Progressive autonomy: start with full HITL, allow pre-approved skills to run with reduced oversight. Never fully autonomous for novel/unknown actions. The human always has veto power. |
| **Public skill marketplace (v1)** | Community-driven skill sharing is the dream. StackStorm has 2000+ community packs. | Requires trust infrastructure (skill signing, review process, versioning), hosting, moderation. Premature before proving the skill model works. Community needs critical mass to be useful. | Ship with a curated "standard library" of skills. Support git-based skill repositories for enterprise. Marketplace is a Phase 5+ feature after community exists. |
| **Multi-tenant / multi-team (v1)** | Enterprises have multiple teams. Natural request. | Requires auth (OAuth, SAML), RBAC, tenant isolation, permission models. Massive complexity increase. v1 is proving the core loop works. | v1 is single-instance, single-team. Multi-team is a future enterprise feature. Use filesystem permissions and separate instances as a stopgap. |
| **Cloud-hosted SaaS option** | Easier onboarding. Lower friction. Standard SaaS model. | Directly contradicts the core value proposition (100% on-premise, zero cloud). Banks and government customers will not use it. Splits engineering between two deployment models. | On-premise only. This is a feature, not a limitation. "Your data never leaves your servers" is the pitch. If cloud demand materializes, it is a separate product. |
| **Natural language everything** | "Just talk to it in plain English." Seems like the ultimate UX. | LLMs are unreliable for parsing ambiguous natural language into precise infrastructure commands. "Fix the server" means different things to different people. Precision matters when touching production. | Structured CLI commands for actions. Natural language for diagnostics and reasoning (where ambiguity is acceptable). Skill files provide the precision layer. Hybrid approach: NL for "what's wrong?" but structured commands for "do this." |
| **GraphRAG / knowledge graph (v1)** | Better reasoning over complex infrastructure relationships. Neo4j could model dependencies beautifully. | Massive infrastructure requirement (Neo4j). Overkill for v1 where simple JSON/Markdown state is sufficient. Adds operational complexity to a tool meant to reduce operational complexity. | Simple infrastructure state in JSON files + SQLite. Upgrade to graph database when the state model's complexity demands it. Likely v2+ when managing 1000+ node environments. |

## Feature Dependencies

```
[CLI Interface]
    |
    +--requires--> [REST/gRPC API Backend]
    |                  |
    |                  +--requires--> [LLM Provider Interface (Ollama)]
    |                  |
    |                  +--requires--> [Skill Loading System]
    |                                     |
    |                                     +--requires--> [Skill File Format Spec]
    |
    +--requires--> [Session State Management]

[Diagnose-Plan-Execute-Verify Loop]
    |
    +--requires--> [LLM Provider Interface]
    +--requires--> [Skill Loading System]
    +--requires--> [Sub-Agent Execution Isolation]
    |                  |
    |                  +--requires--> [Process Sandboxing]
    |                  +--requires--> [LLM Context Isolation]
    |
    +--requires--> [Verification System (Test-Driven)]
    +--requires--> [Human-in-the-Loop Approval]

[Automatic Rollback]
    |
    +--requires--> [State Snapshot Capture]
    +--requires--> [Circuit Breaker / Damage Budget]

[Audit Trail]
    |
    +--requires--> [Decision Logger]
    +--requires--> [State Diff Engine]
    +--requires--> [SQLite Storage]

[Progressive Autonomy]
    |
    +--requires--> [Human-in-the-Loop Approval]  (to selectively bypass)
    +--requires--> [Risk Classification per Skill]
    +--requires--> [Audit Trail]  (to log autonomous decisions)

[Log Analysis Skill]
    +--enhances--> [Diagnose-Plan-Execute-Verify Loop]

[Infrastructure Mapping Skill]
    +--enhances--> [Diagnose-Plan-Execute-Verify Loop]

[Composable Skill Chaining]
    +--requires--> [Skill Loading System]
    +--enhances--> [Diagnose-Plan-Execute-Verify Loop]
```

### Dependency Notes

- **CLI requires API Backend:** CLI is a thin client over the API. API must exist first so CLI and future clients share the same interface.
- **Diagnose-Plan-Execute-Verify requires Sub-Agent Isolation:** Without isolation, multi-step plans contaminate context windows and create blast-radius risks. This is architecturally foundational.
- **Automatic Rollback requires State Snapshots:** Cannot roll back without knowing the pre-change state. Snapshot capture must happen before every write operation.
- **Progressive Autonomy requires HITL + Risk Classification + Audit Trail:** You can only relax human approval when you have risk-based classification (to know what is safe) and audit logging (to prove what happened).
- **Composable Skill Chaining enhances the core loop:** Not required for v1, but dramatically increases the platform's power. Skills that call other skills create exponential capability growth.

## MVP Definition

### Launch With (v1)

Minimum viable product: prove the Diagnose-Plan-Execute-Verify loop works end-to-end on a real scenario (Docker/Nginx 502 fix).

- [ ] **LLM Provider Interface (Ollama)** -- foundation for all AI capabilities
- [ ] **Skill file format spec + loader** -- the platform's extensibility model
- [ ] **Core planning skill** -- LLM decomposes problems into fix plans
- [ ] **Core verification skill** -- test-driven fix validation
- [ ] **Log analysis skill** -- parse and reason about logs
- [ ] **Sub-agent execution with process isolation** -- safe command execution
- [ ] **Human-in-the-Loop approval (risk-based)** -- enterprise trust requirement
- [ ] **Circuit breaker + damage budget** -- safety guardrails
- [ ] **Automatic rollback on safety halt** -- safety net
- [ ] **Structured audit trail (decision log + diffs)** -- compliance foundation
- [ ] **CLI interface with core commands** -- user interaction layer
- [ ] **REST API backend** -- enables CLI and future clients
- [ ] **Session state persistence (file + SQLite)** -- resumability
- [ ] **Docker/Nginx 502 POC scenario** -- the proof point

### Add After Validation (v1.x)

Features to add once the core loop is proven and initial users provide feedback.

- [ ] **Infrastructure mapping skill** -- when users need multi-host diagnostics
- [ ] **Progressive autonomy levels** -- when users trust the system enough to want less friction
- [ ] **Composable skill chaining** -- when users write enough skills that composition becomes valuable
- [ ] **Additional standard library skills** (database troubleshooting, security auditing) -- driven by user demand
- [ ] **Standalone binary distribution** -- when shipping to users who do not have Node.js
- [ ] **Lock-based concurrency (multi-target)** -- when users manage multiple hosts simultaneously

### Future Consideration (v2+)

Features to defer until product-market fit is established.

- [ ] **Web UI** -- only after API is stable and validated by CLI users
- [ ] **Multi-team / RBAC** -- enterprise feature, requires auth infrastructure
- [ ] **Private skill repositories (git integration)** -- enterprise deployment at scale
- [ ] **Public skill marketplace** -- requires community critical mass
- [ ] **GraphRAG / Neo4j** -- when infrastructure state complexity demands it
- [ ] **ChatOps integration (Slack/Teams)** -- collaboration layer for larger teams
- [ ] **Event-driven automation (sensor/trigger model)** -- StackStorm-style reactive automation

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Diagnose-Plan-Execute-Verify loop | HIGH | HIGH | P1 |
| LLM Provider Interface (Ollama) | HIGH | MEDIUM | P1 |
| Skill file format + loader | HIGH | MEDIUM | P1 |
| Human-in-the-Loop approval | HIGH | MEDIUM | P1 |
| Circuit breaker + damage budget | HIGH | MEDIUM | P1 |
| Automatic rollback | HIGH | HIGH | P1 |
| Structured audit trail | HIGH | MEDIUM | P1 |
| Sub-agent execution isolation | HIGH | HIGH | P1 |
| CLI interface | HIGH | MEDIUM | P1 |
| REST API backend | HIGH | MEDIUM | P1 |
| Log analysis skill | HIGH | MEDIUM | P1 |
| Core planning + verification skills | HIGH | MEDIUM | P1 |
| Session state persistence | MEDIUM | LOW | P1 |
| Transparent reasoning chain | HIGH | LOW | P1 |
| Verification-driven remediation | HIGH | MEDIUM | P1 |
| Progressive autonomy levels | MEDIUM | MEDIUM | P2 |
| Infrastructure mapping skill | MEDIUM | MEDIUM | P2 |
| Composable skill chaining | MEDIUM | MEDIUM | P2 |
| Standalone binary | MEDIUM | MEDIUM | P2 |
| Lock-based concurrency | MEDIUM | MEDIUM | P2 |
| Additional standard library skills | MEDIUM | LOW per skill | P2 |
| Web UI | MEDIUM | HIGH | P3 |
| Multi-team / RBAC | MEDIUM | HIGH | P3 |
| ChatOps integration | LOW | MEDIUM | P3 |
| Private skill repos | MEDIUM | MEDIUM | P3 |
| GraphRAG | LOW | HIGH | P3 |
| Public marketplace | LOW | HIGH | P3 |

**Priority key:**
- P1: Must have for launch -- proves the core loop and earns enterprise trust
- P2: Should have, add after v1 validation -- expands capability and user base
- P3: Nice to have, future consideration -- enterprise scale and community features

## Competitor Feature Analysis

| Feature | Rundeck | StackStorm | PagerDuty AIOps | Dynatrace Davis AI | BigPanda | InfraBrain Approach |
|---------|---------|------------|-----------------|-------------------|----------|-------------------|
| **Runbook/skill system** | XML/YAML job definitions, GUI editor | Python packs (2000+ community) | Automated workflows | Built-in causal AI rules | Event correlation rules | Markdown skill files -- human-readable, git-versionable, no code required |
| **Execution model** | SSH/WinRM to targets, no agents | Actions in isolated containers | Cloud-based orchestration | Agent-based (OneAgent) | Cloud SaaS | Sub-agent with process isolation, fully local |
| **Human approval** | ACL-based per job step | Rule-based gates | Escalation policies | Automatic (limited HITL) | Automatic | Risk-based HITL: read auto-approves, write needs Y/N, destructive needs typed confirmation |
| **Audit trail** | Job execution logs | Action execution history | Incident timeline | Session replay | Incident history | Decision log + state diffs + queryable SQLite + human-readable files |
| **AI/ML capabilities** | None (deterministic) | None (deterministic) | ML alert grouping, noise reduction | Causal AI (Davis), predictive AI, generative AI (CoPilot) | ML event correlation, generative AI summaries | Local LLM reasoning -- diagnoses novel problems, generates fix plans, reasons about evidence |
| **Rollback** | Error handlers per step | Compensating workflows | Manual | Automatic (within Dynatrace scope) | N/A | Automatic rollback to pre-change state snapshot on any failure or safety limit breach |
| **Deployment** | Self-hosted (Java) or SaaS | Self-hosted (Python + RabbitMQ + MongoDB) | Cloud SaaS only | Agent + SaaS | Cloud SaaS only | Standalone binary + Ollama, fully on-premise, zero cloud dependencies |
| **Extensibility** | Plugins (Java/Groovy) | Packs (Python) | Limited integrations | Extensions API | Integrations | Markdown skill files -- anyone can write one in natural language |
| **Privacy** | Self-hosted option | Self-hosted option | Cloud only, data leaves your network | Agent collects data, sends to cloud | Cloud only | 100% on-premise, zero telemetry, all data stays local |
| **Collaboration** | Shared job library, RBAC | Shared pack library | War room, ChatOps | Shared dashboards | Shared incident view | v1: single admin, lock-based concurrency. v2+: multi-team |

## Sources

- [Deepchecks - Top 10 AIOps Tools for 2026](https://www.deepchecks.com/top-10-aiops-tools-2025/)
- [Aisera - Top 8 AIOps Vendors in 2026](https://aisera.com/blog/top-aiops-platforms/)
- [Softstrix - Rundeck vs StackStorm](https://softstrix.com/rundeck-vs-stackstorm/)
- [DevOpsSchool - Top 10 Runbook Automation Tools](https://www.devopsschool.com/blog/top-10-runbook-automation-tools-features-pros-cons-comparison/)
- [Unite.AI - Agentic SRE: Self-Healing Infrastructure 2026](https://www.unite.ai/agentic-sre-how-self-healing-infrastructure-is-redefining-enterprise-aiops-in-2026/)
- [BigID - Agentic Remediation Guide 2026](https://bigid.com/blog/agentic-remediation-guide/)
- [SiliconANGLE - Human-in-the-loop has hit the wall](https://siliconangle.com/2026/01/18/human-loop-hit-wall-time-ai-oversee-ai/)
- [Medium - Human-in-the-Loop, Guardrails & Safe AI Operations](https://medium.com/cloudops-insider/human-in-the-loop-guardrails-safe-ai-operations-d072145f4c64)
- [Incident.io - Automated post-mortems comparison 2025](https://incident.io/blog/incident-io-vs-firehydrant-vs-pagerduty-automated-postmortems-2025)
- [FireHydrant - AI-Enriched Incident Management](https://firehydrant.com/ai/)
- [Engini.io - Runbook Automation in 2025](https://engini.io/blog/runbook-automation/)
- [Atlassian - ChatOps for incident management](https://www.atlassian.com/incident-management/devops/chatops)
- [Venn - SOC 2 Compliance in 2026](https://www.venn.com/learn/soc2-compliance/)
- [Adyog - Rundeck vs StackStorm Comprehensive Comparison](https://blog.adyog.com/rundeck-vs-stackstorm-a-comprehensive-open-source-automation-comparison/)
- [StackGen - 2026 Forecast: Autonomous Enterprise](https://stackgen.com/blog/2026-forecast-the-autonomous-enterprise-and-the-four-pillars-of-platform-control)

---
*Feature research for: AI IT Operations Platform (InfraBrain)*
*Researched: 2026-03-07*
