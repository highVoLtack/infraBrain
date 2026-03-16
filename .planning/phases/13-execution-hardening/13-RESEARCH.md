# Phase 13: Execution Hardening - Research

**Researched:** 2026-03-16
**Domain:** Self-healing executor hardening, sanity checker tuning, model routing validation
**Confidence:** HIGH

## Summary

Phase 13 addresses three concrete gaps exposed by the multi-fault demo (5/5 faults, 4 autonomous, 1 manual assist). The gaps are well-defined and localized: (1) the executor does not verify that fixes survive container restarts, (2) the sanity checker's `<tag>` regex catches legitimate structured diagnosis output as false positives, and (3) triage routing uses the full 122B model when a smaller model would suffice.

All three changes are surgical modifications to existing modules with clear test boundaries. No new architectural patterns are needed -- this is hardening of the existing self-healing executor, sanity checker, and model routing subsystems. The codebase is mature (554+ tests, 60+ source files) and the changes are additive rather than structural.

**Primary recommendation:** Implement in 2-3 plans: (1) post-restart persistence verification in the executor, (2) sanity checker regex tuning + structured diagnosis exemption, (3) model routing documentation + E2E validation of dev logging.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| ENGN-09 | Execution Hardening from multi-fault learnings | All three scope items (persistence verification, sanity tuning, routing validation) directly implement ENGN-09. Post-restart verification closes the `sed -i` gap. Sanity tuning eliminates false positives. Routing validation documents optimal model assignments. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| vitest | (existing) | Test framework | Already used across 46+ test files, 554+ tests |
| zod | (existing) | Schema validation | Already used for FixStep, StructuredDiagnosis, config |
| ai (Vercel AI SDK) | (existing) | LLM interaction | Already used for generateText, generateObject |
| ai-sdk-ollama | (existing) | Ollama provider | Already wired into model registry |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| chalk | (existing) | Dev-mode console output | DEV_MODE logging for [SELF-HEAL], [SANITY] |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Regex sanity checker | LLM-based sanity check | Too expensive (47s per call), regex is fast and sufficient when tuned |
| Docker commit snapshots | ZFS snapshots | ZFS not available on RunPod, Docker commit is universal |

**Installation:**
No new dependencies needed. All changes use existing libraries.

## Architecture Patterns

### Recommended Project Structure
```
src/
  execution/
    self-healer.ts       # Add post-restart verification logic
    executor.ts          # Wire persistence verification after restart steps
    types.ts             # Add PersistenceVerification type (if needed)
  api/routes/
    debug.ts             # Tune HALLUCINATION_PATTERNS, add structured diagnosis exemption
  config/
    types.ts             # Already has 7-role ModelMap -- document recommended assignments
```

### Pattern 1: Post-Restart Persistence Verification
**What:** After a fix step that includes `docker restart` (or `CONFIG SET` + config file edit), re-run the original discovery/verification command to confirm the fix survived the restart.
**When to use:** Any fix plan where a step modifies a config file AND a subsequent step restarts the service.
**Implementation approach:**

The current executor processes steps sequentially. The persistence verification should be a new phase that activates when:
1. A step modifies a config file (detected via `sed`, `tee`, `echo >>`, `CONFIG SET`)
2. A subsequent step restarts the container (`docker restart`, `docker compose restart`)

After the restart step succeeds, the executor should:
1. Wait briefly for the container to be healthy (existing timeout mechanism)
2. Re-run a verification command that checks the config change persists
3. If the change reverted, the self-healer should retry with a persistent approach (e.g., `sed -i` instead of `sed`, or editing the actual config file)

**Key insight from multi-fault demo:** The Redis fix used `CONFIG SET` for runtime + `sed` (without `-i`) for persistence. The `sed` wrote to stdout instead of modifying in-place. After `docker restart`, the runtime config reverted to the file config, undoing the fix. The self-healer needs to detect this pattern.

**Detection strategy:**
- Track which steps are "config modification" steps (heuristic: contains `sed`, `tee`, `echo >`, `CONFIG SET`, `config set`, writes to a config path)
- Track which steps are "restart" steps (heuristic: contains `restart`, `reload`)
- After a restart step, if there was a preceding config modification step, run a verification command
- The verification command should be the same type as verifyEffect() -- a read-only check
- If verification fails, flag the config modification step for self-heal retry with explicit `-i` flag or alternative persistent approach

### Pattern 2: Sanity Checker Structured Diagnosis Exemption
**What:** The `/<[a-z][a-z0-9_-]*>/i` regex in HALLUCINATION_PATTERNS catches legitimate content like `<original-image>` in Docker inspect output, Dockerfile references, and structured diagnosis fields.
**When to use:** When the LLM returns a StructuredDiagnosis object (via generateObject), the output is already schema-validated by Zod -- no free-text hallucination possible for command fields. The sanity checker should only run on free-text diagnosis paths.

**Tuning approach:**
1. Skip sanity check entirely for StructuredDiagnosis path (Zod schema validation is stronger)
2. For free-text path, refine the `<tag>` regex to exclude known Docker/infrastructure terms: `<none>`, `<missing>`, `<local>`, `<original-image>` etc.
3. Add a whitelist of known legitimate angle-bracket patterns that appear in Docker output

### Pattern 3: Model Role Documentation
**What:** Document recommended model assignments per role based on multi-fault demo evidence.
**Evidence from demo:**
- Triage: 122B takes 13s, target is <3s. Needs smaller model (7B-14B range).
- Default/Strategic: 122B works well for diagnosis and planning (42s total with SSH)
- Worker: GLM-4.7-Flash too weak for self-heal corrections -- cannot reason about state changes
- Forensic: Deep reasoning for complex multi-step failures

**Role requirements:**
| Role | Requirement | Recommended Size | Why |
|------|------------|-----------------|-----|
| triage | Fast skill selection (<3s) | 7B-14B | Simple classification task, no reasoning needed |
| default | General diagnosis | 32B-70B | Needs domain knowledge but not deep reasoning |
| strategic | Fix planning + corrections | 70B+ | Must reason about state changes, generate correct commands |
| forensic | Complex failure analysis | 70B+ (CoT) | Deep reasoning, chain-of-thought for multi-step correlation |
| worker | Self-heal corrections | 32B+ | Must understand error messages and generate alternatives |
| vision | Screenshot analysis | Vision model | Specialized -- only when visual evidence needed |
| embedding | Semantic search | BGE-M3 | Fixed -- embedding model for future Qdrant integration |

### Anti-Patterns to Avoid
- **Hardcoding persistence fix patterns:** Do NOT add regex-based command rewriting for `sed -i`. The self-healer should detect the revert and let the LLM generate the correct persistent command. This is the same anti-pattern as `fixKnownCommandErrors` which was deleted in Phase 12.6.
- **Over-aggressive sanity checking:** The sanity checker should be a safety net, not a gate. False positives cost 47s per retry and break the flow. When in doubt, pass through and let the execution pipeline handle issues.
- **Testing against live LLMs in unit tests:** All Phase 13 tests should use mocked LLM responses. The multi-fault live demo is the real validation, not unit tests with real models.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Config change detection | Custom file diff system | Heuristic command pattern matching | Simple string matching on step commands is sufficient; no need for filesystem monitoring |
| Restart detection | Container health polling | Exit code + brief delay | Docker restart is synchronous; exit code 0 means container is up |
| Model benchmarking | Custom benchmark framework | Manual testing + documentation | v1.3 will have a proper benchmark framework; Phase 13 just documents recommendations |

**Key insight:** Phase 13 is hardening, not new features. Every change is a surgical fix to existing code, not a new subsystem.

## Common Pitfalls

### Pitfall 1: Verification Command Races After Restart
**What goes wrong:** Verifying a config change immediately after `docker restart` may fail because the container hasn't finished starting.
**Why it happens:** Container restart is async internally -- the Docker daemon reports success but the service inside may still be initializing.
**How to avoid:** Add a configurable delay (e.g., 2-3s) after restart before running verification. Or use a health check polling loop with timeout.
**Warning signs:** Verification fails intermittently on fast machines but passes on slow ones.

### Pitfall 2: Structured Diagnosis vs Free-Text Code Paths
**What goes wrong:** The sanity checker runs on the flattened text of a StructuredDiagnosis, catching legitimate field values.
**Why it happens:** `flattenDiagnosis()` (debug.ts:256) converts the structured object to text, and `checkForHallucinations()` runs on line 480 AFTER flattening. The `<tag>` regex catches real Docker output embedded in command/output fields.
**How to avoid:** Skip `checkForHallucinations()` when `structuredDiagnosis` is set (the Zod schema already validates the structure). Only run sanity check on the free-text fallback path.
**Warning signs:** 47s extra LLM call on valid structured diagnoses.

### Pitfall 3: Self-Healer Doesn't Know About Restarts
**What goes wrong:** The self-healer treats each step independently. It doesn't know that step N modified a config and step N+2 restarted the container, reverting step N.
**Why it happens:** The executor processes steps linearly with no cross-step dependency tracking.
**How to avoid:** Add a lightweight "config modification tracker" to the executor that records which steps modified configs. After restart steps, trigger a re-verification of those earlier modifications.
**Warning signs:** Fix succeeds per-step but the overall system state regresses after restart.

### Pitfall 4: Regex Exemption List Maintenance
**What goes wrong:** Adding Docker-specific exemptions to the sanity checker creates a maintenance burden as new tools/outputs emerge.
**Why it happens:** The hallucination patterns are regex-based and fragile.
**How to avoid:** Prefer the structured diagnosis path (Phase 13 should make it the default). For the free-text fallback, use a narrow exemption list and document it.
**Warning signs:** New skills triggering false positives that require pattern updates.

## Code Examples

### Post-Restart Persistence Verification (Executor Integration Point)

The key integration point is in `executor.ts` after step execution succeeds. Currently (line 336-358), after a step succeeds, the executor deducts budget and adds to rolling context. The persistence verification should be inserted between step success and context update:

```typescript
// In executor.ts, after step succeeds (line 336+):

// Check if this was a restart step AND there were preceding config modifications
if (isRestartStep(commandUsed) && configModifications.length > 0) {
  // Wait for container to stabilize
  await new Promise(resolve => setTimeout(resolve, 3000));

  // Re-verify each config modification
  for (const configMod of configModifications) {
    const persistenceCheck = await verifyEffect(configMod.command, healContext);
    if (!persistenceCheck.verified) {
      // Config change reverted! Flag for self-heal retry
      if (DEV_MODE) console.log(`[SELF-HEAL] Config change reverted after restart: ${configMod.command}`);
      // Re-execute the config modification step through self-healer
      // The self-healer will get context about the revert and should generate a persistent version
    }
  }
}
```

### Sanity Checker Tuning (debug.ts)

Current problematic pattern (line 57):
```typescript
// CURRENT: catches <original-image>, <none>, etc.
/<[a-z][a-z0-9_-]*>/i,
```

Refined pattern:
```typescript
// IMPROVED: exclude known Docker/infrastructure terms
const DOCKER_LEGITIMATE_TAGS = new Set([
  'none', 'missing', 'local', 'original-image', 'no-value',
]);

// In checkForHallucinations():
const tagMatch = text.match(/<([a-z][a-z0-9_-]*)>/i);
if (tagMatch && !DOCKER_LEGITIMATE_TAGS.has(tagMatch[1].toLowerCase())) {
  violations.push(`Found hallucination pattern: "${tagMatch[0]}"`);
}
```

Better approach -- skip sanity check for structured diagnosis:
```typescript
// In debug.ts, around line 479:
// Only run sanity check on FREE-TEXT diagnosis (not structured)
if (!structuredDiagnosis) {
  const violations = checkForHallucinations(diagnosis);
  // ... existing retry logic
}
```

### Config Modification Detection Heuristic
```typescript
// Heuristic to detect config-modifying steps
function isConfigModification(command: string): boolean {
  const patterns = [
    /\bsed\b/,           // sed (with or without -i)
    /\btee\b/,           // tee to file
    /\becho\b.*>/,       // echo redirect
    /\bCONFIG\s+SET\b/i, // Redis CONFIG SET
    /\bALTER\s+SYSTEM\b/i, // Postgres ALTER SYSTEM
  ];
  return patterns.some(p => p.test(command));
}

function isRestartStep(command: string): boolean {
  return /\brestart\b|\breload\b/.test(command);
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| fixKnownCommandErrors regex patches | Self-healing executor (LLM correction loop) | Phase 12.6 (2026-03-14) | Eliminated all hardcoded command fixes |
| 3-role model routing | 7-role model routing | Multi-fault demo (2026-03-15) | triage/default/strategic/forensic/worker/vision/embedding |
| Single sanity check | Sanity check + retry with grounding penalty | Phase 9 (2026-03-13) | Catches hallucinations but can false-positive |
| Per-step rollback only | Self-healing with escalation advice | Phase 12.6 (2026-03-14) | worker->strategic->forensic escalation on exhaustion |

**Deprecated/outdated:**
- `fixKnownCommandErrors()`: Deleted in Phase 12.6-02. Self-healing replaces it.
- `inferCorrectionHints()`: Kept as no-op. LLM reasons from stderr directly.
- `rewriteForContainer()` / `stripHostFlag()`: Deprecated, replaced by dynamic rewriter.

## Open Questions

1. **State Rollbacks scope**
   - What we know: The `rollback` field on FixStep is rarely populated by LLMs. `docker commit` could snapshot container state before execution. Current rollback.ts only executes step.rollback if populated.
   - What's unclear: Should Phase 13 implement infrastructure-level rollbacks (Docker commit), or defer to v1.3? Docker commit creates large images and adds latency.
   - Recommendation: **Defer to v1.3.** Phase 13 scope is already well-defined. State rollbacks are a research topic per the roadmap ("may become Phase 13.1"). Focus on the three concrete gaps first.

2. **Restart verification delay**
   - What we know: Docker restart returns immediately but internal service may take seconds to start.
   - What's unclear: Optimal delay value. Too short = false negative verification. Too long = wasted time.
   - Recommendation: Use a configurable value in `selfHealing` config (default 3000ms), with retry on failure.

3. **E2E test sanity checker mocks**
   - What we know: "E2E tests (6 files) have sanity-checker mock compatibility issues" (from .continue-here.md)
   - What's unclear: Which specific E2E tests are affected and how the mocks need updating.
   - Recommendation: Fix as part of sanity checker tuning plan. Structured diagnosis exemption may resolve the issue.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest (existing) |
| Config file | vitest.config.ts (existing) |
| Quick run command | `npx vitest run tests/api/sanity-checker.test.ts tests/execution/self-healer.test.ts --reporter=verbose` |
| Full suite command | `npx vitest run` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ENGN-09a | Post-restart persistence verification detects reverted fixes | unit | `npx vitest run tests/execution/persistence-verification.test.ts -x` | Wave 0 |
| ENGN-09b | Sanity checker passes valid structured diagnosis | unit | `npx vitest run tests/api/sanity-checker.test.ts -x` | Exists (needs update) |
| ENGN-09c | Sanity checker skips for structured diagnosis path | unit | `npx vitest run tests/api/sanity-checker.test.ts -x` | Exists (needs new test) |
| ENGN-09d | Config modification detection heuristic | unit | `npx vitest run tests/execution/persistence-verification.test.ts -x` | Wave 0 |
| ENGN-09e | Restart step detection heuristic | unit | `npx vitest run tests/execution/persistence-verification.test.ts -x` | Wave 0 |
| ENGN-09f | Dev logging shows all DPEV phases | integration | `npx vitest run tests/api/debug-dpev.test.ts -x` | Exists (may need update) |

### Sampling Rate
- **Per task commit:** `npx vitest run tests/api/sanity-checker.test.ts tests/execution/self-healer.test.ts tests/execution/persistence-verification.test.ts --reporter=verbose`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/execution/persistence-verification.test.ts` -- covers ENGN-09a, ENGN-09d, ENGN-09e
- [ ] Update `tests/api/sanity-checker.test.ts` -- add structured diagnosis exemption test (ENGN-09c)

## Sources

### Primary (HIGH confidence)
- Source code analysis: `src/execution/self-healer.ts`, `src/execution/executor.ts`, `src/api/routes/debug.ts`
- Source code analysis: `src/orchestrator/context.ts` (HALLUCINATION_PATTERNS), `src/config/types.ts` (ModelMap)
- Source code analysis: `src/execution/rollback.ts`, `src/execution/snapshot.ts` (existing rollback infrastructure)
- Project state: `.planning/STATE.md`, `.planning/phases/12.6-self-healing-executor/.continue-here.md`

### Secondary (MEDIUM confidence)
- Multi-fault demo observations documented in STATE.md (key learnings 1-7)
- Roadmap Phase 13 scope definition in ROADMAP.md

### Tertiary (LOW confidence)
- Model size recommendations for triage (7B-14B target) -- needs live validation with actual models on multi-GPU hardware

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new libraries needed, all changes use existing code
- Architecture: HIGH -- all three changes are surgical modifications to well-understood modules
- Pitfalls: HIGH -- pitfalls derived directly from multi-fault demo observations and source code analysis

**Research date:** 2026-03-16
**Valid until:** 2026-04-16 (stable -- internal codebase, no external dependency changes)
