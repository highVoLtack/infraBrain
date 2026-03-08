# Phase 3: Execution Engine and Safety Net - Research

**Researched:** 2026-03-08
**Domain:** Process execution, safety systems, concurrency control (Node.js/TypeScript)
**Confidence:** HIGH

## Summary

Phase 3 transforms InfraBrain from a diagnosis/planning tool into an execution engine. The core challenge is executing shell commands through isolated child processes while maintaining strict safety guarantees: circuit breaker, damage budget, automatic rollback, and target locking. All user decisions from CONTEXT.md are highly prescriptive -- the architecture is locked down.

The existing codebase provides strong foundations: `FixStep`/`FixPlan` types with command, rollback, and risk fields; `RiskLevel` enum for damage budget scoring; `requestApproval` for HITL gates; `WriteThrough` for dual-write persistence; `AuditLogger` for structured event logging; and session management with directory structure. The execution engine is essentially the missing piece that connects plan generation (Phase 2) to actual command execution.

**Primary recommendation:** Build the execution engine as a pipeline of pure-ish modules (executor, circuit breaker, damage budget, snapshot manager, lock manager) that compose together in the main execution loop. Use `node:child_process.execFile` with `util.promisify` and `AbortController` for command isolation. Keep all state in files first (existing pattern), extend `SessionState` and `AuditEventType` for new events.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Each command runs via `child_process.execFile` as safe default (no shell injection risk, captures stdout/stderr separately, timeout support)
- Shell mode (`spawn` with shell) available for commands that need pipes/redirects, but only with HITL approval
- Same model (Llama 3.3 70B) for both orchestrator and sub-agents
- Sub-agents execute commands exactly as planned -- no adaptation or re-planning on failure
- Rolling context within plan: each step sees results of prior steps, automatic context compression when token budget gets tight
- Circuit breaker: 3 retries per step (configurable in .infrabrain/config.json), then halt entire plan and alert admin
- Damage budget: WRITE=1pt, DESTRUCTIVE=2pts, READ=free. Default budget: 10 per plan (configurable). Failed retries consume double
- When damage budget exceeded: full halt, admin reviews manually
- Alert mechanism: bold red CLI warning + full details in audit.jsonl. No external notifications in v1
- On safety trigger: roll back only the failing step. Previous successful steps stay applied
- Pre-execution state snapshots via command output capture (READ command before WRITE/DESTRUCTIVE)
- If rollback fails: log CRITICAL, alert admin, no automatic retry
- Rollback commands are auto-approved (no HITL gate)
- Per-target locking via file-based locks: `.infrabrain/locks/{target}.lock`
- Force-override via typed confirmation (same pattern as destructive command approval)
- Stale lock detection: timeout-based (default 1 hour, configurable)

### Claude's Discretion
- Exact READ command to run for state snapshot capture per command type
- Context compression strategy (how to summarize prior step results)
- Lock file JSON schema (metadata beyond session ID, admin, timestamp)
- Error message formatting for circuit breaker and damage budget alerts
- How to derive target identifier from diagnosis/fix plan

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| CORE-06 | Orchestrator executes Diagnose->Plan->Execute->Verify loop end-to-end | Execution engine pipeline connects after plan approval in debug route; step-by-step executor with rolling context |
| CORE-07 | Each sub-agent task runs in a separate LLM conversation with isolated context | Rolling context builder: each step gets own LLM call with summarized prior results, not shared conversation |
| CORE-08 | Each sub-agent task runs in a sandboxed child process (execFile/spawn, no shell) | `util.promisify(child_process.execFile)` with timeout, maxBuffer, AbortController; shell mode via spawn with HITL gate |
| SAFE-04 | Circuit breaker halts execution after max retries per task | CircuitBreaker class tracking per-step failure count, configurable maxRetries, halts entire plan on threshold |
| SAFE-05 | Damage budget limits total state changes per fix plan | DamageBudget class tracking cumulative cost (WRITE=1, DESTRUCTIVE=2, READ=0), halts when exceeded |
| SAFE-06 | Failed retries consume double the damage budget | On retry failure: deduct 2x the normal cost from damage budget |
| SAFE-07 | System captures pre-execution state snapshot before every write operation | SnapshotManager runs corresponding READ command before each WRITE/DESTRUCTIVE, stores output as JSON in session snapshots/ |
| SAFE-08 | System automatically rolls back to last-known-good state when safety limits trigger | Execute rollback command from FixStep.rollback, auto-approved (no HITL), CRITICAL log if rollback fails |
| SAFE-12 | System alerts admin when circuit breaker or damage budget triggers | Bold red chalk CLI warnings + structured audit events (circuit_breaker_triggered, damage_budget_exceeded) |
| INTF-08 | Lock system prevents concurrent fixes on same target | File-based lock at .infrabrain/locks/{target}.lock with JSON metadata, checked before execution starts |
| INTF-09 | Admin sees "fix in progress by [admin]" when target is locked | Lock file contains session ID, admin name, timestamp; display in CLI when lock conflict detected |
| INTF-10 | Admin can force-override a lock with explicit confirmation | Typed confirmation pattern (reuse from destructive approval); admin types target name to override |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| node:child_process | Node.js built-in | execFile/spawn for command execution | No external dependency; execFile avoids shell injection; AbortController for cancellation |
| node:util | Node.js built-in | promisify(execFile) for async/await | Clean async interface matching project's Promise-based patterns |
| chalk | ^5.6.2 | Bold red CLI alerts for safety triggers | Already in project dependencies |
| zod | ^4.3.6 | Schema validation for lock files, config extensions, execution state | Already used throughout project |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| better-sqlite3 | ^12.6.2 | Queryable index for execution state and lock records | Already in project; extend audit_log schema for new event types |
| uuid | ^13.0.0 | Session IDs for lock metadata | Already in project |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hand-rolled circuit breaker | opossum/cockatiel | Overkill for this use case -- InfraBrain's circuit breaker is per-step retry counting, not service-call wrapping. 20 lines of code vs. a dependency |
| Hand-rolled file locks | proper-lockfile | proper-lockfile uses mkdir atomicity which is good, but project decision is explicit JSON lock files with metadata. Hand-roll is simple and gives full control over schema |
| node:child_process | execa | execa adds nice ergonomics but project explicitly chose execFile/spawn. No need for another dependency |

**Installation:**
```bash
# No new dependencies needed -- everything uses existing packages + Node.js built-ins
```

## Architecture Patterns

### Recommended Project Structure
```
src/
├── execution/
│   ├── executor.ts          # Main execution loop: iterate FixPlan steps
│   ├── runner.ts            # Low-level command runner (execFile/spawn wrapper)
│   ├── circuit-breaker.ts   # Per-step retry tracking, halt logic
│   ├── damage-budget.ts     # Cumulative cost tracking, halt logic
│   ├── snapshot.ts          # Pre-execution state capture
│   ├── rollback.ts          # Rollback execution on safety trigger
│   ├── context-builder.ts   # Rolling LLM context with compression
│   └── types.ts             # ExecutionState, StepResult, SnapshotRecord, etc.
├── locks/
│   ├── manager.ts           # Acquire, release, check, force-override locks
│   └── types.ts             # LockFile schema, LockStatus
├── config/
│   └── types.ts             # Extend with circuitBreaker + damageBudget sections
```

### Pattern 1: Promisified execFile with Timeout and AbortController
**What:** Wrap `child_process.execFile` in a promise-based runner with configurable timeout and abort support.
**When to use:** Every command execution in the plan.
**Example:**
```typescript
// Source: Node.js official docs (https://nodejs.org/api/child_process.html)
import { promisify } from 'node:util';
import { execFile as execFileCb } from 'node:child_process';

const execFile = promisify(execFileCb);

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export async function runCommand(
  command: string,
  args: string[],
  options: { timeout: number; maxBuffer?: number }
): Promise<RunResult> {
  const controller = new AbortController();
  try {
    const { stdout, stderr } = await execFile(command, args, {
      timeout: options.timeout,
      maxBuffer: options.maxBuffer ?? 1024 * 1024,
      signal: controller.signal,
    });
    return { stdout, stderr, exitCode: 0 };
  } catch (err: any) {
    return {
      stdout: err.stdout ?? '',
      stderr: err.stderr ?? '',
      exitCode: err.code ?? 1,
    };
  }
}
```

### Pattern 2: Command String Parsing for execFile
**What:** Parse a command string into executable + args array for execFile (which requires them separately).
**When to use:** FixStep.command is a string like "docker inspect nginx" -- must split into `execFile('docker', ['inspect', 'nginx'])`.
**Example:**
```typescript
/**
 * Parse a command string into executable and arguments.
 * Handles basic quoting. For complex pipes/redirects, use shell mode.
 */
export function parseCommand(command: string): { executable: string; args: string[] } {
  // Simple split on whitespace, respecting quoted strings
  const tokens: string[] = [];
  let current = '';
  let inQuote: string | null = null;

  for (const char of command) {
    if (inQuote) {
      if (char === inQuote) { inQuote = null; }
      else { current += char; }
    } else if (char === '"' || char === "'") {
      inQuote = char;
    } else if (char === ' ' || char === '\t') {
      if (current) { tokens.push(current); current = ''; }
    } else {
      current += char;
    }
  }
  if (current) tokens.push(current);

  return { executable: tokens[0], args: tokens.slice(1) };
}
```

### Pattern 3: Pipeline Composition for Execution Loop
**What:** The main execution loop composes safety checks as a pipeline: lock check -> damage budget check -> snapshot -> approval -> execute -> update context.
**When to use:** The core executor that iterates through FixPlan steps.
**Example:**
```typescript
export async function executePlan(
  plan: FixPlan,
  deps: ExecutionDeps,
): Promise<ExecutionResult> {
  const context = new RollingContext();
  const budget = new DamageBudget(deps.config.damageBudget);
  const breaker = new CircuitBreaker(deps.config.circuitBreaker);

  for (let i = 0; i < plan.steps.length; i++) {
    const step = plan.steps[i];
    const risk = step.risk; // 'read' | 'write' | 'destructive'

    // 1. Check damage budget before execution
    const cost = budget.costFor(risk);
    if (!budget.canAfford(cost)) {
      await handleBudgetExceeded(plan, i, deps);
      return { status: 'halted', reason: 'damage_budget_exceeded', stoppedAt: i };
    }

    // 2. Capture pre-execution snapshot for write/destructive
    let snapshot: SnapshotRecord | undefined;
    if (risk !== 'read') {
      snapshot = await captureSnapshot(step, deps);
    }

    // 3. Request approval (READ=auto, WRITE=Y/n, DESTRUCTIVE=typed)
    const approval = await deps.requestApproval(step.command, risk);
    if (!approval.approved) {
      return { status: 'rejected', stoppedAt: i };
    }

    // 4. Execute with circuit breaker retry logic
    const result = await breaker.execute(step, async () => {
      return await deps.runner.run(step.command);
    }, budget);

    if (result.status === 'circuit_open') {
      // Rollback this step, halt plan
      await rollbackStep(step, snapshot, deps);
      return { status: 'halted', reason: 'circuit_breaker', stoppedAt: i };
    }

    // 5. Deduct from damage budget
    budget.deduct(cost);

    // 6. Update rolling context
    context.addStepResult(i, step, result);
  }

  return { status: 'completed' };
}
```

### Pattern 4: File-Based Lock with JSON Metadata
**What:** Lock files stored as JSON in `.infrabrain/locks/{target}.lock` with metadata for visibility.
**When to use:** Before starting execution on any target.
**Example:**
```typescript
export interface LockFile {
  target: string;
  sessionId: string;
  adminName: string;
  createdAt: string;
  pid: number;
  planSummary: string;
}

export function acquireLock(target: string, lockDir: string, meta: Omit<LockFile, 'target' | 'createdAt'>): LockResult {
  const lockPath = join(lockDir, `${target}.lock`);

  // Check existing lock
  try {
    const existing = JSON.parse(readFileSync(lockPath, 'utf-8')) as LockFile;
    const age = Date.now() - new Date(existing.createdAt).getTime();
    const staleMs = config.staleLockTimeout ?? 3600000; // 1 hour default

    if (age > staleMs) {
      // Stale lock -- warn but allow override prompt
      return { status: 'stale', existing };
    }
    return { status: 'locked', existing };
  } catch {
    // No lock exists -- acquire it
  }

  const lock: LockFile = {
    target,
    ...meta,
    createdAt: new Date().toISOString(),
  };
  writeFileSync(lockPath, JSON.stringify(lock, null, 2));
  return { status: 'acquired' };
}
```

### Anti-Patterns to Avoid
- **Shared mutable state between steps:** Each step must communicate through the rolling context builder, not through module-level variables. The context builder serializes step results and compresses as needed.
- **Retrying rollback commands:** If rollback fails, log CRITICAL and stop. Do not retry rollback -- human must intervene.
- **Shell mode without approval:** Never use `spawn({shell: true})` without explicit HITL approval step. This is a security escalation.
- **Buffering entire output:** Use `maxBuffer` limits. Infrastructure commands can produce enormous output (e.g., `docker logs`). Cap at 1MB default, configurable.
- **Blocking on lock check:** Lock check is synchronous file read. Do not add polling/retry for locks -- show conflict message immediately, let admin decide.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Command string parsing with complex quoting | Full shell parser | Simple token splitter + shell mode fallback | Shell parsing is infinitely complex (escapes, variables, subshells). Simple splitter handles 95% of infra commands; shell mode handles the rest |
| Process management with signal handling | Custom process supervisor | Node.js built-in execFile timeout + AbortController | Built-in handles SIGTERM, exit codes, timeout killing correctly |
| JSON schema validation | Manual field checking | Zod schemas (already in project) | Type-safe, composable, consistent with existing patterns |

**Key insight:** The execution engine's safety systems (circuit breaker, damage budget) are simple enough to hand-roll -- they are counters and thresholds, not distributed systems patterns. External libraries like opossum are designed for service mesh resilience, not sequential command execution with budgets.

## Common Pitfalls

### Pitfall 1: execFile Argument Splitting
**What goes wrong:** Passing the entire command string as the first argument to execFile. `execFile('docker inspect nginx')` fails because it tries to find a binary literally named "docker inspect nginx".
**Why it happens:** exec() takes a full command string, but execFile() takes (file, args[]).
**How to avoid:** Always parse the command string into executable + args array before passing to execFile.
**Warning signs:** "ENOENT" errors when the command clearly exists.

### Pitfall 2: Lost stderr on Non-Zero Exit
**What goes wrong:** When execFile rejects (non-zero exit code), developers forget that stdout and stderr are still available on the error object.
**Why it happens:** The promisified version throws on non-zero exit, and the natural instinct is to only look at error.message.
**How to avoid:** Always extract `err.stdout` and `err.stderr` from the caught error -- they contain the actual command output.
**Warning signs:** "Command failed" errors with no useful diagnostic information.

### Pitfall 3: Race Condition in File-Based Locks
**What goes wrong:** Two processes check for lock file, both find none, both write their own lock.
**Why it happens:** read-check-write is not atomic with regular file operations.
**How to avoid:** Use `writeFileSync` with `{ flag: 'wx' }` (exclusive create) -- this is atomic on local filesystems. If the file already exists, it throws EEXIST.
**Warning signs:** Two sessions somehow both "acquired" the same lock.

### Pitfall 4: Damage Budget Not Accounting for Retries
**What goes wrong:** Circuit breaker retries a failed DESTRUCTIVE command 3 times, but only 2 points are deducted from damage budget.
**Why it happens:** Budget deduction happens only on success, not on each attempt.
**How to avoid:** Deduct from budget on every execution attempt. Failed retries consume double (per SAFE-06). Check budget affordability BEFORE each retry.
**Warning signs:** Plans consuming more state changes than the budget should allow.

### Pitfall 5: Rolling Context Token Overflow
**What goes wrong:** After many steps, the accumulated context of prior step results exceeds the LLM's context window.
**Why it happens:** Each step appends its full stdout/stderr to the context.
**How to avoid:** Use the existing `estimateTokens()` from `src/llm/token-budget.ts` to check context size before each step. When approaching 80% of budget, compress older step results to 1-2 line summaries.
**Warning signs:** Ollama returning truncated or garbled responses in later steps of a long plan.

## Code Examples

### Snapshot Capture Strategy
```typescript
// Source: Project decision -- Claude's discretion on snapshot READ commands
const SNAPSHOT_COMMANDS: Record<string, (target: string) => string> = {
  'docker stop':    (t) => `docker inspect ${t}`,
  'docker rm':      (t) => `docker inspect ${t}`,
  'docker restart': (t) => `docker inspect ${t}`,
  'systemctl stop':     (t) => `systemctl show ${t}`,
  'systemctl restart':  (t) => `systemctl show ${t}`,
  'cp':  (_t, cmd) => `cat ${extractTarget(cmd)}`,  // capture file contents before overwrite
  'mv':  (_t, cmd) => `cat ${extractTarget(cmd)}`,
  'tee': (_t, cmd) => `cat ${extractTarget(cmd)}`,
};

// Fallback: if command starts with a known prefix, use that mapping.
// If no mapping exists, skip snapshot (READ commands don't need one).
```

### Damage Budget Class
```typescript
export class DamageBudget {
  private used = 0;
  private readonly limit: number;

  constructor(limit: number) {
    this.limit = limit;
  }

  costFor(risk: 'read' | 'write' | 'destructive'): number {
    switch (risk) {
      case 'read': return 0;
      case 'write': return 1;
      case 'destructive': return 2;
    }
  }

  canAfford(cost: number): boolean {
    return this.used + cost <= this.limit;
  }

  deduct(cost: number): void {
    this.used += cost;
  }

  deductFailedRetry(risk: 'read' | 'write' | 'destructive'): void {
    // Failed retries consume double (SAFE-06)
    this.used += this.costFor(risk) * 2;
  }

  get remaining(): number { return this.limit - this.used; }
  get total(): number { return this.limit; }
  get spent(): number { return this.used; }
}
```

### Circuit Breaker Class
```typescript
export class CircuitBreaker {
  private failures = new Map<number, number>(); // stepIndex -> failureCount
  private readonly maxRetries: number;

  constructor(maxRetries = 3) {
    this.maxRetries = maxRetries;
  }

  async execute(
    stepIndex: number,
    fn: () => Promise<RunResult>,
    budget: DamageBudget,
    risk: 'read' | 'write' | 'destructive',
  ): Promise<{ status: 'success' | 'circuit_open'; result?: RunResult }> {
    const failures = this.failures.get(stepIndex) ?? 0;

    if (failures >= this.maxRetries) {
      return { status: 'circuit_open' };
    }

    const result = await fn();

    if (result.exitCode !== 0) {
      this.failures.set(stepIndex, failures + 1);
      budget.deductFailedRetry(risk);

      if (failures + 1 >= this.maxRetries) {
        return { status: 'circuit_open', result };
      }
      // Retry (recursive or loop in caller)
      return this.execute(stepIndex, fn, budget, risk);
    }

    return { status: 'success', result };
  }
}
```

### Lock Force-Override with Typed Confirmation
```typescript
// Reuses pattern from src/cli/approval.ts
export async function promptLockOverride(
  lock: LockFile,
  rl: readline.Interface,
): Promise<boolean> {
  console.log(chalk.yellow(
    `Target '${lock.target}' is locked by session ${lock.sessionId} ` +
    `(started ${formatTimeAgo(lock.createdAt)}). ` +
    `Admin: ${lock.adminName}`
  ));
  const answer = await rl.question(
    chalk.red(`Type '${lock.target}' to force-override or press Enter to cancel: `)
  );
  return answer === lock.target;
}
```

### Extending Config Schema
```typescript
// Extend InfraBrainConfigSchema in src/config/types.ts
export const InfraBrainConfigSchema = z.object({
  // ... existing fields ...
  circuitBreaker: z.object({
    maxRetries: z.number().default(3),
    retryDelayMs: z.number().default(1000),
  }).default({ maxRetries: 3, retryDelayMs: 1000 }),
  damageBudget: z.object({
    maxPoints: z.number().default(10),
  }).default({ maxPoints: 10 }),
  locks: z.object({
    staleTimeoutMs: z.number().default(3600000), // 1 hour
  }).default({ staleTimeoutMs: 3600000 }),
  execution: z.object({
    commandTimeoutMs: z.number().default(30000), // 30 seconds per command
    maxBufferBytes: z.number().default(1024 * 1024), // 1MB
  }).default({ commandTimeoutMs: 30000, maxBufferBytes: 1024 * 1024 }),
});
```

### New Audit Event Types
```typescript
// Extend AuditEventType in src/audit/types.ts
export type AuditEventType =
  | 'decision'
  | 'command_validation'
  | 'approval'
  | 'state_change'
  | 'error'
  | 'session_start'
  | 'session_end'
  | 'skill_selection'
  // Phase 3 additions:
  | 'execution_start'
  | 'execution_complete'
  | 'step_start'
  | 'step_complete'
  | 'step_failed'
  | 'snapshot_captured'
  | 'rollback_start'
  | 'rollback_complete'
  | 'rollback_failed'
  | 'circuit_breaker_triggered'
  | 'damage_budget_exceeded'
  | 'damage_budget_update'
  | 'lock_acquired'
  | 'lock_released'
  | 'lock_conflict'
  | 'lock_override';
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| exec() for shell commands | execFile() with explicit args | Always recommended, emphasized in Node 18+ | Prevents shell injection; required by project decision |
| Callback-based child_process | util.promisify(execFile) + AbortController | Node 15+ (AbortController), stable since Node 18 | Clean async/await, cancellation support |
| Third-party lockfile libs | writeFileSync with { flag: 'wx' } for atomic create | Node.js built-in, always available | Atomic on local fs, no dependency needed |

**Deprecated/outdated:**
- `child_process.exec()` for executing known commands: Use execFile instead (no shell overhead, no injection risk)
- Manual process.kill() for timeout: Use AbortController signal option instead (cleaner, automatic cleanup)

## Open Questions

1. **Shell mode detection**
   - What we know: Some commands need pipes/redirects (e.g., `cat /etc/nginx/nginx.conf | grep upstream`). These require shell mode.
   - What's unclear: Should shell mode be detected automatically from the command string (presence of `|`, `>`, `&&`, etc.) or always require explicit flagging in the fix plan?
   - Recommendation: Auto-detect pipe/redirect characters and flag for shell mode. Add a `shellRequired` boolean to FixStep schema. Still require HITL approval.

2. **Target identifier derivation**
   - What we know: Locks are per-target (e.g., "nginx", "postgres"). The target comes from the fix plan.
   - What's unclear: How to reliably extract a target identifier from arbitrary fix plan commands.
   - Recommendation: Add a `target` field to the FixPlan schema (LLM generates it). Fallback: extract from the first WRITE/DESTRUCTIVE command using `extractTarget()` from approval.ts.

3. **Concurrent lock checking across processes**
   - What we know: `writeFileSync` with `{ flag: 'wx' }` is atomic on local filesystems.
   - What's unclear: Behavior on NFS or shared mounts.
   - Recommendation: Document local-filesystem-only guarantee. v1 is single-machine per project decisions. NFS is a v2 concern if needed.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.x |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run --reporter=verbose` |
| Full suite command | `npx vitest run` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CORE-06 | Execute loop runs plan steps end-to-end | integration | `npx vitest run tests/execution/executor.test.ts -t "executes plan"` | Wave 0 |
| CORE-07 | Each step gets isolated LLM context | unit | `npx vitest run tests/execution/context-builder.test.ts` | Wave 0 |
| CORE-08 | Commands run in child process via execFile | unit | `npx vitest run tests/execution/runner.test.ts` | Wave 0 |
| SAFE-04 | Circuit breaker halts after max retries | unit | `npx vitest run tests/execution/circuit-breaker.test.ts` | Wave 0 |
| SAFE-05 | Damage budget limits state changes | unit | `npx vitest run tests/execution/damage-budget.test.ts` | Wave 0 |
| SAFE-06 | Failed retries consume double budget | unit | `npx vitest run tests/execution/damage-budget.test.ts -t "double"` | Wave 0 |
| SAFE-07 | Pre-execution snapshot captured | unit | `npx vitest run tests/execution/snapshot.test.ts` | Wave 0 |
| SAFE-08 | Automatic rollback on safety trigger | integration | `npx vitest run tests/execution/rollback.test.ts` | Wave 0 |
| SAFE-12 | Admin alerted on safety triggers | unit | `npx vitest run tests/execution/executor.test.ts -t "alert"` | Wave 0 |
| INTF-08 | Lock prevents concurrent fixes | unit | `npx vitest run tests/locks/manager.test.ts -t "prevent"` | Wave 0 |
| INTF-09 | Lock conflict shows admin info | unit | `npx vitest run tests/locks/manager.test.ts -t "conflict"` | Wave 0 |
| INTF-10 | Force-override with typed confirmation | unit | `npx vitest run tests/locks/manager.test.ts -t "override"` | Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run --reporter=verbose`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/execution/runner.test.ts` -- covers CORE-08 (command execution via execFile)
- [ ] `tests/execution/circuit-breaker.test.ts` -- covers SAFE-04 (halt after retries)
- [ ] `tests/execution/damage-budget.test.ts` -- covers SAFE-05, SAFE-06 (budget tracking, double cost)
- [ ] `tests/execution/snapshot.test.ts` -- covers SAFE-07 (pre-execution capture)
- [ ] `tests/execution/rollback.test.ts` -- covers SAFE-08 (automatic rollback)
- [ ] `tests/execution/context-builder.test.ts` -- covers CORE-07 (isolated LLM context)
- [ ] `tests/execution/executor.test.ts` -- covers CORE-06, SAFE-12 (end-to-end loop, alerts)
- [ ] `tests/locks/manager.test.ts` -- covers INTF-08, INTF-09, INTF-10 (locking system)

## Sources

### Primary (HIGH confidence)
- [Node.js child_process docs](https://nodejs.org/api/child_process.html) - execFile, spawn, AbortController, timeout options
- Project source code -- src/orchestrator/types.ts, src/safety/*, src/cli/approval.ts, src/state/*, src/audit/*

### Secondary (MEDIUM confidence)
- [Circuit Breaker Pattern in Node.js/TypeScript](https://dev.to/wallacefreitas/circuit-breaker-pattern-in-nodejs-and-typescript-enhancing-resilience-and-stability-bfi) - Pattern structure
- [proper-lockfile](https://github.com/moxystudio/node-proper-lockfile) - File locking patterns and staleness detection

### Tertiary (LOW confidence)
- None -- all findings verified with official docs or project source

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All Node.js built-ins + existing project dependencies. No new libraries needed.
- Architecture: HIGH - Follows existing project patterns (factory injection, Zod schemas, file-first dual-write, chalk CLI output). All decisions locked in CONTEXT.md.
- Pitfalls: HIGH - Well-known Node.js child_process gotchas, verified against official docs.

**Research date:** 2026-03-08
**Valid until:** 2026-04-08 (stable domain -- Node.js child_process API is mature)
