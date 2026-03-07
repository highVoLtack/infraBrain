# Architecture Patterns

**Domain:** AI IT Operations Platform (multi-agent, local-first, CLI-driven)
**Researched:** 2026-03-07

## Recommended Architecture

InfraBrain follows a **hub-and-spoke orchestration pattern** with a central Orchestrator Agent coordinating isolated Sub-Agents through a sequential Plan-and-Execute workflow. This is the dominant pattern for IT operations use cases where actions must be deterministic, auditable, and human-approved -- not the collaborative "group chat" pattern used in creative/analytical contexts.

The architecture has seven layers, from user-facing to infrastructure:

```
 CLI Layer (user commands, HITL prompts)
    |
 API Server (REST, command routing, session management)
    |
 Orchestrator (reasoning agent: diagnose, plan, delegate)
    |
 Skill Loader (dynamic Markdown skill resolution)
    |
 Sub-Agent Pool (isolated child processes with fresh LLM contexts)
    |
 Safety Layer (circuit breaker, damage budget, rollback, locks)
    |
 State & Persistence (SQLite + .infrabrain/ files + audit log)
    |
 LLM Abstraction (Ollama default, pluggable providers)
```

### Component Boundaries

| Component | Responsibility | Communicates With | Process Boundary |
|-----------|---------------|-------------------|------------------|
| **CLI** | Parse commands, render output, HITL approval prompts | API Server (HTTP/IPC) | Main process |
| **API Server** | Route commands, manage sessions, expose REST endpoints | CLI, Orchestrator | Main process |
| **Orchestrator** | Diagnose problems, load skills, generate fix plans, delegate tasks | API Server, Skill Loader, Sub-Agent Pool, Safety Layer, State Layer | Main process |
| **Skill Loader** | Resolve which skill files to load, parse Markdown skill definitions, inject into LLM context | Orchestrator, filesystem (`skills/`) | In-process module |
| **Sub-Agent Runner** | Spawn isolated child processes, inject task + skill context, collect results | Orchestrator (via IPC/stdio), LLM Abstraction, Safety Layer | **Separate child process per task** |
| **Safety System** | Enforce circuit breaker thresholds, track damage budget, trigger rollback, manage locks | Orchestrator, Sub-Agent Runner, State Layer | In-process module (cross-cutting) |
| **State Manager** | Dual-write to SQLite (structured queries) and `.infrabrain/` files (human-readable, git-trackable) | All components that persist data | In-process module |
| **Audit Logger** | Append-only decision log with before/after diffs, queryable JSON | State Manager (writes to SQLite + files) | In-process module |
| **LLM Provider** | Abstract interface to local LLM backends (Ollama, vLLM, llama.cpp) | Orchestrator, Sub-Agent Runner | HTTP client to local LLM server |

### Data Flow

**The Core Loop: Diagnose, Plan, Execute, Verify**

```
1. COMMAND INTAKE
   User -> CLI -> API Server -> Orchestrator
   Example: `/infra:debug "Nginx returning 502"`

2. DIAGNOSIS (Orchestrator + large model)
   Orchestrator:
     a. Loads relevant skills via Skill Loader
        (skills/analyzing-logs.md, skills/mapping-infrastructure.md)
     b. Sends diagnostic prompt to LLM (Llama-3.3-70B)
     c. LLM reasons about possible root causes
     d. Orchestrator forms hypotheses
     e. May spawn read-only Sub-Agents to gather system data
        (docker ps, nginx error logs, journalctl)

3. PLANNING (Orchestrator + large model)
   Orchestrator:
     a. Generates FIX_PLAN.md with ordered tasks
     b. Each task: description, risk level, expected outcome, rollback step
     c. Safety Layer validates plan against damage budget
     d. Plan presented to user via CLI for approval
     e. State Manager persists plan to .infrabrain/plans/

4. EXECUTION (Sub-Agents + small model, isolated)
   For each task in plan:
     a. Sub-Agent Runner spawns child process
     b. Child receives: task description + relevant skill + tool permissions
     c. Child uses small model (Qwen2.5-Coder-7B) for execution reasoning
     d. HITL gate: CLI prompts user [Y/N/M] for write operations
     e. Child executes command in sandboxed environment
     f. Result + stdout/stderr returned to Orchestrator via IPC
     g. Safety Layer tracks cumulative actions against damage budget
     h. Audit Logger records: command, before-state, after-state, decision
     i. Lock Manager ensures exclusive access to target resource

5. VERIFICATION (Orchestrator + Sub-Agent)
   Orchestrator:
     a. Spawns verification Sub-Agent with health-check skill
     b. Runs test defined in plan (e.g., curl localhost:80)
     c. Compares actual vs expected outcome
     d. If PASS: mark task complete, proceed to next
     e. If FAIL: circuit breaker increments, retry or escalate
     f. If CIRCUIT BREAK: halt execution, trigger rollback

6. COMPLETION
   Orchestrator:
     a. Summarizes results to user via CLI
     b. State Manager persists final state
     c. Lock Manager releases target lock
     d. Audit trail finalized
```

**Information Flow Direction (strict):**

```
CLI  -->  API Server  -->  Orchestrator  -->  Sub-Agents
                                |                  |
                          Skill Loader        LLM Provider
                                |                  |
                          Safety Layer    (returns via IPC)
                                |
                          State Manager
                           /        \
                     SQLite      .infrabrain/ files
```

- Data flows **inward** (CLI to Orchestrator) for commands
- Data flows **outward** (Orchestrator to CLI) for results and HITL prompts
- Sub-Agents **never** communicate with each other directly
- Sub-Agents **never** access State Manager directly -- results pass through Orchestrator
- Safety Layer is **cross-cutting**: both Orchestrator and Sub-Agent Runner check it

## Patterns to Follow

### Pattern 1: Hub-and-Spoke Orchestration

**What:** A central Orchestrator Agent receives all commands, reasons about them, delegates execution to isolated Sub-Agents, and aggregates results. Sub-Agents never talk to each other.

**When:** Always. This is the core architectural pattern for InfraBrain.

**Why:** IT operations require deterministic, auditable action chains. Hub-and-spoke gives a single coordination point for safety checks, HITL gates, and audit logging. The Orchestrator is the "brain" that maintains the full picture while Sub-Agents are disposable "hands" with narrow context.

**Example:**
```typescript
interface Orchestrator {
  diagnose(input: UserCommand): Promise<Diagnosis>;
  plan(diagnosis: Diagnosis): Promise<FixPlan>;
  execute(plan: FixPlan): Promise<ExecutionResult>;
  verify(plan: FixPlan, result: ExecutionResult): Promise<VerificationResult>;
}

interface SubAgentRunner {
  // Spawns isolated child process with fresh LLM context
  spawn(task: PlanTask, skills: Skill[], permissions: ToolPermissions): Promise<TaskResult>;
  // Kills child process if safety limits hit
  terminate(agentId: string): void;
}
```

**Confidence:** HIGH -- This maps directly to Microsoft's documented "sequential orchestration" pattern and aligns with GSD's sub-agent isolation approach.

### Pattern 2: Process Isolation for Sub-Agents

**What:** Each Sub-Agent runs in a separate Node.js child process with its own LLM context window. The child process receives only the task description, relevant skill content, and a restricted set of tool permissions. It returns structured results via IPC (stdio JSON).

**When:** Every execution task. Diagnosis and planning happen in the Orchestrator's own process.

**Why:** Two critical benefits:
1. **Context isolation** -- prevents context contamination between tasks (the GSD "anti-context-rot" principle). Each Sub-Agent gets a fresh, focused context window.
2. **Blast radius containment** -- a misbehaving Sub-Agent can be killed without affecting the Orchestrator or other tasks. The child process boundary is also the security boundary.

**Example:**
```typescript
// Orchestrator spawns sub-agent as child process
import { fork } from 'child_process';

function spawnSubAgent(task: PlanTask, skillContent: string): Promise<TaskResult> {
  return new Promise((resolve, reject) => {
    const child = fork('./sub-agent-runner.js', [], {
      env: { ...restrictedEnv },
      stdio: ['pipe', 'pipe', 'pipe', 'ipc']
    });

    child.send({
      type: 'execute',
      task: task,
      skill: skillContent,
      permissions: task.riskLevel === 'read-only' ? READ_ONLY : WRITE_WITH_APPROVAL,
      llmConfig: { model: 'qwen2.5-coder:7b', provider: 'ollama' }
    });

    child.on('message', (result: TaskResult) => resolve(result));
    child.on('exit', (code) => {
      if (code !== 0) reject(new Error(`Sub-agent crashed: exit ${code}`));
    });

    // Safety timeout
    setTimeout(() => { child.kill(); reject(new Error('Sub-agent timeout')); }, 120_000);
  });
}
```

**Confidence:** HIGH -- Node.js `child_process.fork()` is battle-tested for process isolation. GSD uses the same sub-agent isolation pattern.

### Pattern 3: Skill-as-Context-Injection

**What:** Skills are Markdown files that get parsed and injected into the LLM prompt as system context. The Skill Loader resolves which skills are relevant based on the task and composes them into the prompt. Skills are NOT code -- they are instructions and tool-call definitions in natural language.

**When:** Before every LLM call (both Orchestrator reasoning and Sub-Agent execution).

**Why:** This is the obra/superpowers pattern adapted for IT operations. Skills define WHAT the AI can do (available tools, procedures, constraints) without hardcoding capabilities. New IT systems are supported by adding a Markdown file, not writing code.

**Example:**
```typescript
interface Skill {
  name: string;           // e.g., "analyzing-logs"
  path: string;           // e.g., "skills/analyzing-logs.md"
  triggers: string[];     // keywords/patterns that activate this skill
  content: string;        // raw Markdown content injected into prompt
  tools: ToolDefinition[]; // tool calls this skill enables
  riskLevel: 'read-only' | 'write' | 'destructive';
}

interface SkillLoader {
  // Resolve which skills are relevant for a given context
  resolve(context: DiagnosticContext): Skill[];
  // Parse a skill Markdown file into structured Skill object
  parse(filePath: string): Skill;
  // Compose multiple skills into a single prompt section
  compose(skills: Skill[]): string;
}
```

**Confidence:** HIGH -- Directly from obra/superpowers architecture, validated in production by the Claude Code ecosystem.

### Pattern 4: Dual-State Persistence (SQLite + Files)

**What:** All state is written to BOTH SQLite (for structured queries, aggregation, dashboards) and `.infrabrain/` directory files (for human readability, git tracking, manual inspection).

**When:** Every state mutation -- plans, execution results, audit entries, system snapshots.

**Why:** Enterprise IT teams need two things: (1) the ability to `SELECT * FROM audit_log WHERE target='nginx' AND risk_level='high'` for compliance, and (2) the ability to `cat .infrabrain/plans/2026-03-07-nginx-502.md` to understand what happened in human terms. Neither alone is sufficient.

**Example:**
```typescript
interface StateManager {
  // Writes to both SQLite and file system atomically
  persist(entry: StateEntry): Promise<void>;
  // Query structured data from SQLite
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  // Read human-readable state from filesystem
  readFile(relativePath: string): Promise<string>;
}

// Directory structure:
// .infrabrain/
//   plans/          -- FIX_PLAN.md files
//   audit/          -- decision log entries (JSON + human summary)
//   snapshots/      -- before/after state diffs
//   locks/          -- active lock files
//   config.yaml     -- runtime configuration
```

**Confidence:** HIGH -- AgentFS (Turso) validates the SQLite-for-agents pattern. The dual-write approach is InfraBrain-specific but well-justified by the enterprise compliance requirement.

### Pattern 5: Traffic-Light HITL Approval

**What:** Every action is classified by risk level. Green (read-only) auto-approves. Yellow (moderate write) notifies. Red (destructive/critical) requires explicit human approval before execution.

**When:** Before every Sub-Agent tool invocation that affects the target system.

**Why:** Enterprise IT cannot tolerate autonomous destructive actions. But requiring approval for `docker ps` would be unusable. The traffic-light system balances safety with usability.

**Example:**
```typescript
type RiskLevel = 'green' | 'yellow' | 'red';

interface HITLGate {
  // Determines approval requirement based on command risk
  classify(command: SystemCommand): RiskLevel;
  // Prompts user if needed, returns decision
  requestApproval(command: SystemCommand, risk: RiskLevel): Promise<'approve' | 'reject' | 'modify'>;
}

// Risk classification examples:
// GREEN (auto-approve): cat, grep, docker ps, systemctl status, curl
// YELLOW (notify + auto): docker restart, systemctl restart
// RED (explicit approval): rm, docker rm, config file edits, iptables changes
```

**Confidence:** HIGH -- Multiple sources document traffic-light approval hierarchies for AI agent safety.

## Anti-Patterns to Avoid

### Anti-Pattern 1: Shared LLM Context Between Tasks

**What:** Reusing the same LLM conversation/context across multiple execution tasks.

**Why bad:** Context contamination. Task 2's execution is influenced by Task 1's irrelevant details, leading to hallucinated connections, wrong tool selections, and unpredictable behavior. This is the "context rot" problem that both GSD and obra/superpowers explicitly solve.

**Instead:** Fresh child process with fresh LLM context per task. The Orchestrator summarizes relevant prior results into a compact handoff, not the raw conversation.

### Anti-Pattern 2: Sub-Agents Communicating Directly

**What:** Letting Sub-Agents send messages to each other or share state without going through the Orchestrator.

**Why bad:** Loses the single coordination point for safety, auditing, and HITL. If Sub-Agent A tells Sub-Agent B to do something, the safety layer and audit log are bypassed. The Orchestrator cannot reason about what is happening.

**Instead:** All inter-task communication flows through the Orchestrator. Sub-Agents are fire-and-forget workers that return results.

### Anti-Pattern 3: Monolithic Safety Checks

**What:** Running all safety checks (circuit breaker, damage budget, locks, HITL) as a single middleware blob.

**Why bad:** Different safety mechanisms trigger at different points in the lifecycle. Circuit breaker triggers after failed verification. Damage budget is checked before AND after execution. HITL is checked before execution. Locks are acquired before and released after. Cramming these into one check creates timing bugs and bypass opportunities.

**Instead:** Safety as a cross-cutting concern with distinct check points:
- **Pre-plan:** Damage budget validates plan is within limits
- **Pre-execution:** Lock acquired, HITL approval obtained
- **During execution:** Timeout enforcement via child process kill
- **Post-execution:** Circuit breaker evaluation, damage budget decrement
- **On failure:** Rollback trigger, lock release

### Anti-Pattern 4: Storing Only Structured Data (SQLite-Only)

**What:** Skipping the human-readable file system and putting everything in SQLite.

**Why bad:** When an admin SSHes into the server at 3 AM during an incident, they need to `cat` a plan file, not write SQL queries. Human-readable state files are a debugging and trust requirement for enterprise IT teams. They also enable git-tracking of all state changes.

**Instead:** Always dual-write. SQLite is the query engine. Files are the human interface.

### Anti-Pattern 5: Hardcoding IT Domain Knowledge

**What:** Building Docker-specific, Nginx-specific, or any system-specific logic into the core engine.

**Why bad:** Destroys the platform's universality. Every new system requires code changes. The entire value proposition of InfraBrain is that the core engine is agnostic and skills teach it new systems.

**Instead:** All IT domain knowledge lives in `skills/` Markdown files. The core engine only knows how to: load skills, reason with an LLM, execute tool calls, and verify results.

## Detailed Component Designs

### LLM Abstraction Layer

```typescript
interface LLMProvider {
  name: string;  // 'ollama', 'vllm', 'llamacpp'

  // Core completion interface
  complete(request: CompletionRequest): Promise<CompletionResponse>;

  // Streaming for long-running diagnosis
  stream(request: CompletionRequest): AsyncIterable<CompletionChunk>;

  // Structured output (JSON schema enforcement)
  completeStructured<T>(request: CompletionRequest, schema: JSONSchema): Promise<T>;

  // Health check
  isAvailable(): Promise<boolean>;

  // Model info
  listModels(): Promise<ModelInfo[]>;
}

interface CompletionRequest {
  model: string;           // e.g., 'llama3.3:70b' or 'qwen2.5-coder:7b'
  systemPrompt: string;    // Composed from skills + task context
  messages: Message[];     // Conversation history (minimal for sub-agents)
  temperature: number;     // Low for execution (0.1), moderate for diagnosis (0.4)
  maxTokens: number;
  responseFormat?: 'json' | 'text';
}

// Model routing strategy:
// - Orchestrator (diagnosis, planning): Llama-3.3-70B (strong reasoning)
// - Sub-Agents (execution): Qwen2.5-Coder-7B (fast, code-focused)
// - Verification: Qwen2.5-Coder-7B (fast checks)
```

The abstraction must handle Ollama's HTTP API (`POST /api/generate`, `POST /api/chat`) as the default, with the interface designed so vLLM (OpenAI-compatible API) and llama.cpp server can be dropped in as alternative providers.

**Confidence:** HIGH -- Ollama's API is stable and well-documented. The provider pattern is standard.

### Safety System (Circuit Breaker + Damage Budget + Rollback)

```typescript
interface CircuitBreaker {
  state: 'closed' | 'open' | 'half-open';
  failureCount: number;
  failureThreshold: number;     // e.g., 3 consecutive failures
  resetTimeout: number;          // e.g., 300_000ms (5 min)

  recordSuccess(): void;
  recordFailure(): void;
  canProceed(): boolean;          // false if circuit is open
  reset(): void;
}

interface DamageBudget {
  maxWriteOperations: number;     // per fix plan, e.g., 10
  maxRestarts: number;            // per fix plan, e.g., 3
  maxConfigEdits: number;         // per fix plan, e.g., 5
  currentUsage: DamageBudgetUsage;

  canExecute(action: SystemAction): boolean;
  record(action: SystemAction): void;
  isExhausted(): boolean;
}

interface RollbackManager {
  // Capture state before execution
  snapshot(target: string): Promise<StateSnapshot>;
  // Restore to snapshot
  rollback(snapshot: StateSnapshot): Promise<RollbackResult>;
  // List available snapshots
  listSnapshots(target: string): Promise<StateSnapshot[]>;
}

// Safety flow:
// 1. Plan created -> DamageBudget.validate(plan) -- reject if plan exceeds budget
// 2. Before each task -> CircuitBreaker.canProceed() -- halt if circuit open
// 3. Before each task -> RollbackManager.snapshot(target) -- capture before-state
// 4. After task failure -> CircuitBreaker.recordFailure()
// 5. If circuit opens -> RollbackManager.rollback(lastGoodSnapshot)
// 6. Alert user via CLI with full context
```

**Confidence:** HIGH -- Circuit breaker is a well-established resilience pattern. Damage budget is a newer AI-safety concept validated by multiple sources.

### Lock Manager

```typescript
interface LockManager {
  // Acquire exclusive lock on a target (e.g., "nginx-server-01")
  acquire(target: string, owner: string, ttl: number): Promise<Lock | null>;
  // Release lock
  release(lockId: string): Promise<void>;
  // Force-release (admin override)
  forceRelease(lockId: string, reason: string): Promise<void>;
  // Check lock status
  status(target: string): Promise<LockStatus>;
  // List all active locks
  listActive(): Promise<Lock[]>;
}

interface Lock {
  id: string;
  target: string;         // e.g., "nginx-server-01", "docker-compose-stack-a"
  owner: string;          // session ID of the fix operation
  acquiredAt: Date;
  ttl: number;            // auto-release after TTL (prevents zombie locks)
  state: 'active' | 'expired' | 'released';
}
```

For v1, locks are stored in SQLite + `.infrabrain/locks/` files. This is single-instance only. If multi-instance becomes needed later, this evolves to file-based advisory locks (flock) or SQLite WAL-based locking. No Redis or distributed locking needed for v1.

**Confidence:** HIGH -- Lock-based concurrency for single-instance is straightforward in Node.js.

## Scalability Considerations

| Concern | v1 (single admin, single target) | Future (multi-admin, multi-target) |
|---------|----------------------------------|-------------------------------------|
| Concurrent fixes | Lock prevents conflicts; one fix at a time per target | Queue-based with priority; multiple targets in parallel |
| LLM throughput | Ollama serves one request at a time | vLLM with batching, or multiple Ollama instances |
| State storage | SQLite handles thousands of entries easily | SQLite remains viable to millions of rows; shard by date if needed |
| Audit log growth | Append-only SQLite table; rotate/archive monthly | Same, with optional export to external SIEM |
| Skill library size | Tens of skills; loaded on-demand | Hundreds of skills; add indexing/tagging for fast resolution |
| Sub-agent count | Sequential, one at a time | Parallel execution with configurable concurrency limit |

## Suggested Build Order (Dependencies)

The architecture has clear dependency chains that dictate build order:

```
Phase 1: Foundation (no dependencies)
  1. LLM Abstraction Layer    -- everything depends on talking to models
  2. State Manager (SQLite + files) -- everything needs persistence
  3. Basic CLI shell           -- need a way to interact

Phase 2: Core Engine (depends on Phase 1)
  4. Skill Loader + Parser     -- Orchestrator needs skills before it can reason
  5. Orchestrator (diagnose + plan) -- the brain, uses LLM + Skills + State
  6. Audit Logger              -- captures Orchestrator decisions

Phase 3: Execution (depends on Phase 2)
  7. Sub-Agent Runner (process isolation) -- needs Orchestrator to delegate to
  8. HITL Gate (traffic-light approval)   -- needed before Sub-Agents execute
  9. Lock Manager                         -- needed before concurrent targets

Phase 4: Safety (depends on Phase 3)
  10. Circuit Breaker           -- needs execution results to evaluate
  11. Damage Budget             -- needs execution tracking
  12. Rollback Manager          -- needs snapshots from before execution

Phase 5: Integration (depends on all above)
  13. API Server (REST)         -- wraps everything for programmatic access
  14. Full CLI commands         -- polished user experience
  15. End-to-end POC scenario   -- Docker/Nginx 502 demo
```

**Critical path:** LLM Abstraction -> Skill Loader -> Orchestrator -> Sub-Agent Runner -> Safety System. This chain must be built sequentially. The CLI and API Server can be developed in parallel with the core engine using stubs.

**Build order rationale:**
- LLM Abstraction first because literally every component needs to talk to models
- State Manager early because it is used by everything for persistence
- Skill Loader before Orchestrator because the Orchestrator is useless without skills to reason with
- Sub-Agent Runner before Safety because safety mechanisms react to execution events
- API Server late because the CLI can call the Orchestrator directly in early phases; the API layer is a formalization, not a prerequisite

## Sources

- [AI Agent Orchestration Patterns - Microsoft Azure Architecture Center](https://learn.microsoft.com/en-us/azure/architecture/ai-ml/guide/ai-agent-design-patterns) -- HIGH confidence, authoritative source for orchestration patterns (sequential, concurrent, hub-and-spoke)
- [obra/superpowers - GitHub](https://github.com/obra/superpowers) -- HIGH confidence, direct inspiration for skill-as-Markdown architecture
- [GSD (Get-Shit-Done) - GitHub](https://github.com/gsd-build/get-shit-done) -- HIGH confidence, direct inspiration for sub-agent isolation and context engineering
- [AgentFS - Turso](https://turso.tech/blog/agentfs) -- MEDIUM confidence, validates SQLite-as-agent-state pattern
- [AI Agent Safety: Circuit Breakers for Autonomous Systems - Syntaxia](https://www.syntaxia.com/post/ai-agent-safety-circuit-breakers-for-autonomous-systems) -- MEDIUM confidence, validates circuit breaker + damage budget patterns
- [AI Agent Kill Switches - Pedowitz Group](https://www.pedowitzgroup.com/ai-agent-kill-switches-practical-safeguards-that-work) -- MEDIUM confidence, validates traffic-light approval and rollback patterns
- [Ollama API Documentation](https://github.com/ollama/ollama/blob/main/docs/api.md) -- HIGH confidence, official API reference
- [Network-AI TypeScript Multi-Agent Orchestrator - GitHub](https://github.com/jovanSAPFIONEER/Network-AI) -- LOW confidence, reference implementation for shared-state agent coordination in TypeScript
- [Architecting AI Agents with TypeScript](https://apeatling.com/articles/architecting-ai-agents-with-typescript/) -- MEDIUM confidence, validates TypeScript agent patterns
