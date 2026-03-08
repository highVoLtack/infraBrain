# Phase 2: Skill System and Orchestrator - Research

**Researched:** 2026-03-08
**Domain:** Markdown skill file parsing, LLM-based orchestration, structured output generation, log format parsing
**Confidence:** HIGH

## Summary

Phase 2 builds the skill system (loader, validator, registry) and orchestrator (skill selection, context injection, fix plan generation) on top of Phase 1's LLM provider, safety layer, and state management. The core challenge is designing a clean skill file format with YAML frontmatter, loading/validating it with Zod, and wiring skill context into the existing AI SDK `generateText`/`generateObject` calls using multi-message conversation patterns.

The project already has strong foundations: Zod for validation, AI SDK v6 for LLM interaction, Express for API, Commander for CLI, and write-through state persistence. Phase 2 adds one new dependency (`gray-matter` for YAML frontmatter parsing) and extends existing modules. The skill file format follows obra/superpowers conventions (YAML frontmatter with name/description/triggers, markdown body with sections) but adds a per-skill tool allowlist for defense-in-depth safety.

**Primary recommendation:** Use `gray-matter` for frontmatter parsing, Zod schemas for skill validation, AI SDK `generateObject` with Zod schemas for structured fix plan output, and a simple registry pattern (Map) for in-memory skill storage. Keep the orchestrator thin -- it selects a skill, injects context, and delegates to the existing provider.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Skill file format follows obra/superpowers: YAML frontmatter (name, description, triggers), ## System Prompt, ## Tools, ## Examples
- Per-skill tool allowlist in frontmatter -- each skill declares allowed shell commands; orchestrator enforces on top of global safety rules
- Malformed skill files rejected with clear error messages; other valid skills still load
- Default skills directory is skills/ at project root, configurable via .infrabrain/config.json
- LLM-based routing: send user input + skill summaries to LLM, it picks best match
- Always show skill selection to admin: "Using skill: Log Analysis -- detected log-related query."
- Admin can override with --skill flag
- Skill context injected as multi-message conversation: system prompt as system message, skill context as assistant message, user input as user message
- Single command per step granularity in fix plans
- Per-step rollback information (undo command for each step)
- Both JSON and Markdown storage for fix plans
- No time estimates in fix plans; show step count and complexity
- Plan displayed as numbered CLI table: # | Command | Risk | Status
- Two-pass log filtering: grep first, LLM analyzes filtered set
- Four log formats in v1: syslog, JSON structured, Docker, journald -- each gets a parser normalizing to common format (timestamp, level, message, source)
- Log access via shell commands through existing safety layer
- Log context fits within 4K token budget (~200 lines); truncate with note if more

### Claude's Discretion
- Exact YAML frontmatter schema fields beyond name/description/triggers/tools
- Log format auto-detection heuristics within each parser
- Skill routing prompt engineering (how to present skill summaries to LLM)
- Fix plan Markdown template layout
- Error message formatting for malformed skills

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| CORE-03 | System loads and parses Markdown skill files containing prompts and tool definitions | gray-matter for frontmatter parsing, fs.readdirSync for directory scanning, Zod schema for validation |
| CORE-04 | System validates skill files against a defined format spec on load | Zod schema validation with detailed error messages per field; reject malformed, keep valid |
| CORE-05 | Orchestrator reads user input and selects appropriate skills from the library | AI SDK generateObject with Zod enum schema for skill selection; multi-message conversation injection |
| SKIL-01 | Core planning skill decomposes problems into fix plan steps | AI SDK generateObject with FixPlan Zod schema; JSON + Markdown dual output |
| SKIL-02 | Core verification skill writes health checks that fail before/pass after | Skill file with health check generation prompt; output as executable shell commands |
| SKIL-03 | Log analysis skill pre-filters logs before LLM analysis | Two-pass architecture: shell grep/journalctl first, then LLM on filtered results |
| SKIL-04 | Log analysis skill handles syslog, JSON, Docker, journald formats | Four parsers normalizing to common LogEntry interface (timestamp, level, message, source) |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| gray-matter | ^4.0.3 | YAML frontmatter parsing from Markdown files | Battle-tested, used by Gatsby/Astro/VitePress, TypeScript types included, ESM support |
| zod | ^4.3.6 (already installed) | Skill file schema validation, structured LLM output schemas | Already in project for config validation; consistent pattern |
| ai | ^6.0.116 (already installed) | generateText/generateObject for LLM calls with messages array | Already in project; generateObject provides type-safe structured output with Zod schemas |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| chalk | ^5.6.2 (already installed) | CLI output formatting for skill selection messages and plan tables | Skill selection announcements, plan table rendering |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| gray-matter | Manual regex parsing | gray-matter handles edge cases (multi-line values, special chars, TOML/JSON frontmatter) |
| generateObject for routing | generateText + JSON.parse | generateObject provides Zod validation and type safety; no manual parsing needed |
| In-memory Map registry | SQLite skill index | Overkill for v1; skill count will be small; Map is simpler and faster |

**Installation:**
```bash
npm install gray-matter
npm install -D @types/gray-matter
```

Note: Check if `@types/gray-matter` is needed -- gray-matter v4.x may ship types inline. If the package includes types, skip the `@types` devDependency.

## Architecture Patterns

### Recommended Project Structure
```
src/
  skills/
    types.ts          # SkillFile, SkillRegistry, LogEntry interfaces + Zod schemas
    loader.ts         # loadSkillFile(), loadSkillDirectory() -- gray-matter + Zod
    registry.ts       # SkillRegistry class (Map-based, startup population)
    format.ts         # Markdown section parser (## System Prompt, ## Tools, ## Examples)
  orchestrator/
    types.ts          # OrchestratorResult, FixPlan, FixStep, SkillSelection interfaces
    router.ts         # selectSkill() -- LLM-based routing via generateObject
    planner.ts        # generateFixPlan() -- produces FixPlan JSON + Markdown
    context.ts        # buildMessages() -- assembles multi-message conversation array
  log-analysis/
    types.ts          # LogEntry, LogFormat enum, ParsedLog interfaces
    detector.ts       # detectLogFormat() -- auto-detection heuristics
    parsers/
      syslog.ts       # parseSyslog() -> LogEntry[]
      json.ts         # parseJsonLog() -> LogEntry[]
      docker.ts       # parseDockerLog() -> LogEntry[]
      journald.ts     # parseJournaldLog() -> LogEntry[]
      index.ts        # parseLog() dispatcher based on detected format
    filter.ts         # preFilterLogs() -- grep/truncate to fit token budget
skills/                 # Default skill files directory (project root)
  planning.md         # Core planning skill
  verification.md     # Core verification skill
  log-analysis.md     # Core log analysis skill
```

### Pattern 1: Skill File Format (YAML Frontmatter + Markdown Sections)
**What:** Each skill is a single Markdown file with YAML frontmatter for metadata and named Markdown sections for content
**When to use:** All skill definitions

```markdown
---
name: log-analysis
description: Use when the user reports log-related issues, error messages, or needs help analyzing system logs
triggers:
  - log
  - error
  - journal
  - syslog
  - docker logs
tools:
  - grep
  - journalctl
  - docker logs
  - tail
  - cat
---

## System Prompt

You are a log analysis specialist. Given filtered log entries...

## Tools

Commands this skill is allowed to execute:
- `grep` -- search log files for patterns
- `journalctl` -- query systemd journal
- `docker logs` -- view container logs
- `tail` / `cat` -- read log files

## Examples

### Example: Nginx 502 Error
User: "Why is nginx returning 502?"
Steps:
1. Check nginx error log: `grep -i "error\|502" /var/log/nginx/error.log | tail -50`
2. Check upstream service: `docker logs backend --tail 100`
```

### Pattern 2: Zod Schema for Skill Validation
**What:** Use Zod to validate parsed frontmatter and enforce required sections
**When to use:** During skill file loading

```typescript
import { z } from 'zod';

export const SkillFrontmatterSchema = z.object({
  name: z.string().min(1, 'Skill name is required'),
  description: z.string().min(10, 'Description must be at least 10 characters'),
  triggers: z.array(z.string()).min(1, 'At least one trigger keyword required'),
  tools: z.array(z.string()).default([]),
  // Discretion fields
  version: z.string().optional(),
  author: z.string().optional(),
  priority: z.number().default(0),
});

export const SkillSectionsSchema = z.object({
  systemPrompt: z.string().min(1, '## System Prompt section is required'),
  tools: z.string().optional(),
  examples: z.string().optional(),
});

export type SkillFrontmatter = z.infer<typeof SkillFrontmatterSchema>;
export type SkillSections = z.infer<typeof SkillSectionsSchema>;

export interface SkillFile {
  frontmatter: SkillFrontmatter;
  sections: SkillSections;
  rawContent: string;
  filePath: string;
}
```

### Pattern 3: Multi-Message Conversation Injection
**What:** Assemble skill context as a proper messages array for AI SDK generateText/generateObject
**When to use:** Every time orchestrator calls LLM with skill context

```typescript
import { generateText } from 'ai';
import type { LanguageModel } from 'ai';

// Build messages array from skill + user input
function buildMessages(skill: SkillFile, userInput: string) {
  return {
    system: skill.sections.systemPrompt,
    messages: [
      {
        role: 'assistant' as const,
        content: `I am the ${skill.frontmatter.name} skill. My capabilities:\n\n${skill.sections.tools ?? ''}\n\n${skill.sections.examples ?? ''}`,
      },
      {
        role: 'user' as const,
        content: userInput,
      },
    ],
  };
}

// Usage with generateText
const { system, messages } = buildMessages(selectedSkill, userInput);
const result = await generateText({
  model,
  system,
  messages,
  maxOutputTokens: 4096,
});
```

### Pattern 4: Structured Fix Plan via generateObject
**What:** Use AI SDK generateObject with a Zod schema to get type-safe fix plans
**When to use:** Planning skill generating fix plans

```typescript
import { generateObject } from 'ai';
import { z } from 'zod';

const FixStepSchema = z.object({
  command: z.string().describe('Single shell command to execute'),
  description: z.string().describe('Human-readable description of what this step does'),
  rollback: z.string().describe('Command to undo this step'),
  risk: z.enum(['read', 'write', 'destructive']).describe('Risk level of this command'),
});

const FixPlanSchema = z.object({
  summary: z.string().describe('Brief description of the overall fix'),
  steps: z.array(FixStepSchema).describe('Ordered list of fix steps, one command each'),
  complexity: z.enum(['simple', 'moderate', 'complex']).describe('Overall plan complexity'),
});

const { object: plan } = await generateObject({
  model,
  system: skill.sections.systemPrompt,
  messages: [...],
  schema: FixPlanSchema,
});
// plan is fully typed: plan.steps[0].command, plan.steps[0].rollback, etc.
```

### Pattern 5: Per-Skill Tool Allowlist Enforcement
**What:** Check commands against skill's declared tools before passing to global safety validator
**When to use:** Before any command from a skill reaches the safety layer

```typescript
function enforceSkillAllowlist(command: string, skill: SkillFile): boolean {
  if (skill.frontmatter.tools.length === 0) return true; // No restriction

  const baseCommand = command.trim().split(/\s+/)[0];
  return skill.frontmatter.tools.includes(baseCommand);
}

// In orchestrator pipeline:
// 1. Check skill allowlist (per-skill defense)
// 2. Then check global safety validator (existing validateCommand)
```

### Pattern 6: LLM-Based Skill Selection via generateObject
**What:** Use generateObject to have the LLM pick the best skill from available options
**When to use:** When user input arrives and no --skill override is provided

```typescript
const SkillSelectionSchema = z.object({
  selectedSkill: z.string().describe('The name of the most appropriate skill'),
  reasoning: z.string().describe('Brief explanation of why this skill was selected'),
});

async function selectSkill(
  model: LanguageModel,
  userInput: string,
  skills: SkillFile[],
): Promise<{ skillName: string; reasoning: string }> {
  const skillSummaries = skills
    .map(s => `- ${s.frontmatter.name}: ${s.frontmatter.description}`)
    .join('\n');

  const { object } = await generateObject({
    model,
    system: 'You are a skill router. Given a user query and available skills, select the most appropriate skill.',
    prompt: `User query: "${userInput}"\n\nAvailable skills:\n${skillSummaries}\n\nSelect the best skill.`,
    schema: SkillSelectionSchema,
  });

  return { skillName: object.selectedSkill, reasoning: object.reasoning };
}
```

### Anti-Patterns to Avoid
- **String concatenation for prompts:** Do not concatenate system prompt + skill context + user input as a single string. Use the messages array pattern -- the LLM instruction-follows better with proper role separation.
- **Loading skills on every request:** Load once at startup, store in registry. Only reload if admin explicitly requests it or on SIGHUP.
- **Parsing YAML manually with regex:** Use gray-matter. YAML has edge cases (multi-line strings, special characters, anchors) that regex cannot handle.
- **Trusting LLM-generated commands without allowlist check:** Even with a good system prompt, the LLM may suggest commands outside the skill's domain. Always enforce the tool allowlist programmatically.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| YAML frontmatter parsing | Custom regex splitter | gray-matter | Handles edge cases, battle-tested, TypeScript types |
| Structured LLM output | JSON.parse on raw text | AI SDK generateObject + Zod | Type-safe, auto-validates, retries on malformed output |
| Skill file validation | Manual if/else checks | Zod schema .parse() with .safeParse() | Detailed error messages per field, composable, already in project |
| Log timestamp parsing | Custom regex per format | Date constructor + format-specific regex | Keep parsers thin; just extract fields, let Date handle parsing |
| CLI table rendering | Manual string padding | chalk + simple fixed-width formatter | Keep it simple; no need for cli-table3 dependency for one table |

**Key insight:** The project already uses Zod extensively. Every new validation concern (skill files, fix plans, log entries) should use Zod schemas. This keeps the codebase consistent and gives you free TypeScript types via `z.infer`.

## Common Pitfalls

### Pitfall 1: gray-matter Returns content Without Frontmatter Delimiters
**What goes wrong:** Developers expect `matter(file).content` to include the `---` delimiters or the frontmatter. It only contains the body after frontmatter.
**Why it happens:** gray-matter strips delimiters and separates data from content.
**How to avoid:** Use `matter(file).data` for parsed frontmatter object, `matter(file).content` for the Markdown body. Parse sections from `.content` only.
**Warning signs:** Empty data object or missing sections.

### Pitfall 2: generateObject May Fail with Smaller Models
**What goes wrong:** Ollama models (especially smaller ones like 7B) may not reliably produce valid JSON for generateObject.
**Why it happens:** Smaller models have weaker instruction following for structured output.
**How to avoid:** Use the project's configured model (llama3.3:70b by default which is capable). Add fallback: if generateObject fails, fall back to generateText + manual JSON extraction. Test with the actual Ollama model.
**Warning signs:** Repeated Zod validation errors from generateObject responses.

### Pitfall 3: Token Budget Overflow with Skill Context Injection
**What goes wrong:** Injecting skill system prompt + tools + examples + user input exceeds the 4K diagnosis token budget.
**Why it happens:** Skill files can be long, and the budget check in provider.ts only counts prompt + system prompt, not assistant messages.
**How to avoid:** Extend the budget check to account for ALL messages in the conversation array. Skill files should be concise (target < 1K tokens for system prompt + examples combined). Add a warning during skill loading if a skill's content exceeds a threshold.
**Warning signs:** Token budget errors when skills are selected.

### Pitfall 4: Log Pre-Filter Returns Too Much or Too Little
**What goes wrong:** grep returns thousands of lines (too much for LLM) or zero lines (too few to diagnose).
**Why it happens:** Pattern matching is either too broad or too narrow for the specific log format.
**How to avoid:** Implement the truncation note as specified ("Showing 200 of 1,423 matches"). For zero results, broaden the search or report "No matching log entries found" clearly. Use head/tail limits in shell commands.
**Warning signs:** LLM responses that say "I don't see relevant logs" or budget overflow errors.

### Pitfall 5: Skill Allowlist Bypass via Shell Metacharacters
**What goes wrong:** A command like `grep foo; rm -rf /` passes the allowlist check for `grep` but executes a destructive command.
**Why it happens:** Only checking the first word of the command string.
**How to avoid:** The existing safety validator (BLOCKED_PATTERNS) catches `rm -rf` -- this is defense-in-depth. The allowlist is the first check, global safety is the second. Still, split on `;`, `&&`, `||`, `|` and check each sub-command against the allowlist.
**Warning signs:** Commands with shell operators passing allowlist.

### Pitfall 6: gray-matter ESM Import in NodeNext Module Resolution
**What goes wrong:** Import fails or types are wrong because gray-matter may not have clean ESM exports.
**Why it happens:** gray-matter was historically CJS; ESM support was added later.
**How to avoid:** Test the import in the project's ESM+NodeNext setup early. May need `import matter from 'gray-matter'` (default import). If types are missing, use `@types/gray-matter` or a local declaration.
**Warning signs:** TypeScript errors on import, runtime "not a function" errors.

## Code Examples

### Loading a Skill File
```typescript
// Source: gray-matter docs + project Zod patterns
import matter from 'gray-matter';
import { readFileSync } from 'node:fs';
import { SkillFrontmatterSchema, type SkillFile } from './types.js';

function parseSections(content: string): Record<string, string> {
  const sections: Record<string, string> = {};
  const regex = /^## (.+)$/gm;
  let lastKey: string | null = null;
  let lastIndex = 0;

  for (const match of content.matchAll(regex)) {
    if (lastKey !== null) {
      sections[lastKey] = content.slice(lastIndex, match.index).trim();
    }
    lastKey = match[1].toLowerCase().replace(/\s+/g, '_');
    lastIndex = match.index! + match[0].length;
  }
  if (lastKey !== null) {
    sections[lastKey] = content.slice(lastIndex).trim();
  }
  return sections;
}

export function loadSkillFile(filePath: string): SkillFile {
  const raw = readFileSync(filePath, 'utf-8');
  const { data, content } = matter(raw);

  // Validate frontmatter with Zod
  const frontmatter = SkillFrontmatterSchema.parse(data);

  // Parse markdown sections
  const rawSections = parseSections(content);
  const sections = {
    systemPrompt: rawSections['system_prompt'] ?? '',
    tools: rawSections['tools'],
    examples: rawSections['examples'],
  };

  if (!sections.systemPrompt) {
    throw new Error(`Skill "${filePath}": missing required ## System Prompt section`);
  }

  return { frontmatter, sections, rawContent: content, filePath };
}
```

### Fix Plan Markdown Generation
```typescript
// Generate human-readable Markdown summary from FixPlan JSON
function generatePlanMarkdown(plan: FixPlan): string {
  const lines = [
    `# Fix Plan: ${plan.summary}`,
    '',
    `**Steps:** ${plan.steps.length} | **Complexity:** ${plan.complexity}`,
    '',
    '| # | Command | Risk | Rollback |',
    '|---|---------|------|----------|',
  ];

  for (const [i, step] of plan.steps.entries()) {
    lines.push(`| ${i + 1} | \`${step.command}\` | ${step.risk} | \`${step.rollback}\` |`);
  }

  return lines.join('\n');
}
```

### Log Format Auto-Detection
```typescript
// Heuristic-based log format detection
export enum LogFormat {
  SYSLOG = 'syslog',
  JSON = 'json',
  DOCKER = 'docker',
  JOURNALD = 'journald',
}

export function detectLogFormat(sample: string): LogFormat {
  const firstLine = sample.split('\n')[0]?.trim() ?? '';

  // JSON structured: starts with {
  if (firstLine.startsWith('{')) return LogFormat.JSON;

  // Docker: timestamp followed by container ID pattern
  // e.g., "2024-01-15T10:30:00.000000000Z container_name | message"
  if (/^\d{4}-\d{2}-\d{2}T[\d:.]+Z\s/.test(firstLine)) return LogFormat.DOCKER;

  // Journald: "-- Journal begins" or "Mon DD HH:MM:SS hostname kernel:"
  if (firstLine.startsWith('-- Journal') || /^\w{3}\s+\d{1,2}\s+[\d:]+\s+\S+\s+\S+\[?\d*\]?:/.test(firstLine)) {
    return LogFormat.JOURNALD;
  }

  // Syslog: "Mon DD HH:MM:SS hostname process[pid]: message" (traditional BSD format)
  if (/^\w{3}\s+\d{1,2}\s+[\d:]+\s/.test(firstLine)) return LogFormat.SYSLOG;

  // Default to syslog as most common
  return LogFormat.SYSLOG;
}
```

### Common Log Entry Interface
```typescript
export interface LogEntry {
  timestamp: string;    // ISO 8601 normalized
  level: string;        // normalized: error, warn, info, debug
  message: string;      // log message content
  source: string;       // process name, container name, or unit name
  raw: string;          // original unparsed line
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| prompt as single string | messages array with roles | AI SDK v4+ | Better instruction following, proper conversation context |
| JSON.parse on LLM text output | generateObject with Zod schema | AI SDK v3+ | Type-safe structured output, automatic validation |
| Manual YAML parsing | gray-matter library | Stable since 2017 | Handles all edge cases, widely adopted |
| Custom frontmatter format | obra/superpowers SKILL.md convention | 2024-2025 | Community standard for AI skill files |

**Deprecated/outdated:**
- AI SDK `maxTokens` parameter: renamed to `maxOutputTokens` in v6 (already handled in Phase 1)
- AI SDK `LanguageModelV1` type: renamed to `LanguageModel` in v6 (already handled in Phase 1)

## Open Questions

1. **gray-matter ESM compatibility with NodeNext**
   - What we know: gray-matter v4.0.3 has had ESM PRs merged, should work with default import
   - What's unclear: Whether it works cleanly with `"module": "NodeNext"` in tsconfig without workarounds
   - Recommendation: Test the import early in the first task. If it fails, use a thin wrapper or the `front-matter` npm package as alternative.

2. **generateObject reliability with Ollama models**
   - What we know: AI SDK generateObject works well with OpenAI/Anthropic APIs. Ollama support depends on the model's structured output capability.
   - What's unclear: Whether llama3.3:70b via ai-sdk-ollama reliably produces valid JSON for generateObject
   - Recommendation: Build the fix plan generation with generateObject but include a generateText fallback that extracts JSON from markdown code blocks. Test during implementation.

3. **Skill routing accuracy with few skills**
   - What we know: LLM routing works well when skill descriptions are distinct
   - What's unclear: How well routing works with only 3 skills (planning, verification, log-analysis) -- may be overkill vs. keyword matching
   - Recommendation: Implement LLM routing as decided. If it proves unreliable, the trigger keywords in frontmatter provide a fallback heuristic. The --skill override is always available.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.0.18 |
| Config file | vitest.config.ts |
| Quick run command | `npx vitest run --reporter=verbose` |
| Full suite command | `npx vitest run` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CORE-03 | Load and parse Markdown skill files | unit | `npx vitest run tests/skills/loader.test.ts -t "loads valid skill file"` | No - Wave 0 |
| CORE-04 | Validate skill files against format spec | unit | `npx vitest run tests/skills/loader.test.ts -t "rejects malformed"` | No - Wave 0 |
| CORE-05 | Orchestrator selects appropriate skill | unit | `npx vitest run tests/orchestrator/router.test.ts -t "selects skill"` | No - Wave 0 |
| SKIL-01 | Planning skill decomposes into fix plan steps | unit | `npx vitest run tests/orchestrator/planner.test.ts -t "generates fix plan"` | No - Wave 0 |
| SKIL-02 | Verification skill generates health checks | unit | `npx vitest run tests/skills/verification.test.ts -t "generates health check"` | No - Wave 0 |
| SKIL-03 | Log analysis pre-filters logs | unit | `npx vitest run tests/log-analysis/filter.test.ts -t "pre-filters"` | No - Wave 0 |
| SKIL-04 | Log analysis handles 4 log formats | unit | `npx vitest run tests/log-analysis/parsers.test.ts -t "parses"` | No - Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run --reporter=verbose`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/skills/loader.test.ts` -- covers CORE-03, CORE-04 (skill loading and validation)
- [ ] `tests/orchestrator/router.test.ts` -- covers CORE-05 (skill selection)
- [ ] `tests/orchestrator/planner.test.ts` -- covers SKIL-01 (fix plan generation)
- [ ] `tests/skills/verification.test.ts` -- covers SKIL-02 (health check generation)
- [ ] `tests/log-analysis/filter.test.ts` -- covers SKIL-03 (log pre-filtering)
- [ ] `tests/log-analysis/parsers.test.ts` -- covers SKIL-04 (format parsing)
- [ ] `tests/fixtures/skills/` -- sample valid and malformed .md skill files for testing
- [ ] `tests/fixtures/logs/` -- sample log files in each of 4 formats for parser tests

## Sources

### Primary (HIGH confidence)
- Project source code (src/**/*.ts) -- direct inspection of existing patterns, types, and integration points
- CONTEXT.md -- locked user decisions constraining all design choices
- AI SDK official docs (ai-sdk.dev) -- generateText messages array, generateObject with Zod schemas
- gray-matter npm/GitHub -- frontmatter parsing API, TypeScript support

### Secondary (MEDIUM confidence)
- obra/superpowers SKILL.md format -- skill file convention (GitHub repo inspection)
- Vitest documentation -- test framework configuration

### Tertiary (LOW confidence)
- generateObject + Ollama reliability -- needs hands-on validation (no direct evidence for llama3.3:70b)
- gray-matter ESM + NodeNext compatibility -- needs hands-on validation

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - gray-matter is battle-tested, all other deps already in project
- Architecture: HIGH - patterns follow existing project conventions (Zod, feature modules, factory pattern)
- Pitfalls: MEDIUM - LLM-related pitfalls (generateObject reliability, token budget) need runtime validation
- Log parsing: MEDIUM - format detection heuristics are reasonable but need tuning with real log samples

**Research date:** 2026-03-08
**Valid until:** 2026-04-07 (30 days -- stable domain, no fast-moving dependencies)
