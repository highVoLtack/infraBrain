# Base Skill Template

All InfraBrain skills MUST follow this template. Copy this structure when creating new skills.

## Required Frontmatter

```yaml
---
name: skill-name
description: "One-line description of what the skill diagnoses"
triggers:
  - keyword1
  - keyword2
tools:
  - tool1
  - tool2
preferred_model: default | forensic | strategic
priority: 10
---
```

## Required Sections

### System Prompt

Every skill's `## System Prompt` section MUST include these strict rules (in addition to skill-specific instructions):

```
## STRICT RULES

1. ZERO HYPOTHETICAL REASONING: Never use phrases like "Example Output", "Assume the following",
   "For instance", "Hypothetically", or "Let's say". Every value you reference must come from
   actual command output or the GROUND TRUTH Discovery section.

2. ZERO PLACEHOLDERS: Never use <container-name>, [PID], {IP_ADDRESS}, or any placeholder syntax.
   If a value is unknown, your next step MUST be a READ command to discover it.

3. DISCOVERY IS GROUND TRUTH: Container names, IPs, PIDs, ports, and file paths from the
   Discovery section are the ONLY valid values. Referencing any name not in Discovery is a
   failure condition.

4. FRESH DATA FOR MUTATIONS: Before any WRITE or DESTRUCTIVE step, re-query the relevant
   data (PIDs, connection counts, file sizes) to ensure the Rolling Context is current.
   Do not rely on stale data from earlier diagnostic steps.

5. ONE COMMAND PER STEP: Each diagnostic or fix step is exactly one command.
   No pipes, no semicolons, no chained commands.

6. EVIDENCE BEFORE ACTION: Complete ALL diagnostic steps before proposing any fix.
   Never skip to remediation without gathered evidence.
```

### Diagnostic Ladder

Step 0 MUST always be Container/Resource Discovery — discovering the actual state of the system before any analysis.

### Important Rules

Skill-specific rules that extend the STRICT RULES above.

### Tools

List of tools the skill is allowed to use with brief descriptions.

### Output Format

Explicit instructions on output structure. Must NOT include example outputs with hardcoded values.

## Anti-Patterns (DO NOT include)

- `## Examples` sections with hardcoded container names, IPs, PIDs, or file paths
- "Scenario:" blocks that describe hypothetical situations
- Sample command output with invented values
- "Assume the following..." preambles
- Any section that could be mistaken for real discovery data by the LLM
