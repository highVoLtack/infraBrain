# Phase 14: Pipeline Extraction + Parallel Discovery - Research

**Researched:** 2026-04-10
**Domain:** TypeScript pipeline refactoring + concurrency control
**Confidence:** HIGH

## Summary

Phase 14 has two distinct goals: (1) extract the monolithic 686-line `src/api/routes/debug.ts` into a clean orchestrator pipeline under `src/orchestrator/`, and (2) make discovery commands run in parallel with per-container mutex protection. Both are well-understood patterns in the Node.js/TypeScript ecosystem.

The current `debug.ts` contains the entire DPEV pipeline inline: skill selection, discovery command execution, diagnosis, planning, hallucination checking, and response assembly. This must be decomposed into focused modules so that subsequent v1.3 phases (context management, fix-caching, semantic memory) can hook into the pipeline without merge conflicts. The parallel discovery work uses `Promise.all()` with `p-queue` (concurrency=1 per container) -- a standard pattern that requires no custom concurrency primitives.

**Primary recommendation:** Extract pipeline stages into `src/orchestrator/pipeline.ts` (thin orchestrator), `src/orchestrator/discovery.ts` (parallel discovery), and keep `debug.ts` as a thin HTTP route handler under 200 lines. Use `p-queue@9` with `Map<string, PQueue>` for per-container mutex.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| EXEC-01 | Discovery commands run in parallel via `Promise.all()` (2-5x speedup) | Parallel discovery module with `Promise.all()` over grouped commands; `p-queue` for concurrency control |
| EXEC-02 | Per-container mutex (`Map<string, PQueue>`) prevents concurrent docker exec on same container | `p-queue` with `concurrency: 1` per container key; `Map<string, PQueue>` pattern documented below |
| EXEC-03 | Execution steps remain serial with existing safety gates (circuit breaker, damage budget) | Pipeline extraction preserves `executePlan()` serial loop unchanged; only discovery phase changes |
| EXEC-04 | Parallel discovery results merge into single discovery context for LLM | Results collected via `Promise.all()`, merged into single TOON-encoded context block identical to current format |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| p-queue | ^9.1.2 | Per-container concurrency queue (mutex) | 40M+ weekly downloads, ESM-native, TypeScript-first, feature-complete, sindresorhus ecosystem |

### Already In Project (no new deps needed for most work)
| Library | Version | Purpose |
|---------|---------|---------|
| vitest | ^4.0.18 | Test framework |
| zod | ^4.3.6 | Schema validation |
| ai | ^6.0.116 | LLM integration (Vercel AI SDK) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| p-queue | Hand-rolled Map+Promise | p-queue handles edge cases (timeout, priority, events) that hand-rolled misses |
| p-queue | async-mutex | async-mutex is lock-only; p-queue adds queue semantics which discovery needs |

**Installation:**
```bash
npm install p-queue
```

Note: p-queue is ESM-only. This project already uses `"type": "module"` so no compatibility issues.

## Architecture Patterns

### Current Structure (BEFORE)
```
src/
├── api/routes/debug.ts          # 686 lines -- DPEV pipeline monolith
├── orchestrator/
│   ├── context.ts               # buildMessages, routing constitution
│   ├── planner.ts               # generateFixPlan
│   ├── router.ts                # selectSkill
│   └── types.ts                 # FixPlan, StructuredDiagnosis schemas
└── execution/
    ├── executor.ts              # executePlan (serial, safety-gated)
    ├── circuit-breaker.ts
    ├── damage-budget.ts
    └── ...
```

### Target Structure (AFTER)
```
src/
├── api/routes/debug.ts          # < 200 lines -- thin HTTP handler only
├── orchestrator/
│   ├── pipeline.ts              # NEW: DPEV pipeline orchestrator
│   ├── discovery.ts             # NEW: parallel discovery with mutex
│   ├── diagnosis.ts             # NEW: structured + free-text diagnosis
│   ├── context.ts               # EXISTING: buildMessages (unchanged)
│   ├── planner.ts               # EXISTING: generateFixPlan (unchanged)
│   ├── router.ts                # EXISTING: selectSkill (unchanged)
│   └── types.ts                 # EXTENDED: add discovery types
└── execution/
    └── ...                      # UNCHANGED
```

### Pattern 1: Pipeline Orchestrator
**What:** A single `runDPEV()` function that sequences discovery -> diagnosis -> plan, returning a typed result object. Each stage is a separate module.
**When to use:** When the HTTP handler needs to call the full pipeline.
**Example:**
```typescript
// src/orchestrator/pipeline.ts
import { runParallelDiscovery } from './discovery.js';
import { runDiagnosis } from './diagnosis.js';
import { generateFixPlan } from './planner.js';

export interface DPEVResult {
  sessionId: string;
  skill: SkillFile;
  discovery: { context: string; raw: Record<string, string> };
  diagnosis: string;
  structuredDiagnosis?: StructuredDiagnosis;
  fixPlan?: FixPlan;
  planMarkdown?: string;
  planTable?: string;
  target?: string;
  containers: string[];
}

export async function runDPEV(input: DPEVInput): Promise<DPEVResult> {
  // 1. Skill selection
  const selection = await selectSkill(input.skillOptions);

  // 2. Parallel discovery (NEW)
  const discovery = await runParallelDiscovery(selection.skill);

  // 3. Diagnosis (extracted from debug.ts)
  const diagResult = await runDiagnosis({ ... });

  // 4. Planning (existing planner, unchanged)
  const plan = await generateFixPlan({ ... });

  return { ... };
}
```

### Pattern 2: Parallel Discovery with Per-Container Mutex
**What:** Group discovery commands by target container, run groups in parallel via `Promise.all()`, enforce concurrency=1 within each container group using `PQueue`.
**When to use:** During the discovery phase of DPEV.
**Example:**
```typescript
// src/orchestrator/discovery.ts
import PQueue from 'p-queue';
import { runCommand, runShellCommand, parseCommand, needsShell } from '../execution/runner.js';
import { encodeForLLM } from '../llm/toon-encoder.js';
import type { DiscoveryCommand } from '../skills/types.js';

// Per-container mutex map: ensures no two commands hit the same container simultaneously
const containerQueues = new Map<string, PQueue>();

function getContainerQueue(container: string): PQueue {
  let queue = containerQueues.get(container);
  if (!queue) {
    queue = new PQueue({ concurrency: 1 });
    containerQueues.set(container, queue);
  }
  return queue;
}

/**
 * Extract target container from a discovery command string.
 * Commands targeting a specific container (docker exec, docker logs)
 * return that container name. Host-level commands return '__host__'.
 */
export function extractCommandTarget(command: string): string {
  // docker exec <container> ... or docker logs <container>
  const dockerExec = command.match(/docker\s+(exec|logs)\s+(\S+)/);
  if (dockerExec) return dockerExec[2];
  return '__host__';
}

export interface DiscoveryResult {
  context: string;    // TOON-encoded for LLM
  raw: Record<string, string>;
}

export async function runParallelDiscovery(
  commands: DiscoveryCommand[],
): Promise<DiscoveryResult> {
  if (!commands || commands.length === 0) return { context: '', raw: {} };

  // Group commands by target container
  const groups = new Map<string, DiscoveryCommand[]>();
  for (const cmd of commands) {
    const target = extractCommandTarget(cmd.command);
    const group = groups.get(target) ?? [];
    group.push(cmd);
    groups.set(target, group);
  }

  // Run all groups in parallel; within each group, PQueue(concurrency:1) serializes
  const results: Record<string, string> = {};

  await Promise.all(
    Array.from(groups.entries()).map(([target, cmds]) => {
      const queue = getContainerQueue(target);
      return Promise.all(
        cmds.map(({ command, label }) =>
          queue.add(async () => {
            const result = needsShell(command)
              ? await runShellCommand(command, { timeout: 15_000 })
              : await runCommand(
                  parseCommand(command).executable,
                  parseCommand(command).args,
                  { timeout: 10_000 },
                );
            results[label] = result.stdout.trim() || result.stderr.trim() || '(empty)';
          })
        )
      );
    })
  );

  const context = encodeForLLM(results, 'Discovery (ground truth from live system)');
  return { context, raw: results };
}
```

### Pattern 3: Thin HTTP Handler
**What:** `debug.ts` becomes a thin adapter that parses HTTP request, calls `runDPEV()`, and serializes the response.
**When to use:** The route handler after extraction.
**Example:**
```typescript
// src/api/routes/debug.ts (AFTER extraction)
router.post('/', async (req, res, next) => {
  try {
    const { prompt, skill: skillOverride } = req.body ?? {};
    if (!prompt || typeof prompt !== 'string') {
      res.status(400).json({ error: 'prompt is required' });
      return;
    }

    const result = await runDPEV({
      prompt,
      skillOverride,
      provider,
      registry,
      auditLogger,
      validator,
      store: extraDeps?.store,
      config: extraDeps?.config,
      sessionId: extraDeps?.sessionId,
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});
```

### Anti-Patterns to Avoid
- **Moving logic but keeping coupling:** Don't extract functions that still depend on `req`/`res` -- the pipeline must be HTTP-agnostic.
- **Breaking the DPEV sequence:** The `enforceDPEVSequence()` guard must remain in the pipeline, not be lost during extraction.
- **Shared mutable state in discovery:** Don't use a single `results` object across parallel promises without proper scoping. Each `Promise.all` branch should write to its own slot, then merge.
- **Forgetting to clear container queues:** The `Map<string, PQueue>` should be module-scoped (singleton) so it persists across requests, but individual queue items clean up naturally.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Per-container concurrency control | Custom mutex/semaphore with Promise chains | `p-queue` with `concurrency: 1` | Handles timeout, priority, backpressure; tested in production at massive scale |
| Promise.all error handling | Try/catch around each parallel branch | `Promise.allSettled()` with result filtering | Prevents one failed discovery command from killing all parallel branches |
| Command target extraction (container name) | Complex AST parsing | Simple regex on `docker exec/logs <name>` | Discovery commands are predictable patterns defined in skill YAML |

**Key insight:** The concurrency problem here is simple (per-key mutex for docker commands), but hand-rolling it correctly requires handling timeout, error propagation, and queue draining -- all solved by p-queue.

## Common Pitfalls

### Pitfall 1: Result Ordering Changes
**What goes wrong:** Parallel discovery returns results in completion order, not definition order. If the LLM prompt depends on specific ordering of discovery blocks, output changes.
**Why it happens:** `Promise.all()` resolves in completion order for the inner values, but the record keys are set by label, so ordering is actually determined by insertion order into `results`.
**How to avoid:** Use the `label` as the key (current approach). The TOON encoder uses object keys, which maintain insertion order in modern JS. Ensure results are inserted in the original command order by using the command array index, not completion order.
**Warning signs:** Tests that assert exact string equality on discovery context fail intermittently.

### Pitfall 2: Docker Socket Contention
**What goes wrong:** Too many parallel `docker exec` calls overwhelm the Docker socket, causing timeouts.
**Why it happens:** The Docker daemon has a limited number of concurrent exec sessions (default varies by Docker version).
**How to avoid:** The per-container `PQueue(concurrency: 1)` already prevents this for same-container commands. For cross-container parallelism, current discovery commands (2-4 per skill) are well within Docker's limits. If future skills add 10+ parallel containers, add a global concurrency cap.
**Warning signs:** Sporadic "connection refused" or timeout errors from Docker during discovery.

### Pitfall 3: Extracting Too Much or Too Little
**What goes wrong:** Either debug.ts stays at 300+ lines (extracted too little) or the new modules have circular dependencies (extracted too much).
**Why it happens:** The DPEV pipeline has natural seams but also cross-cutting concerns (audit logging, DEV_MODE logging, error handling).
**How to avoid:** Extract by DPEV phase boundary: discovery.ts, diagnosis.ts, pipeline.ts. Keep utility functions (hallucination checker, log pre-filter, command extractor) in debug.ts or move to a shared utils module. Pass audit logger as a dependency, don't import globally.
**Warning signs:** Circular import errors at build time. debug.ts still over 200 lines.

### Pitfall 4: Breaking Existing Tests
**What goes wrong:** The 8 existing test files for debug routes (`tests/api/debug-*.test.ts`, `tests/api/routes.test.ts`, `tests/api/sanity-checker.test.ts`) break because exported functions move to new modules.
**Why it happens:** Tests import directly from `src/api/routes/debug.ts`.
**How to avoid:** Re-export moved functions from debug.ts for backward compatibility, OR update all test imports in the same PR. The latter is cleaner.
**Warning signs:** Test compilation errors after extraction.

### Pitfall 5: p-queue ESM Import Issues
**What goes wrong:** Build/test fails with "Cannot find module 'p-queue'" or "ERR_REQUIRE_ESM".
**Why it happens:** p-queue v9 is ESM-only.
**How to avoid:** This project already uses `"type": "module"` in package.json, so this should work out of the box. Just use `import PQueue from 'p-queue'`.
**Warning signs:** N/A -- the project is already ESM.

## Code Examples

### Merging Parallel Discovery Results (preserving order)
```typescript
// Ensure results appear in original command order, not completion order
export async function runParallelDiscovery(
  commands: DiscoveryCommand[],
): Promise<DiscoveryResult> {
  if (!commands || commands.length === 0) return { context: '', raw: {} };

  // Execute all commands in parallel (mutex handles per-container safety)
  const settled = await Promise.allSettled(
    commands.map(({ command, label }) => {
      const target = extractCommandTarget(command);
      const queue = getContainerQueue(target);
      return queue.add(async () => {
        const result = needsShell(command)
          ? await runShellCommand(command, { timeout: 15_000 })
          : await runCommand(parseCommand(command).executable, parseCommand(command).args, { timeout: 10_000 });
        return { label, output: result.stdout.trim() || result.stderr.trim() || '(empty)' };
      });
    })
  );

  // Merge in original order (commands array index)
  const raw: Record<string, string> = {};
  for (const result of settled) {
    if (result.status === 'fulfilled' && result.value) {
      raw[result.value.label] = result.value.output;
    }
  }

  const context = encodeForLLM(raw, 'Discovery (ground truth from live system)');
  return { context, raw };
}
```

### Pipeline Types
```typescript
// src/orchestrator/types.ts (additions)
export interface DPEVInput {
  prompt: string;
  skillOverride?: string;
  provider: LLMProvider;
  registry?: SkillRegistry;
  auditLogger: AuditLogger;
  validator: (command: string) => ValidationResult;
  store?: WriteThrough;
  config?: InfraBrainConfig;
  sessionId?: string;
}
```

### Testing Parallel Discovery
```typescript
// tests/orchestrator/discovery.test.ts
import { describe, it, expect, vi } from 'vitest';
import { runParallelDiscovery, extractCommandTarget } from '../../src/orchestrator/discovery.js';

describe('extractCommandTarget', () => {
  it('extracts container name from docker exec', () => {
    expect(extractCommandTarget('docker exec postgres-demo psql -U postgres'))
      .toBe('postgres-demo');
  });

  it('returns __host__ for host-level commands', () => {
    expect(extractCommandTarget('docker ps -a --format "{{.Names}}"'))
      .toBe('__host__');
  });
});

describe('runParallelDiscovery', () => {
  it('runs commands targeting different containers in parallel', async () => {
    // Mock runner to track execution timing
    const executionOrder: string[] = [];
    // ... verify wall-clock time < sum of individual times
  });

  it('serializes commands targeting the same container', async () => {
    // Mock two commands targeting same container
    // Verify they don't overlap
  });
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Callbacks for concurrency | `Promise.all()` + `Promise.allSettled()` | ES2020+ | Standard async pattern |
| Custom semaphore classes | p-queue with concurrency option | p-queue stable since 2020 | No need for hand-rolled mutex |
| Monolithic route handlers | Extract-to-service pattern | Always been best practice | Testability, reusability |

**Deprecated/outdated:**
- `async` (caolan/async) library: Superseded by native Promise APIs. Don't use.
- `p-queue` v7 and below: CJS, don't use. Use v9+.

## Open Questions

1. **Container target extraction for non-docker commands**
   - What we know: Current discovery commands are all `docker ps`, `docker stats`, `docker network ls` -- all host-level. No per-container discovery commands exist yet in current skills.
   - What's unclear: Will future skills add per-container discovery commands (e.g., `docker exec postgres-demo pg_isready`)?
   - Recommendation: Build the mutex infrastructure now (it's cheap), even if current commands all resolve to `__host__`. The architecture is ready when container-specific discovery commands are added.

2. **Global concurrency cap across all containers**
   - What we know: Current skills have 2-4 discovery commands. Docker handles this fine.
   - What's unclear: At what point does cross-container parallelism stress the Docker daemon?
   - Recommendation: Don't add a global cap now. Monitor in production. Add if needed (trivial with p-queue's concurrency option on a parent queue).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.0.18 |
| Config file | vitest.config.ts |
| Quick run command | `npx vitest run tests/orchestrator/discovery.test.ts` |
| Full suite command | `npx vitest run` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| EXEC-01 | Discovery commands run in parallel (wall-clock speedup) | unit | `npx vitest run tests/orchestrator/discovery.test.ts -t "parallel"` | Wave 0 |
| EXEC-02 | Per-container mutex prevents concurrent docker exec | unit | `npx vitest run tests/orchestrator/discovery.test.ts -t "mutex"` | Wave 0 |
| EXEC-03 | Execution steps remain serial with safety gates | unit | `npx vitest run tests/execution/executor.test.ts` | Exists |
| EXEC-04 | Parallel results merge into single context block | unit | `npx vitest run tests/orchestrator/discovery.test.ts -t "merge"` | Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run tests/orchestrator/ tests/api/`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/orchestrator/discovery.test.ts` -- covers EXEC-01, EXEC-02, EXEC-04
- [ ] `tests/orchestrator/pipeline.test.ts` -- covers pipeline extraction, DPEV sequence preservation
- [ ] `tests/api/debug-extraction.test.ts` -- covers debug.ts < 200 lines, response shape unchanged
- [ ] `npm install p-queue` -- required dependency

## Sources

### Primary (HIGH confidence)
- Project source code: `src/api/routes/debug.ts`, `src/orchestrator/`, `src/execution/` -- full codebase analysis
- p-queue GitHub README -- API docs, ESM-only, v9.1.2, concurrency option

### Secondary (MEDIUM confidence)
- [p-queue npm](https://www.npmjs.com/package/p-queue) -- version, download stats
- [p-queue GitHub](https://github.com/sindresorhus/p-queue) -- API surface, TypeScript support

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- p-queue is the canonical solution, project is already ESM
- Architecture: HIGH -- extraction pattern is straightforward, seams are clear in existing code
- Pitfalls: HIGH -- based on direct code analysis, known patterns
- Discovery parallelism: HIGH -- `Promise.all()` + `PQueue(concurrency: 1)` is textbook

**Research date:** 2026-04-10
**Valid until:** 2026-05-10 (stable domain, no fast-moving dependencies)
