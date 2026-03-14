# Skill Format Redesign - Architecture Research

**Researched:** 2026-03-14
**Domain:** Skill definition format, LLM orchestration, safety enforcement
**Confidence:** HIGH (based on complete codebase analysis)

## Summary

The current InfraBrain skill format treats skills as **scripts with LLM wrappers** -- each skill prescribes a step-by-step Diagnostic Ladder, hardcodes container names in discovery, and separates safety metadata (risk, privilege) across three different systems (`rewrite_rules` in frontmatter, `DEFAULT_RULES` in `safety/rules.ts`, and `enforceSkillAllowlist` in `allowlist.ts`). The proposed redesign consolidates all three into a **single tool declaration** with inline safety metadata, replaces scripted ladders with **domain knowledge sections**, and shifts from scenario-specific to **universal expert skills**.

This research maps every component that needs to change, identifies the exact merge points for the three safety systems, and documents the migration path from current skills to the new format. The redesign touches 7 source files, 7 skill files, and 3 Zod schemas -- but the changes are cleanly layered and can be implemented incrementally.

**Primary recommendation:** Implement the new `tools` map format (`{ name: risk, user? }`) as the SINGLE source of truth for tool permissions, rewrite behavior, and safety classification. The existing `rewrite_rules`, `DEFAULT_RULES`, and `enforceSkillAllowlist` all become derived from this one declaration.

---

## 1. Current End-to-End Flow

Understanding the current pipeline is critical before redesigning it.

### Request Flow: debug route -> skill selection -> discovery -> LLM diagnosis -> fix plan -> execution

```
POST /debug { prompt }
  |
  v
1. selectSkill() -- LLM picks best skill from registry (or manual override)
  |
  v
2. Routing enforcement -- if skill declares preferred_model, verify it's distinct from default (503 if not)
  |
  v
3. runDiscovery(skill) -- execute skill.frontmatter.discovery commands, collect GROUND TRUTH
  |
  v
4. buildMessages(skill, prompt) -- prepend MANDATORY_EXECUTION_PROTOCOL + skill's ## System Prompt
  |                                  inject discovery as GROUND TRUTH block
  |
  v
5. generateObject(StructuredDiagnosisSchema) -- LLM produces structured diagnosis with fix plan
  |                                             OR falls back to free-text generateCommand
  |
  v
6. dynamicRewrite(fixPlan.steps) -- apply skill.frontmatter.rewrite_rules to each command
  |                                  resolve container (auto -> first discovered)
  |                                  inject -u 0 if rule has user
  |                                  wrap with wrapper if defined (e.g., psql -c "{cmd}")
  |
  v
7. checkForHallucinations() -- scan for <placeholder>, "Example Output", etc.
  |                             retry once with STRICT_GROUNDING_PENALTY if failed
  |
  v
8. generateFixPlan() -- planning skill generates FixPlan from diagnosis
  |
  v
9. dynamicRewrite(fixPlan.steps) -- rewrite again for the generated fix plan
  |
  v
10. enforceSkillAllowlist() -- check each command's base tool is in skill.tools[]
  |
  v
11. validateCommand() -- global safety: BLOCKED_PATTERNS -> package manager block -> classifier
  |
  v
12. Response with { diagnosis, fixPlan, commands, discovery }
```

### Three Safety Systems (Currently Separate)

| System | Location | What It Does | Scope |
|--------|----------|-------------|-------|
| **Rewrite Rules** | `skill.frontmatter.rewrite_rules` | Wraps commands in `docker exec`, injects `-u 0`, applies wrappers, strips flags | Per-skill, per-command pattern |
| **Skill Allowlist** | `skill.frontmatter.tools[]` + `allowlist.ts` | Blocks commands whose base tool isn't in the skill's list | Per-skill, base command only |
| **Global Safety** | `safety/rules.ts` + `safety/validator.ts` | `BLOCKED_PATTERNS` (always), `DEFAULT_RULES` (risk classification), config overrides | Global, all commands |

### Current Skill Schema (types.ts)

```typescript
SkillFrontmatterSchema = {
  name: string,
  description: string,
  triggers: string[],
  tools: string[],              // flat list of tool names (allowlist)
  preferred_model?: ModelRole,
  priority: number,
  rewrite_rules: RewriteRule[], // separate safety/execution metadata
  discovery: DiscoveryCommand[],
}

RewriteRuleSchema = {
  match: string,      // regex pattern
  container: string,  // "auto" or specific name
  user?: string,      // e.g., "0" for root
  wrapper?: string,   // e.g., 'psql -U postgres -c "{cmd}"'
  risk?: "read" | "write" | "destructive",
  strip_flags?: string[],
}
```

### Key Observation: Redundancy

The current system declares tool information in THREE places:
1. `tools: ["chown", "ls", ...]` -- flat allowlist (allowlist.ts checks this)
2. `rewrite_rules: [{ match: "^chown", risk: "write", user: "0" }]` -- execution metadata
3. `DEFAULT_RULES` in `safety/rules.ts` -- global risk classification backup

The proposed `tools` map merges all three.

---

## 2. Proposed New Schema

### New Tool Declaration Format

```yaml
tools:
  ls: { risk: read }
  id: { risk: read }
  stat: { risk: read }
  chown: { risk: write, user: "0" }
  chmod: { risk: write, user: "0" }
  cat: { risk: read }
  whoami: { risk: read }
  psql: { risk: read, wrapper: 'psql -U postgres -c "{cmd}"', strip_flags: ["-h", "--host"] }
  truncate: { risk: write }
  docker: { risk: read }  # base docker commands (ps, logs, inspect)
```

### New Zod Schema (types.ts replacement)

```typescript
export const ToolDeclarationSchema = z.object({
  risk: z.enum(['read', 'write', 'destructive']),
  user: z.string().optional(),          // privilege escalation (e.g., "0" for root)
  wrapper: z.string().optional(),       // e.g., 'psql -U postgres -c "{cmd}"'
  strip_flags: z.array(z.string()).optional(),
  container: z.string().default('auto'), // keep for edge cases
});

export type ToolDeclaration = z.infer<typeof ToolDeclarationSchema>;

export const SkillFrontmatterSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(10),
  triggers: z.array(z.string()).min(1),
  tools: z.record(z.string(), ToolDeclarationSchema).default({}),
  preferred_model: ModelRoleSchema.optional(),
  priority: z.number().default(0),
  discovery: z.array(DiscoveryCommandSchema).default([]),
  // REMOVED: rewrite_rules -- merged into tools
  // REMOVED: version, author -- unused
});
```

### What This Merges

| Old | New | How |
|-----|-----|-----|
| `tools: ["chown", "ls"]` (flat allowlist) | `tools: { chown: {...}, ls: {...} }` (keys = allowlist) | `Object.keys(tools)` = allowlist |
| `rewrite_rules[].match` regex | Tool name itself is the match key | `"^chown\\b"` becomes `chown: { ... }` |
| `rewrite_rules[].risk` | `tools.chown.risk` | Inline |
| `rewrite_rules[].user` | `tools.chown.user` | Inline |
| `rewrite_rules[].wrapper` | `tools.psql.wrapper` | Inline |
| `rewrite_rules[].strip_flags` | `tools.psql.strip_flags` | Inline |
| `rewrite_rules[].container` | `tools.chown.container` (default: "auto") | Inline |

---

## 3. Engine Changes Required

### 3.1 dynamic-rewriter.ts -- Derive Rewrite Rules from Tool Map

The `dynamicRewrite()` function currently takes `RewriteRule[]`. It needs an adapter:

```typescript
/**
 * Convert new tool declarations to legacy RewriteRule[] format.
 * This allows incremental migration -- the rewriter doesn't change internally.
 */
export function toolsToRewriteRules(tools: Record<string, ToolDeclaration>): RewriteRule[] {
  return Object.entries(tools).map(([name, decl]) => ({
    match: `^${escapeRegex(name)}\\b`,
    container: decl.container ?? 'auto',
    user: decl.user,
    wrapper: decl.wrapper,
    risk: decl.risk,
    strip_flags: decl.strip_flags,
  }));
}
```

**Strategy:** Keep `dynamicRewrite()` internal logic unchanged. Add a conversion layer. This is the lowest-risk approach.

### 3.2 allowlist.ts -- Derive Allowlist from Tool Map Keys

```typescript
export function enforceSkillAllowlist(command: string, skill: SkillFile): { allowed: boolean; reason?: string } {
  const allowedTools = Object.keys(skill.frontmatter.tools);
  if (allowedTools.length === 0) return { allowed: true };
  // ... rest stays the same, using allowedTools
}
```

### 3.3 safety/rules.ts -- DEFAULT_RULES Become Fallback Only

`DEFAULT_RULES` stays as a **belt-and-suspenders fallback** for commands that slip through skill-level classification. But the skill's tool declarations are authoritative for risk classification when a skill is active.

**Priority order:**
1. Skill tool declaration risk (authoritative when skill is active)
2. DEFAULT_RULES classification (fallback for unknown tools)
3. BLOCKED_PATTERNS (always enforced, non-overridable)

### 3.4 debug.ts -- Extract Tool Metadata at Execution Time

Currently in the debug route:
```typescript
const rewriteRules = selection.skill.frontmatter.rewrite_rules ?? [];
```

Changes to:
```typescript
const rewriteRules = toolsToRewriteRules(selection.skill.frontmatter.tools);
```

One-line change. Everything downstream stays the same.

### 3.5 Handling Commands NOT in the Tool List

**Belt-and-suspenders approach (keep BLOCKED_PATTERNS + DEFAULT_RULES):**

1. If LLM emits a command whose base tool is NOT in `Object.keys(skill.tools)` -> **blocked by allowlist** (existing behavior, unchanged)
2. If command IS in tool list -> risk from tool declaration
3. If command matches BLOCKED_PATTERNS -> **always blocked** (unchanged)
4. Unknown commands that somehow bypass both -> `DEFAULT_RULES` classifies them

The three-layer safety model remains intact. The skill just becomes the PRIMARY source instead of a secondary source.

---

## 4. Skill Content Redesign: Domain Knowledge vs. Diagnostic Ladders

### Current Pattern (Over-Scripted)

```markdown
### Diagnostic Ladder

**Step 0: Container Discovery (MANDATORY)**
Run: `docker ps -a --format "{{.Names}} {{.Status}}"`
Purpose: Discover ACTUAL container names...

**Step 1: Log Analysis**
Run: `docker logs <container> --tail 50`
Purpose: Find the Permission Denied error...
```

Problem: The LLM follows steps mechanically. If the problem doesn't match the ladder, it fails or hallucinates.

### New Pattern (Domain Knowledge)

```markdown
## System Prompt
You are a Senior Linux Systems Engineer. Surgical precision. Production execution engine.

## DOMAIN KNOWLEDGE: PERMISSIONS
- If a process cannot write, check UID vs path owner with `ls -ld` and `id`
- Prefer `chown <uid>:<gid> <path>` over `chmod 777` -- ownership is the correct fix
- Docker containers often run as non-root (UID 1000) but volumes mount as root
- After fixing permissions, the container needs restart: `docker restart <name>`

## DOMAIN KNOWLEDGE: DISK PRESSURE
- Use `df -h` for capacity, `du -sh *` for per-file breakdown
- Use `truncate -s 0` NOT `rm` for log bloat -- preserves inode, no ghost file handles
- Always classify files before acting: log bloat (safe) vs application state (preserve)

## EXECUTION PROTOCOL
1. Analyze Discovery GROUND TRUTH to identify the problem
2. Use your tools to gather additional evidence
3. Correlate findings across layers
4. Propose surgical fix with minimum steps
```

### What the LLM Gets

The LLM still receives:
1. `MANDATORY_EXECUTION_PROTOCOL` (from context.ts -- unchanged)
2. Skill's `## System Prompt` + domain knowledge sections
3. `GROUND TRUTH` block with discovery output
4. User's prompt

The difference: instead of "Step 1: run X, Step 2: run Y", the LLM gets domain expertise and decides the investigation path itself.

### Strict Rules That STAY

These rules are proven effective and must remain:
- `ZERO HYPOTHETICAL REASONING` -- enforced via `checkForHallucinations()`
- `ZERO PLACEHOLDERS` -- enforced via hallucination patterns
- `DISCOVERY IS GROUND TRUTH` -- enforced via the GROUND TRUTH injection
- `ONE COMMAND PER STEP` -- enforced structurally in `FixStepSchema`
- `EVIDENCE BEFORE ACTION` -- guidance, not enforced mechanically

### Strict Rules That GO

- `COMMAND-ONLY MODE` / `SQL-ONLY MODE` -- the wrapper system handles this via tool declarations
- Explicit diagnostic ladder steps -- replaced by domain knowledge
- Hardcoded container names in examples -- replaced by generic examples

---

## 5. Discovery Redesign for Universal Skills

### Current: Scenario-Specific Discovery

```yaml
# linux-filesystem-troubleshoot.md -- HARDCODED container name!
discovery:
  - command: 'docker logs permission-app --tail 50'
    label: 'App crash logs'
  - command: 'docker exec permission-app ls -ld /app/data'
    label: 'Target directory permissions'
```

Problem: `permission-app` is hardcoded. This skill only works for one scenario.

### New: Generic Discovery

```yaml
# linux-expert.md -- GENERIC discovery
discovery:
  - command: 'docker ps -a --format "{{.Names}} {{.Status}}"'
    label: 'Container Inventory'
  - command: 'docker stats --no-stream'
    label: 'Resource Usage'
```

The LLM decides WHICH container to investigate based on the Container Inventory + the user's prompt. The discovery provides a map of the environment; the LLM navigates it.

### Discovery Categories for Universal Skills

| Skill | Discovery Commands | Purpose |
|-------|--------------------|---------|
| `linux-expert` | `docker ps -a`, `docker stats --no-stream` | Environment overview |
| `postgres-expert` | `docker ps`, `docker exec <auto> psql -U postgres -c "SELECT count(*) FROM pg_stat_activity"` | DB health snapshot |
| `network-expert` | `docker ps`, `docker network ls`, `curl -s -o /dev/null -w "%{http_code}" http://localhost` | Connectivity baseline |

Note: The `<auto>` container for DB discovery is handled by `findDbContainer()` which already exists in the codebase. For the postgres skill, discovery commands can still reference a specific container pattern -- the key change is that the SKILL BODY no longer hardcodes container names in its diagnostic instructions.

---

## 6. Universal Skills: Consolidation Map

### Current -> New Skill Mapping

| Current Skills | New Skill | Covers |
|---------------|-----------|--------|
| `linux-filesystem-troubleshoot` | `linux-expert` | Permissions, disk, processes, OOM, crashes |
| `docker-storage` | `linux-expert` | Docker volume saturation, log bloat |
| `nginx-troubleshoot` | `network-expert` | 502, upstream, DNS, connectivity |
| `postgres-troubleshoot` | `postgres-expert` | Connection leaks, deadlocks, slow queries |
| `log-analysis` | Folded into all experts | Every expert can analyze logs in their domain |
| `planning` | `planning` (unchanged) | Still a utility skill, not domain-specific |
| `verification` | `verification` (unchanged) | Still a utility skill, not domain-specific |

### Trigger Design for Universal Skills

Current `linux-filesystem-troubleshoot` has narrow triggers: `permission denied`, `chown`, `chmod`.

New `linux-expert` has broad triggers: `permission`, `crash`, `error`, `slow`, `disk`, `storage`, `volume`, `OOM`, `killed`, `exit`.

Risk: Broader triggers mean more overlap between skills. The LLM router (`selectSkill()`) already handles this via scoring -- broader triggers just mean more candidates reach the router, which is fine.

---

## 7. Migration Path

### Phase 1: Schema Change (Non-Breaking)

1. Add `ToolDeclarationSchema` to `types.ts`
2. Make `SkillFrontmatterSchema.tools` accept BOTH formats:
   ```typescript
   tools: z.union([
     z.array(z.string()),                              // legacy: ["ls", "chown"]
     z.record(z.string(), ToolDeclarationSchema),      // new: { ls: { risk: read } }
   ]).default([]),
   ```
3. Add `toolsToRewriteRules()` adapter in `dynamic-rewriter.ts`
4. Normalize at load time: if `tools` is array, convert to map with risk from `rewrite_rules` (or default `read`)

### Phase 2: Skill Migration

1. Convert each skill to new format one at a time
2. Remove `rewrite_rules` from converted skills
3. Remove diagnostic ladders, add domain knowledge sections
4. Make discovery commands generic (remove hardcoded container names)

### Phase 3: Cleanup

1. Remove legacy `z.array(z.string())` path from schema
2. Remove `RewriteRuleSchema` from frontmatter (keep internally for the adapter)
3. Update tests

### Test Strategy

Every existing test should still pass after Phase 1 (backward compatible). Skills can be migrated one at a time in Phase 2 with per-skill test validation.

---

## 8. Preventing LLM Hallucination of Unlisted Commands

### Current Safeguard: Skill Allowlist

`enforceSkillAllowlist()` checks that every command's base tool is in `skill.tools[]`. This already prevents the LLM from running tools not declared in the skill.

With the new format, this becomes `Object.keys(skill.tools)` -- same logic, same enforcement.

### Additional Safeguard: System Prompt Injection

The skill's system prompt should explicitly list available tools:

```markdown
## YOUR TOOLS
You have access to EXACTLY these tools:
- `ls` (read) -- list files and permissions
- `id` (read) -- show user identity
- `chown` (write, runs as root) -- change file ownership
- `chmod` (write, runs as root) -- change file mode

You MUST NOT use any tool not listed here. If you need a tool not listed, state what you need and STOP.
```

This is generated from the tool map at runtime (in `buildMessages` or `context.ts`), not hand-written in each skill.

### Auto-Generated Tool List

```typescript
function generateToolList(tools: Record<string, ToolDeclaration>): string {
  const lines = Object.entries(tools).map(([name, decl]) => {
    const flags = [decl.risk];
    if (decl.user) flags.push(`runs as uid ${decl.user}`);
    return `- \`${name}\` (${flags.join(', ')})`;
  });
  return `## YOUR TOOLS\nYou have access to EXACTLY these tools:\n${lines.join('\n')}\n\nDo NOT use any tool not listed here.`;
}
```

This is injected into the system prompt alongside `MANDATORY_EXECUTION_PROTOCOL`.

---

## 9. Impact on Existing Components

### Components That Change

| File | Change | Complexity |
|------|--------|------------|
| `src/skills/types.ts` | New `ToolDeclarationSchema`, updated `SkillFrontmatterSchema` | LOW |
| `src/skills/loader.ts` | Normalize legacy tools array to map (if supporting both) | LOW |
| `src/execution/dynamic-rewriter.ts` | Add `toolsToRewriteRules()` adapter | LOW |
| `src/skills/allowlist.ts` | `Object.keys(tools)` instead of `tools` directly | LOW |
| `src/api/routes/debug.ts` | `toolsToRewriteRules(skill.tools)` instead of `skill.rewrite_rules` | ONE LINE |
| `src/orchestrator/context.ts` | Auto-inject tool list into system prompt | MEDIUM |
| All 7 skill files | New format, domain knowledge | MEDIUM each |

### Components That DON'T Change

| File | Why Unchanged |
|------|--------------|
| `src/safety/rules.ts` | `BLOCKED_PATTERNS` and `DEFAULT_RULES` stay as global fallback |
| `src/safety/validator.ts` | Unchanged -- still validates commands the same way |
| `src/safety/classifier.ts` | Unchanged -- still classifies unknown commands |
| `src/orchestrator/planner.ts` | Unchanged -- still generates fix plans |
| `src/orchestrator/router.ts` | Unchanged -- still routes to skills |
| `src/orchestrator/types.ts` | `FixPlanSchema`, `StructuredDiagnosisSchema` unchanged |
| `src/execution/runner.ts` | Unchanged -- still executes commands |
| `src/llm/toon-encoder.ts` | Unchanged -- still encodes context |

### Key Insight: The Rewriter is the Bridge

The `dynamicRewrite()` function is the single point where tool declarations become execution behavior. By adding a `toolsToRewriteRules()` adapter, the entire downstream pipeline (docker exec wrapping, user escalation, flag stripping) works without changes.

---

## 10. Sanity Checker and GROUND TRUTH

### What Stays

- `MANDATORY_EXECUTION_PROTOCOL` in `context.ts` -- stays, fundamental to preventing hallucination
- `checkForHallucinations()` in `debug.ts` -- stays, catches `<placeholder>` patterns
- `STRICT_GROUNDING_PENALTY` retry -- stays, effective recovery mechanism
- `GROUND TRUTH` injection from discovery -- stays, the anchor for real data
- `validatePlanNames()` -- stays, catches placeholder container names

### What Adapts

- STRICT RULES in skill body become domain knowledge guidance
- The auto-generated tool list (section 8) replaces manual `## Tools` sections
- `COMMAND-ONLY MODE` / `SQL-ONLY MODE` instructions in skill body become unnecessary -- the wrapper system handles this transparently. But keeping a brief note in domain knowledge ("Write bare commands, the engine handles container routing") is still useful.

---

## 11. Open Design Questions

### Q1: Docker Commands as a Special Tool

Currently `docker` is listed as a tool, but docker commands span multiple risk levels (`docker ps` = read, `docker restart` = write, `docker rm` = destructive). Options:

**Option A: Granular docker sub-commands**
```yaml
tools:
  docker-ps: { risk: read, alias: "docker ps" }
  docker-logs: { risk: read, alias: "docker logs" }
  docker-restart: { risk: write, alias: "docker restart" }
```

**Option B: Docker as read, specific dangerous subcommands elevated**
```yaml
tools:
  docker: { risk: read }  # base level
```
With `DEFAULT_RULES` handling `docker restart` -> write, `docker rm` -> destructive as fallback.

**Recommendation: Option B.** Docker command risk is already well-handled by `DEFAULT_RULES`. Making the skill declare every docker subcommand adds noise without safety benefit. The global safety layer already catches dangerous docker commands.

### Q2: Discovery Commands That Need Container Names

Some discovery commands inherently need a container name (e.g., `docker exec postgres-demo psql -c "SELECT count(*) FROM pg_stat_activity"`). For universal skills, these need to be either:
- Removed (LLM decides what to query)
- Templated (e.g., `docker exec {{db_container}} psql ...` with `findDbContainer()` filling it in)

**Recommendation:** Use a two-phase discovery:
1. Phase 1: Generic commands (`docker ps -a`, `docker stats`)
2. Phase 2: Engine auto-discovers containers, runs domain-specific probes

This requires a small change to `runDiscovery()` to support conditional/templated commands. Alternatively, keep discovery minimal and let the LLM request more data.

### Q3: StructuredDiagnosis Schema and Diagnostic Steps

The current `StructuredDiagnosisSchema` expects `steps` that mirror the Diagnostic Ladder. With domain knowledge instead of ladders, the LLM will produce variable-length, variable-order steps. The current schema (`min(1).max(5)`) already supports this -- no change needed.

---

## 12. Example: Converted linux-expert Skill

```yaml
---
name: linux-expert
description: "Universal Linux specialist for filesystem, process, and OS-level troubleshooting in Docker environments"
triggers:
  - permission denied
  - permission
  - crash
  - error
  - slow
  - disk full
  - no space left
  - OOM
  - killed
  - storage
  - volume
tools:
  ls: { risk: read }
  id: { risk: read }
  stat: { risk: read }
  chown: { risk: write, user: "0" }
  chmod: { risk: write, user: "0" }
  cat: { risk: read }
  whoami: { risk: read }
  df: { risk: read }
  du: { risk: read }
  truncate: { risk: write }
  docker: { risk: read }
preferred_model: default
priority: 10
discovery:
  - command: 'docker ps -a --format "{{.Names}} {{.Status}}"'
    label: "Container Inventory"
  - command: 'docker stats --no-stream'
    label: "Resource Usage"
---

## System Prompt

You are a Senior Linux Systems Engineer with deep expertise in filesystem permissions, disk management, and process diagnostics in Docker environments. Surgical precision. Production execution engine.

## DOMAIN KNOWLEDGE: PERMISSIONS

- If a process cannot write, correlate UID (`id`) with path owner (`ls -ld <path>`)
- Prefer `chown <uid>:<gid> <path>` over `chmod 777` -- ownership is the correct fix, not opening permissions
- Docker containers often run as non-root (UID 1000) but volumes mount as root:root
- After fixing ownership, the container needs restart so the app retries the failed operation
- Check `/etc/passwd` inside the container to map UID to username if needed

## DOMAIN KNOWLEDGE: DISK PRESSURE

- `df -h` for capacity overview, `du -sh *` for per-file breakdown
- Use `truncate -s 0 <file>` NOT `rm` for log bloat -- preserves inode, prevents ghost file handle leakage
- Always classify before acting: log bloat (safe to truncate) vs application state (NEVER truncate)
- Redis dump.rdb, Postgres data directories = critical state. Logs, temp files = safe to truncate.

## DOMAIN KNOWLEDGE: PROCESS & OOM

- Check `docker inspect <container> --format '{{.State.OOMKilled}}'` for OOM kills
- `docker stats --no-stream` shows memory usage vs limit
- After OOM: increase memory limit with `docker update --memory <limit>` then restart

## EXECUTION PROTOCOL

1. Analyze Container Inventory and Resource Usage from GROUND TRUTH
2. Identify the failing container and symptom category (permission, disk, OOM, crash)
3. Use your tools to gather specific evidence (2-3 commands max)
4. Correlate findings: WHO is running (UID), WHAT failed (path/resource), WHY (mismatch)
5. Propose surgical fix with minimum steps -- one fix, one verify
```

---

## Sources

### Primary (HIGH confidence)
- `src/skills/types.ts` -- current SkillFrontmatterSchema, RewriteRuleSchema
- `src/execution/dynamic-rewriter.ts` -- complete rewrite pipeline, 222 lines
- `src/api/routes/debug.ts` -- full orchestration flow, 598 lines
- `src/safety/rules.ts` -- BLOCKED_PATTERNS, DEFAULT_RULES
- `src/safety/validator.ts` -- validation pipeline, 117 lines
- `src/skills/allowlist.ts` -- skill-level tool enforcement
- `src/orchestrator/context.ts` -- message building, MANDATORY_EXECUTION_PROTOCOL
- All 7 skill markdown files in `skills/`

### Architecture Confidence
- **Schema change:** HIGH -- straightforward Zod union for backward compat
- **Engine changes:** HIGH -- adapter pattern keeps internals unchanged
- **Skill content redesign:** HIGH -- domain knowledge pattern is well-understood
- **Migration path:** HIGH -- incremental, each step independently testable
- **Safety preservation:** HIGH -- all three safety layers maintained

## Metadata

**Research date:** 2026-03-14
**Valid until:** 2026-04-14 (stable architecture, internal codebase)
