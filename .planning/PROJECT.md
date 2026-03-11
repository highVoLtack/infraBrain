# InfraBrain

## What This Is

A universal, locally-hosted AI operations platform for enterprise IT. InfraBrain is an agnostic "reasoning & execution engine" that learns capabilities through composable Markdown skill files. Admins interact via CLI, the system diagnoses problems, plans fixes, executes them through isolated sub-agents, and verifies results — all running 100% on-premise with local LLMs. Think of it as a new AI-powered IT team member that learns any system through skill files instead of months of onboarding.

## Core Value

The AI diagnoses, plans, and fixes infrastructure problems autonomously while the human admin retains full control — every critical action requires approval, every decision is auditable, and the system can be taught any IT system through simple Markdown files.

## Requirements

### Validated

<!-- Shipped and confirmed valuable. -->

(None yet — ship to validate)

### Active

- [x] Agnostic core engine (Diagnose -> Plan -> Execute -> Verify loop)
- [x] CLI interface with commands like `/infra:debug`
- [x] REST/gRPC API backend powering the CLI
- [x] Composable skills library (Markdown files defining prompts + available tool calls)
- [x] Abstracted LLM provider interface (Ollama default, pluggable for vLLM, llama.cpp, etc.)
- [x] Sub-agent execution with full process isolation (separate LLM context + sandboxed child process)
- [x] Configurable Human-in-the-Loop (risk-based: read-only auto-approves, write commands need approval)
- [x] Dual state storage (human-readable files in .infrabrain/ + SQLite for queryable data)
- [x] Lock-based concurrency (one active fix per target, others see status, force-override available)
- [x] Structured audit trail (decision log + before/after state diffs, queryable JSON)
- [x] Circuit breaker + damage budget safety system (max retries + max blast radius per fix plan)
- [x] Automatic rollback to last-known-good state when safety limits are hit
- [x] Core skills: planning, verification, infrastructure mapping, log analysis
- [x] v1 POC: Docker/Nginx 502 debug scenario (detect, diagnose, fix, verify end-to-end)
- [ ] Standalone binary distribution (via pkg/nexe, no Node.js required)

### Out of Scope

- GraphRAG / Neo4j integration — deferred to future, overkill for v1
- Public skill marketplace — requires community; build after v1 proves the model
- Private skill repositories (enterprise git integration) — future enterprise feature
- OAuth/multi-tenant auth — v1 is single-instance, single-team
- Mobile or web UI — CLI-first, web interface is a future layer
- Cloud-hosted option — privacy-first, 100% on-premise only

## Context

- Inspired by two open-source projects: GSD (context engineering, spec-driven workflows) and obra/superpowers (composable skills library as Markdown)
- Target users: IT admins, SysOps teams, CTOs at enterprises with complex/heterogeneous infrastructure
- The platform pitch: "We deliver the intelligent engine. You teach it your systems through skill files." This solves the B2B customization problem without custom code per client
- Key differentiator vs cloud AI ops tools: 100% local (critical for banks, government, Mittelstand), fully transparent reasoning (Markdown skills, not black-box), human always in the loop
- The v1 demo (Nginx 502 fix) is designed as an investor/customer proof point showing the full Diagnose -> Plan -> Execute -> Verify loop

## Constraints

- **Tech stack**: Node.js/TypeScript — aligns with CLI tooling ecosystem and async patterns
- **LLM runtime**: Must work fully offline with local models via Ollama. Primary model: Qwen 2.5 Coder 32B (specialist for CLI/infrastructure tasks). Custom model name: `infrabrain`
- **Reference hardware**: 1x NVIDIA RTX 5090 (32 GB VRAM). Qwen 32B fits natively — no CPU offloading, real-time inference speed
- **Hardware-matching strategy**: "Domain Expertise over Parameter Count" — IT-Ops is a domain of structured syntax (CLI, logs, configs). A 32B code specialist at full GPU speed with maximum context density outperforms a 70B generalist that requires CPU offloading. Qwen 2.5 Coder is the Technical Lead because it excels at exactly the structured output, shell commands, and config parsing that IT-Ops demands
- **Intelligence Inventory**: 6 models pre-loaded on 200GB RunPod Persistent Network Volume (EU-RO-1, Romania) for zero-download startup. Strategic hierarchy: `infrabrain` (Technical Lead, 32B — default for all structured syntax tasks), `deepseek-r1:32b` (Forensic Specialist — deep CoT debugging), `llama3.3:70b` (Strategic Fallback — broad cross-domain reasoning), `bge-m3` (RAG embeddings), `llama3.2-vision` (visual), `qwen2.5-coder:7b` (lightweight worker). Path: `/workspace/models` via `OLLAMA_MODELS=/workspace/models`
- **High-Density Context**: 32,768 token context window + TOON encoding = effective ~50k+ standard tokens of infrastructure context
- **Distribution**: Standalone binary — admins should not need Node.js installed
- **Privacy**: Zero cloud dependencies, zero telemetry, all data stays local
- **Safety**: No automated action on production systems without explicit safety guardrails (circuit breaker, damage budget, HITL)

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| TypeScript over Python | Better CLI tooling, strong async, closer to GSD/obra ecosystem | — Confirmed |
| CLI + API architecture | API-first enables future clients (web, integrations) while CLI ships first | — Confirmed |
| Abstracted LLM provider | Avoid vendor lock-in to Ollama; enterprises may run vLLM or llama.cpp | — Confirmed |
| Lock-based concurrency | Explicit, easy to reason about for v1; can evolve to queue-based later | — Confirmed |
| Decision log + diffs (no full transcripts) | Auditability without excessive storage; full replay deferred | — Confirmed |
| Circuit breaker + damage budget | Belt-and-suspenders safety; recursive loops are existential risk for infra tools | — Confirmed |
| Alert + rollback on safety halt | Safest default for enterprise; admin can inspect rolled-back state | — Confirmed |
| Both file + SQLite state | Files for human readability/git tracking, SQLite for structured queries | — Confirmed |
| Full sub-agent isolation (LLM + process) | Prevents context contamination AND limits blast radius of execution | — Confirmed |
| TOON encoding for LLM context | Reduce token usage when sending structured data to models; CLI and SQLite stay standard JSON | — Confirmed |
| Qwen 2.5 Coder 32B as Technical Lead | IT-Ops is structured syntax (CLI, logs, configs) — a code specialist dominates this domain. Fits natively in RTX 5090 with full inference speed and max context density | — Confirmed |
| Domain Expertise over Parameter Count | Route by domain fit, not model size. 32B Technical Lead (structured syntax) → DeepSeek-R1 Forensic Specialist (hidden causality) → Llama 70B Strategic Fallback (broad reasoning) | — Confirmed |
| Model-agnostic platform | Intelligence Catalog routes to optimal model per domain expertise. See MODEL_LEADERBOARD.md for strategic hierarchy and provisioned inventory | — Confirmed |
| Multi-model registry (ADR-013) | ModelMap config (default/strategic/forensic), ModelRegistry interface, skill preferred_model routing. Replaces single modelName with domain-expertise-based routing | — Confirmed |
| Session resume with skip/retry | Admin can resume interrupted fix plans; failed steps can be retried or skipped | — Confirmed |
| JSON envelope for all CLI output | Consistent { ok, command, data, error } shape enables scripting and CI integration | — Confirmed |
| Parameterized SQL for audit queries | No string concatenation in SQL; prevents injection in queryable audit log | — Confirmed |

## Phase 6+ Strategic Roadmap

> **Hard constraint**: Primary data path is always 100% local. Cloud resources are ephemeral, optional, zero data residue. All enterprise data stays on-premise.

---

### 1. Elastic Intelligence Brokerage

**Problem**: Local 70B models will hit reasoning ceilings on complex multi-system problems. The system needs to know when it's not smart enough and escalate autonomously.

**Architecture**:

```
┌─────────────────────────────────────────────────────┐
│  Orchestrator (existing debug route)                │
│                                                     │
│  ┌───────────────┐    ┌──────────────────────────┐  │
│  │ Confidence     │───▶│ Intelligence Catalog     │  │
│  │ Monitor        │    │ (JSON config)            │  │
│  │                │    │                          │  │
│  │ Hooks into     │    │ domain expertise routing: │  │
│  │ generateObject │    │  structured.* → qwen-32b │  │
│  │ response       │    │  forensic.*  → r1-32b    │  │
│  │ quality score  │    │  broad.*     → llama-70b │  │
│  └───────────────┘    └──────────┬───────────────┘  │
│                                  │                   │
│                     ┌────────────▼────────────────┐  │
│                     │ Cost Estimator              │  │
│                     │ - queries RunPod/Lambda API │  │
│                     │ - calculates $/hour         │  │
│                     │ - presents HITL prompt:     │  │
│                     │   "Local: 20% chance,       │  │
│                     │    405B: 90%, cost: 1.50€.  │  │
│                     │    Proceed? [Y/N]"          │  │
│                     └────────────┬───────────────┘  │
│                                  │ (if approved)     │
│                     ┌────────────▼────────────────┐  │
│                     │ JIT Provisioner             │  │
│                     │ - RunPod API / Lambda API   │  │
│                     │ - spawn GPU pod             │  │
│                     │ - deploy model (Ollama/     │  │
│                     │   vLLM on remote)           │  │
│                     │ - route LLM calls via       │  │
│                     │   existing provider         │  │
│                     │   abstraction               │  │
│                     │ - terminate on completion   │  │
│                     └─────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

**Key implementation details**:
- `ConfidenceMonitor` — wraps `generateObject`/`generateText` calls. Evaluates response quality via structured self-assessment (ask the model "rate your confidence 1-10" as a follow-up call, or parse hedging language)
- `IntelligenceCatalog` — JSON config file mapping `{domainExpertise, problemType}` → `{modelId, minGPU, estimatedCostPerHour}`. Routes by domain expertise (structured syntax → Technical Lead, hidden causality → Forensic Specialist, broad reasoning → Strategic Fallback), not model size. Admin-editable, ships with sensible defaults
- `JITProvisioner` — implements `LLMProvider` interface (already abstracted in v1). Just a new provider that spins up a remote vLLM instance before forwarding calls. Tears down after session ends

**Escalation paths (validated via research, March 2026)**:

| Path | How | Latency | Cost | Quality |
|------|-----|---------|------|---------|
| **Serverless API** (Default) | DeepInfra / Together AI / Fireworks | Instant (no cold-start) | $0.80-3.50/M tokens | Full 405B quality |
| **RunPod Serverless** | vLLM on 2xH200, pre-cached model via network volume | 15-60s cold-start (FlashBoot) | $7.98/hr (~$4/M tokens) | Full quality, self-hosted |
| **RunPod On-Demand** | vLLM on 4xH100 pod | 15-60s cold-start | $12-18/hr | Full quality, self-hosted |
| **Cerebras** | API call | Instant | $6-12/M tokens | 969 tok/s (fastest available) |

**Eliminated paths (research invalidated)**:
- ~~AirLLM on single A40~~: Sub-1 tok/s, unmaintained since Aug 2024, no production usage. Not viable.
- ~~Q2_K quantization for 405B~~: 15-30% quality degradation. A 70B@Q4 outperforms 405B@Q2 on most benchmarks while using half the hardware. Dead end.
- ~~Lambda Labs for JIT~~: 2-5 min cold-start (VM provisioning, not serverless). Only viable for sustained workloads, not JIT spin-up-and-tear-down.

**Recommended default**: Serverless API (DeepInfra at $0.80/M tokens) for most escalations. RunPod Serverless only when data sovereignty requires self-hosted inference. Self-hosting 405B only economical above 10B+ tokens/month.

**Builds on v1**: Existing `LLMProvider` abstraction, HITL approval gate, session management. JIT provisioner is just another provider implementation.

---

### 2. TOON as Cross-Layer Data Bus

**Problem**: When escalating to remote models (JIT swarm) or correlating across domains, the full infrastructure context must be transferred efficiently. JSON wastes 40-60% of tokens on syntax.

**High-Density Context Strategy (32k + TOON)**:
- Reference hardware: 1x RTX 5090 (32 GB VRAM), Qwen 2.5 Coder 32B, context window 32,768 tokens (~28-31 GB total)
- TOON's 40-60% token savings on structured data means 32k tokens carry the information density of ~50k-80k standard JSON tokens
- Full Docker network topology + Nginx error logs + config files + prior diagnosis results all fit in a single prompt
- No CPU offloading needed — model fits natively in single GPU at real-time inference speed

**Architecture**:
- TOON encoder (already built in v1) becomes the serialization format for all inter-agent communication
- When JIT provisioner routes a call to a remote model, the entire session context (logs, configs, topology, prior diagnosis) is TOON-encoded before transfer
- Cross-domain correlation: when multiple skills produce findings, their outputs are TOON-merged into a single dense context object for the orchestrator

**Implementation path**:
- v1 TOON encoder already handles `Record`, `Array`, flat objects
- Extend with `toonMerge(findings: ToonPayload[])` — combines multiple skill outputs into one context block
- Add `toonEstimateTokens(payload)` — pre-flight check before sending to remote model to verify it fits in context window
- Wire into `JITProvisioner.complete()` — auto-encode context before remote call

**No new dependencies**. Pure extension of existing `src/toon/` module.

---

### 3. Intelligence Forge (LoRA Distillation Pipeline)

**Problem**: Each customer domain (SAP, Cisco, VMware) needs specialized knowledge. Shipping a generic 70B to every customer means mediocre performance across the board.

**Pipeline**:

```
Raw Enterprise Docs          Permissive Teacher LLM        Local Training
(SAP manuals, Cisco          (Llama/Qwen/Mistral in       (unsloth, QLoRA)
 runbooks, internal          controlled lab — NOT at
 wikis)                      customer site)
     │                            │                            │
     ▼                            ▼                            ▼
┌─────────┐    upload    ┌──────────────┐   export    ┌──────────────┐
│ Document │────────────▶│ Scenario     │────────────▶│ LoRA Module  │
│ Corpus   │             │ Generator    │             │ (.safetensors│
│          │             │              │             │  ~60-240MB)  │
│ PDFs,    │             │ Generates:   │             │              │
│ Markdown,│             │ - diagnosis  │             │ Hot-swap via │
│ HTML     │             │   scenarios  │             │ vLLM per-    │
│          │             │ - skill files│             │ request      │
│          │             │ - Q&A pairs  │             │ adapter      │
│          │             │ - edge cases │             │ selection    │
└─────────┘             └──────────────┘             └──────────────┘
```

**Key implementation details (validated via research, March 2026)**:
- **Scenario Generator** — standalone Node.js script (not part of runtime). Takes document corpus + domain descriptor, calls teacher LLM API, outputs JSONL training data in InfraBrain's skill format
- **Two-Stage Distillation (legally clean Data Provenance)**:
  - **Stage 1 — Claude as Curriculum Architect**: Claude Opus designs training structure — scenario outlines, logic points, diagnostic decision trees, skill templates. This is "user-generated content with tool assistance" (legally safe). Example: "To debug SAP HANA, we need 500 scenarios — here are the headings and logic points."
  - **Stage 2 — Llama 405B as Writer**: Feed curriculum to Llama 3.1 405B on JIT RunPod. Llama generates the actual training data. All data has clean provenance: generated by permissive open model (Llama Community License).
  - **Result**: Brilliance from Claude (planning), substance from Llama (data). Clean provenance: "Our engine uses Llama-based intelligence, legally trained on our own servers."
  - **Phase 1-5 (POC)**: Use Claude freely for Markdown skills — user-generated content, not distillation
  - **Phase 6+ (Scaling)**: Llama 405B on RunPod for Expert Pack training data. Claude designs the training strategy, Llama writes the data
- **Training** — `unsloth` is recommended (2x faster than axolotl, custom Triton kernels). QLoRA on 70B base: ~4h on A100 80GB for 10k samples. **Single A40 48GB is extremely tight** (38-46GB just for weights) — budget for 2x A40s with FSDP+QLoRA (Answer.AI pattern) or single A100 80GB
- **Delivery** — LoRA files distributed as "Expert Packs":
  - Rank-16: ~60 MB per adapter
  - Rank-32: ~120 MB
  - Rank-64: ~243 MB
  - Dozens fit in GPU memory simultaneously alongside the base model
- **Serving engine: vLLM (NOT Ollama)**. Ollama does not support LoRA hot-swapping (GitHub issue #9548, still open). vLLM has first-class multi-LoRA support:
  - Launch with `--lora-modules name1=path1 name2=path2`
  - Per-request adapter selection via `model` field in OpenAI-compatible API
  - LRU cache keeps adapters in CPU memory, swaps to GPU on demand
  - S-LoRA demonstrated 2,000 concurrent adapters on a single GPU
  - Throughput penalty: ~10-50% vs merged model (acceptable for multi-expert flexibility)
- **Hot-swap at runtime** — InfraBrain's `LLMProvider` routes to vLLM instead of Ollama for LoRA-enabled deployments. `IntelligenceCatalog` maps `{domain} → {baseModel + loraAdapter}`. On skill selection, the `model` field in the API call switches the adapter — zero restart, zero reload

**Separation of concerns**: The Forge runs in our lab, never at the customer. Customer only receives the finished LoRA. Raw docs never leave the customer's network (they send anonymized/sanitized extracts, or we run the Forge on-site in air-gapped mode).

**Open questions**:
- Minimum training data volume per domain (estimate: 1-5k high-quality scenarios)
- LoRA merging vs hot-swap decision per deployment (merged = max throughput, hot-swap = max flexibility)
- Legal review of Anthropic/OpenAI ToS for synthetic data generation

---

### 4. Knowledge Architecture: Skills + Vector DB (RAG)

**Problem**: Markdown skills encode procedural knowledge ("how to fix X"). But diagnostic reasoning often needs declarative knowledge ("what does error 0x88 mean in SAP HANA 2.0 SP05?"). That lives in 5000-page manuals.

**Two knowledge layers**:

| Layer | Storage | Content | Access Pattern |
|-------|---------|---------|----------------|
| Procedural | Markdown skills (existing `skills/` dir) | Action recipes, tool allowlists, system prompts | Loaded by skill selector at runtime |
| Declarative | Local vector DB (Qdrant or ChromaDB) | Vendor docs, internal wikis, runbooks, config references | Semantic search → top-k retrieval → inject into prompt |

**Implementation path (validated via research, March 2026)**:
- **Embedding model**: `bge-m3` via Ollama (`ollama pull bge-m3`). 568M params, 1024-dim output, 8192 token context. ~1.0 GB VRAM (float16), ~0.6 GB quantized. Embedding speed: ~100-300 docs/sec on GPU. MTEB score 63.0 (vs OpenAI 64.6 — only 2% behind, fully local, MIT license)
- **Vector DB**: **Qdrant** (Rust, single binary ~80MB, production-ready). Skip ChromaDB (Python-only, no quantization, caps at ~1M vectors). Skip sqlite-vec/sqlite-vector (brute-force search, 500-1000ms at 1M vectors — unacceptable)
  - RAM for 1M x 1024-dim vectors with scalar quantization (int8): **~1.4 GB**
  - Query latency: **1-5 ms** for top-10 retrieval on NVMe
  - Supports on-disk vectors with quantized representations in RAM
  - Native hybrid search via sparse vectors (BM25/SPLADE alongside dense vectors in same collection)
- **Ingestion pipeline**: New `src/knowledge/ingest.ts` module
  - Accepts: PDF, Markdown, HTML, plain text
  - Chunking: recursive 512-token chunks with 10-20% overlap (NAACL 2025: fixed chunks match or beat semantic chunking)
  - Contextual chunk headers: prepend document title + section to each chunk (significant quality gain)
  - Calls local embedding model → stores dense + sparse vectors + metadata in Qdrant
  - Initial ingestion for 1M pages: **~8-24 hours** on single GPU (parse + chunk + embed). Incremental updates via content-hash diffing
- **RAG integration**: New `src/knowledge/retrieve.ts`
  - **Hybrid search**: BM25 sparse + dense semantic (79% accuracy vs 65% vector-only)
  - **Reranking**: Cross-encoder (bge-reranker-v2-m3) after top-50 retrieval → 91% accuracy. Adds ~50ms latency
  - `retrieve(query: string, topK: number): Promise<Chunk[]>`
  - Results TOON-encoded and injected into the skill's system prompt as `## Reference Context`
  - Full latency budget: BM25 ~5ms + vector ~5ms + reranking ~50ms + LLM ~500-2000ms = **~600-2100ms total**
- **Storage**: NVMe SSD. 1M document pages (~10M chunks):
  - Dense vectors with int8 quantization: ~10 GB
  - HNSW index: ~5-15 GB
  - BM25/sparse index: ~2-5 GB
  - Metadata + payloads: ~2-4 GB
  - **Total: ~25-40 GB on NVMe** (not "a few GB" — corrected from earlier assumption)
  - RAM for serving: ~3-6 GB with on-disk vectors + quantized index in RAM

**VRAM budget (reference: 1x RTX 5090, 32 GB)**:

| Component | VRAM | Notes |
|-----------|------|-------|
| Qwen 2.5 Coder 32B Q4_K_M | ~18-20 GB | Base model weights |
| KV cache (32k context) | ~8-10 GB | Scales with context window |
| BGE-M3 embeddings | ~1 GB | Only when RAG active (dynamic load/unload) |
| **Total** | **~28-31 GB** | Fits in 32 GB, no CPU offloading |

The 32k context window fits comfortably: combined with TOON encoding (40-60% token savings), it provides effective coverage equivalent to ~50k+ standard JSON tokens. Full Docker network topology + Nginx logs + config files + prior diagnosis all fit in a single prompt at full GPU inference speed.

**Builds on v1**: Skill system prompt injection (existing `## sections`), TOON encoding, Ollama provider (just add embedding model)

---

### 5. Horizontal Expansion: New Domains

The v1 DPEV loop (Diagnose → Plan → Execute → Verify) and skill system are domain-agnostic by design. New domains = new skill files + new tool allowlists.

**Domain: IT-Ops** (v1.0 — shipped)
- Docker, Nginx, Linux, databases, networking
- Skills: `nginx-diagnose`, `docker-debug`, `planning`, `verification`

**Domain: Dev-Assistant**
- New skills: `code-review`, `refactor-plan`, `dependency-audit`, `migration-plan`
- Tool allowlist: `git`, `grep`, `find`, `diff`, `npm/yarn/pnpm` (READ-only by default)
- Key feature: cross-repo context via RAG (ingest all repos into vector DB, retrieve relevant code during diagnosis)
- WRITE operations (code changes, PRs) go through same HITL approval gate

**Domain: First-Level Support** (validated via research, March 2026)
- New skills: `outlook-diagnose`, `vpn-debug`, `ad-auth-check`, `printer-fix`
- Tool allowlist: `powershell`, `ldapsearch`, `ping`, `nslookup`, `Test-NetConnection`, `Get-Service`, `Get-WinEvent`
- Diagnostic Ladder reused from v1 but applied to client machines
- Example: "Outlook won't receive" → 1. DNS resolution check → 2. Exchange connectivity → 3. AD auth status → 4. Profile integrity → 5. Fix + verify

**Remote execution architecture — Agent-based model (NOT WinRM)**:
- ~~WinRM from Node.js~~: **Not viable.** All npm packages (nodejs-winrm, winrmjs, node-winrm) are abandoned (5-8 years unmaintained). None support Kerberos auth (mandatory in enterprise AD). Basic auth over HTTP is a security non-starter.
- ~~SSH on Windows~~: Possible but OpenSSH Server not enabled by default until Windows Server 2025. Requires GPO rollout across fleet. Viable as Tier-2 option for servers only.

**Recommended: InfraBrain Agent (lightweight client-side daemon)**:
```
InfraBrain Server <─── WSS (outbound only) ─── InfraBrain Agent
   (Node.js)           no inbound ports              │
                       needed on client        ┌─────┴──────┐
                                               │ node-windows│
                                               │ service     │
                                               │             │
                                               │ - allow-list│
                                               │   execution │
                                               │ - audit log │
                                               │ - user ctx  │
                                               │ + system ctx│
                                               └─────────────┘
```
- **Why this wins**: Outbound WebSocket = no inbound ports on clients (bypasses #1 enterprise firewall blocker). No WinRM/SSH dependency. Works across Windows/Linux/macOS with same codebase.
- **Stack**: `node-windows` (npm, runs Node.js as Windows Service via winsw, no node-gyp), `ws` (WebSocket client), MSI deployment via GPO/SCCM/Intune
- **Two agent contexts**: System-level service (for admin tasks like service restart) + user-level tray agent (for user-profile tasks like Outlook repair on HKCU)
- **Security**: Commands restricted to documented allow-list (same pattern as v1 safety validator). Certificate-pinned TLS. Every command audit-logged. Dedicated least-privilege service account.
- **Enterprise acceptance**: This is the industry standard pattern (SaltStack salt-minion, Zabbix Agent, Datadog Agent, every RMM tool)
- **Linux/macOS**: SSH via `ssh2` (npm, 10M+ weekly downloads, pure JS). Servers already have SSH. Key-based auth with SSH CA. Watch for: sudo elevation (NOPASSWD sudoers for specific commands), bastion/jump hosts, MaxSessions limit (default 10)

**Cross-domain correlation**:
- When multiple domains have concurrent findings, orchestrator merges via TOON data bus
- Example: Dev says "code OK", Ops says "CPU OK", Support says "10 Munich users have VPN issues" → orchestrator correlates → "Munich router is the root cause"
- Implementation: new `src/correlation/cross-domain.ts` — takes `DiagnosisResult[]` from multiple skills, feeds merged TOON context to orchestrator for final analysis

---

### 6. Onboarding & Self-Learning System

**Discovery Wizard** (`/infra:setup`):
1. **Infrastructure scan**: Run mapping skill (existing Phase 2) to auto-detect hosts, services, network topology
2. **Domain selection**: Interactive checklist — [x] IT-Ops [x] Support [x] Dev
3. **Knowledge ingestion**: Point at doc sources (file paths, git repos, wiki URLs) → trigger RAG ingestion pipeline
4. **LoRA selection**: Based on detected stack, download matching Expert Packs from registry

**Self-learning feedback loop**:
- When admin corrects a fix or performs manual action during a session, InfraBrain logs the delta between its plan and the actual fix
- Post-session: generates a candidate Markdown skill from the correction
- Presents to admin: "I created a draft skill from your fix. Review and approve? [Y/N]"
- Approved skills go into `skills/learned/` directory — version-controlled, auditable
- Implementation: new `src/learning/skill-generator.ts` — takes `{originalPlan, actualCommands, outcome}` → generates skill Markdown

---

### 7. UX Backlog

- `/infra:history` defaults to most recent session when no `--session` ID provided
- Support `--session last` alias → resolves to latest session_id in SQLite
- Tab-completion for `--session` flag (zsh/bash completions, show last 3 sessions)
- Post-fix summary always prints copyable session reference: `Audit: /infra:history --session abc-123`

---

### 8. Architecture Pattern: Cognitive Specialization via Skill Splitting

Diagnosis and fix skills are deliberately separated (e.g., `nginx-diagnose` + `nginx-fix`):

1. **Focused context**: Diagnosis agent uses full context window for root cause analysis without fix-planning noise. Fix agent gets a clean briefing (TOON-encoded diagnosis result) and focuses on command precision
2. **Model routing**: Qwen 2.5 Coder 32B handles both diagnosis and execution natively on 1x RTX 5090. Future option: route execution-only steps to a smaller Qwen 7B for parallel throughput
3. **Handover checkpoint**: The diagnosis-to-fix handover is an explicit TOON document. Admin can inspect diagnosis quality before fix agent runs. Natural error brake — bad diagnosis is caught at the boundary, not after execution

This pattern scales to all new domains. Every domain gets `{domain}-diagnose` + `{domain}-fix` skill pairs.

---

### Business Model

| Revenue Stream | Description |
|---------------|-------------|
| Core License | InfraBrain engine (standalone binary), per-instance |
| Expert Packs | Pre-trained LoRA modules per domain (SAP, Cisco, VMware, etc.), subscription |
| Skill Libraries | Curated Markdown skill packs per domain, one-time or subscription |
| JIT Compute | Margin on cloud-bursted GPU compute via Elastic Intelligence Brokerage |

---

### Research Validation Log (2026-03-11)

Deep research conducted across 4 domains with 50+ sources. Key corrections applied to this roadmap:

| Original Assumption | Research Finding | Action Taken |
|---|---|---|
| AirLLM for 405B on single A40 | Sub-1 tok/s, unmaintained since Aug 2024, no production use | Eliminated from roadmap |
| Q2_K quantization for 405B | 15-30% quality loss; 70B@Q4 outperforms 405B@Q2 | Eliminated from roadmap |
| Ollama for LoRA hot-swap | No hot-swap support (Issue #9548 open) | Switched to vLLM |
| Claude Opus as teacher for LoRA training | ToS legal risk for competitive distillation | Two-Stage: Claude as Curriculum Architect (legal), Llama 405B as Data Writer (clean provenance) |
| Training on single A40 48GB | 38-46GB just for weights, extremely tight | Budget for 2x GPUs or A100 80GB |
| 1M doc pages = "a few GB" | 25-40 GB with quantization, 55-70 GB without | Corrected storage estimates |
| WinRM from Node.js for remote execution | All npm packages abandoned, no Kerberos support | Switched to agent-based model |
| ChromaDB as vector DB option | No quantization, caps at ~1M vectors, Python-only | Removed, Qdrant only |
| Lambda Labs for JIT provisioning | 2-5 min cold-start (VM, not serverless) | Demoted, RunPod/API preferred |

---
*Last updated: 2026-03-11 — v1.0.0 battle-proven (Nginx 502 POC verified), Phase 6+ roadmap validated via deep research*
