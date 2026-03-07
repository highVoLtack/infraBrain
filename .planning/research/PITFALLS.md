# Pitfalls Research

**Domain:** AI IT Operations Platform (local-first, multi-agent, infrastructure automation)
**Researched:** 2026-03-07
**Confidence:** HIGH (multiple verified sources across all pitfall categories)

## Critical Pitfalls

### Pitfall 1: LLM Hallucinated Commands Executing on Real Infrastructure

**What goes wrong:**
The LLM generates a plausible-looking but incorrect command (e.g., `rm -rf /var/log/` instead of `rm -rf /var/log/nginx/error.log`, or `docker rm` instead of `docker restart`) and, if the HITL gate has a gap or the command is classified as "low risk," it executes on production infrastructure. Local models like Llama-3.3-70B and Qwen2.5-Coder-7B hallucinate more frequently than cloud models (GPT-4o, Claude), especially on edge-case infrastructure configurations they were not heavily trained on.

**Why it happens:**
Local models have weaker instruction-following and tool-use capabilities compared to frontier cloud models. The quality gap is narrowing but still significant for 2026, especially for complex multi-step infrastructure reasoning. Developers overestimate local model reliability because simple demos work, then deploy to diverse real-world infrastructure where the model encounters unfamiliar configurations.

**How to avoid:**
- Never auto-execute write commands regardless of perceived risk. Every destructive or mutative command requires HITL approval in v1.
- Implement a command allowlist/denylist system: known-safe read commands (e.g., `cat`, `docker ps`, `systemctl status`) can auto-execute; everything else requires approval.
- Add a "command validator" layer between LLM output and execution that parses commands and flags dangerous patterns (`rm -rf`, `DROP TABLE`, `chmod 777`, wildcard deletions).
- Include the exact command in the approval prompt so the human sees precisely what will run.
- Log every generated command (approved, rejected, or modified) for post-hoc analysis.

**Warning signs:**
- During testing, the LLM generates commands that "look right" but target wrong paths or use wrong flags.
- The model confuses similar services (e.g., issues `systemctl restart nginx` when the problem is in a Docker container).
- Sub-agents produce syntactically valid but semantically wrong shell commands.

**Phase to address:**
Phase 1 (Core Engine). The command validation layer and strict HITL defaults must be in the foundation before any execution capability exists.

---

### Pitfall 2: Runaway Automation and Cascading Failures

**What goes wrong:**
An LLM agent enters a retry loop: it attempts a fix, the fix fails, it diagnoses the failure incorrectly, attempts another fix that makes things worse, and the cycle continues. Each iteration degrades the system further. In multi-agent architectures, one agent's failed fix can trigger another agent to react to the new symptoms, creating a cascade. The OWASP ASI08 standard (2026) specifically identifies cascading failures in agentic AI as a top security threat.

**Why it happens:**
LLM agents lack true state awareness -- they reason about infrastructure from text descriptions and log snippets, not from direct observation. When a fix fails, the error output can mislead the agent into a different (wrong) diagnosis. Without hard circuit breakers, the system will keep trying indefinitely.

**How to avoid:**
- Implement the circuit breaker as a core primitive, not an add-on. Three consecutive failed fix attempts on the same target = automatic halt.
- Implement a "damage budget" per fix session: limit the number of write operations (e.g., max 5 commands per plan), the types of operations allowed, and the scope of affected resources.
- After any failed fix attempt, force a full state re-assessment before allowing another attempt. Do not let the agent reason from stale context.
- Automatic rollback on circuit breaker trip: restore to the state snapshot taken before the first fix attempt.
- Stagnation detection: if three loops produce no measurable change in system state (same health check results), halt and escalate to human.

**Warning signs:**
- During testing, the agent attempts the same fix repeatedly with slight variations.
- Fix plans grow in scope over iterations instead of narrowing.
- The agent's diagnosis changes dramatically between retry attempts (sign of context drift).
- Execution logs show an increasing number of commands per fix session.

**Phase to address:**
Phase 1 (Core Engine) for the circuit breaker mechanism. Phase 3 (Orchestration) for multi-agent cascade prevention. The circuit breaker is not a feature -- it is a safety-critical primitive that must exist before any execution.

---

### Pitfall 3: Context Window Overflow with Infrastructure Data

**What goes wrong:**
Real infrastructure produces enormous amounts of data: a single Nginx error log can be hundreds of MB, `docker inspect` output is verbose JSON, and system state information (processes, ports, configs) easily exceeds any context window. Ollama defaults to 2048 tokens and silently truncates input, discarding the oldest tokens first. This means the system prompt, skill instructions, and initial diagnosis can be silently dropped, causing the agent to lose its safety instructions and operational context.

**Why it happens:**
Developers test with small, curated log snippets. In production, logs are massive and noisy. The silent truncation behavior of Ollama is particularly dangerous -- there is no error, no warning in the API response. The model simply loses its earlier context, including safety-critical system prompts.

**How to avoid:**
- Always set `num_ctx` explicitly in Ollama model configuration. For orchestration (Llama-3.3-70B), use at least 32K tokens. For execution sub-agents (Qwen2.5-Coder-7B), 8K-16K is sufficient since tasks should be atomic.
- Implement aggressive pre-filtering in every skill that touches logs: `grep`, `tail -n`, `journalctl --since`, time-range filters. The skill file must specify how to extract relevant data, not dump entire logs.
- Build a "context budget" tracker that monitors token usage per request and warns or errors before truncation occurs. Never rely on Ollama's silent truncation.
- Use a two-pass approach for log analysis: first pass extracts relevant lines with traditional tools (grep, awk), second pass sends only the filtered subset to the LLM.
- Pin the system prompt and safety instructions in a reserved portion of the context window that cannot be displaced.

**Warning signs:**
- Ollama debug logs show "truncating input prompt" or "context limit hit -- shifting."
- The agent suddenly "forgets" its role or safety instructions mid-session.
- Log analysis skills work in testing (small logs) but produce nonsensical output in production (large logs).
- The agent's diagnosis quality degrades as the session grows longer.

**Phase to address:**
Phase 1 (Core Engine) for the context budget tracker and explicit `num_ctx` configuration. Phase 2 (Skills Library) for implementing proper pre-filtering in every log-touching skill.

---

### Pitfall 4: Local LLM Quality Cliff on Complex Infrastructure

**What goes wrong:**
Local models (even 70B parameter) fail on multi-step reasoning chains that are common in infrastructure debugging. They can identify that Nginx returned a 502, but struggle to trace the root cause through a chain of dependencies (Nginx -> upstream app -> database connection pool exhausted -> disk full on database server). The model produces a superficially plausible but fundamentally wrong diagnosis, and the fix plan targets the wrong component.

**Why it happens:**
As of early 2026, local models match cloud frontier models on simple, well-defined tasks but fall significantly short on complex reasoning, multi-hop inference, and novel scenarios. The InfraBrain architecture (using Llama-3.3-70B for orchestration) is at the edge of what local models can reliably handle. The gap is especially pronounced for rare or unusual infrastructure configurations that were underrepresented in training data.

**How to avoid:**
- Design skills to decompose complex problems into simple, single-hop steps. Each sub-agent task should require only one logical inference, not a chain. The orchestrator skill should handle decomposition, not leave it to the execution model.
- Build "diagnostic ladders" into skills: step 1 checks the most likely cause, step 2 checks the next most likely, etc. Do not ask the LLM to reason about all possible causes simultaneously.
- Implement verification at every step, not just at the end. If step 1's diagnosis is wrong, catch it before step 2 builds on it.
- Design the system to support a pluggable LLM provider from day one. Enterprises with GPU clusters may run Llama-3.3-70B; others may eventually want cloud model fallback for complex cases (even if v1 is local-only).
- Include confidence scoring in skill outputs: require the LLM to rate its diagnosis confidence, and escalate to human when confidence is below threshold.

**Warning signs:**
- The v1 POC (Nginx 502) works reliably, but adding a second layer of complexity (e.g., upstream app also misconfigured) causes failure.
- The model produces different diagnoses for the same problem on repeated runs (non-determinism revealing reasoning fragility).
- Fix plans work for textbook scenarios but fail on production systems with messy, real-world configurations.

**Phase to address:**
Phase 2 (Skills Library) for diagnostic ladder design. Phase 3 (Orchestration) for step-by-step verification. This is a fundamental constraint of the local-first architecture that must be mitigated through system design, not model improvements.

---

### Pitfall 5: Standalone Binary Distribution with Native Modules

**What goes wrong:**
InfraBrain requires SQLite (via better-sqlite3, a native C++ addon) and must ship as a standalone binary. Both `pkg` and `nexe` are effectively dead (pkg deprecated January 2024, nexe unmaintained since 2017). Node.js SEA (Single Executable Applications) is the modern replacement, but SEA does not magically bundle native modules -- better-sqlite3 requires platform-specific compilation and cannot be embedded in a single portable binary.

**Why it happens:**
Developers assume "standalone binary" means one file that runs everywhere. In reality, native modules require platform-specific compiled `.node` files. SEA bundles JavaScript but native addons must be either shipped alongside the binary or loaded from a known path at runtime. Cross-platform distribution of native Node.js modules is one of the hardest unsolved problems in the Node.js ecosystem.

**How to avoid:**
- Use Node.js built-in `node:sqlite` module (stable as of Node.js 22+) instead of better-sqlite3. This eliminates the native module dependency entirely for SQLite, which is InfraBrain's primary native dependency.
- Use Node.js SEA (v25.5+ has `--build-sea` single-step builds) as the distribution mechanism. With native modules eliminated, SEA can produce a true single-file binary.
- Set up CI/CD that builds SEA binaries for each target platform (Linux x64, Linux arm64, macOS x64, macOS arm64, Windows x64). Test each artifact on the target platform.
- If native modules cannot be avoided: ship as a tarball containing the binary plus a `native/` directory with platform-specific `.node` files, and have the binary resolve them at runtime.
- Consider Bun as an alternative runtime -- it has built-in SQLite and a `bun build --compile` that produces standalone executables more maturely than Node.js SEA.

**Warning signs:**
- The project starts development with better-sqlite3 and delays binary packaging to "later."
- Cross-platform CI is not set up early, and "works on my Mac" becomes the standard.
- Testing only on one platform (e.g., macOS) while enterprise targets are Linux.

**Phase to address:**
Phase 1 (Core Engine). The SQLite choice (built-in vs. better-sqlite3) and binary packaging strategy must be decided before any code is written. Deferring this creates a rewrite.

---

### Pitfall 6: Sub-Agent Process Isolation is Not Security Isolation

**What goes wrong:**
InfraBrain's architecture uses sub-agents with "full process isolation" -- separate LLM context and sandboxed child processes. Developers assume that Node.js child_process isolation provides security boundaries. It does not. A child process spawned via `child_process.exec()` inherits the parent's permissions, environment variables, and filesystem access. If the LLM generates a malicious or hallucinated command, `exec()` passes it through a shell, enabling command injection (`; rm -rf /`). Node.js `vm` module is explicitly not a security mechanism.

**Why it happens:**
There is a fundamental confusion between "process isolation" (separate memory space, separate LLM context) and "security isolation" (restricted permissions, sandboxed filesystem). InfraBrain needs both, but Node.js child_process only provides the former. The 2025 CVEs against vm2 and Node.js sandbox libraries demonstrate that JavaScript-level sandboxing is consistently bypassable.

**How to avoid:**
- Use `child_process.execFile()` or `child_process.spawn()` with the `shell: false` option. Never use `exec()` or `execSync()` which invoke a shell and enable injection.
- Pass command arguments as arrays, never as concatenated strings. `spawn('docker', ['restart', containerName])` is safe; `exec('docker restart ' + containerName)` is injectable.
- Run sub-agent processes with reduced privileges: use a dedicated low-privilege user, drop capabilities, restrict filesystem access to only the target system's relevant paths.
- For true security isolation, consider running execution sub-agents inside lightweight containers (e.g., using `nerdctl` or Docker) or using Linux namespaces/seccomp profiles. This is a Phase 3+ enhancement.
- Implement a command parser that validates the generated command matches an expected pattern before execution, as a defense-in-depth layer.

**Warning signs:**
- Execution code uses `child_process.exec()` anywhere.
- Commands are built by string concatenation with LLM output.
- Sub-agent processes run as root or with the same user as the main InfraBrain process.
- No input validation between LLM output and command execution.

**Phase to address:**
Phase 1 (Core Engine) for `execFile`/`spawn` with `shell: false` and argument arrays. Phase 3 (Orchestration) for container-level isolation of execution sub-agents.

---

### Pitfall 7: Inter-Agent Trust Exploitation in Multi-Agent Architecture

**What goes wrong:**
Research from 2025 reveals that LLMs apply different security policies based on the source of instructions rather than their content. In InfraBrain's multi-agent architecture, if the orchestrator agent sends a message to a sub-agent, the sub-agent treats it as trusted -- even if the orchestrator was manipulated by malicious content in a log file or skill file. An attacker could craft a log entry or error message containing prompt injection that, when read by the diagnostic agent, causes it to instruct the execution agent to run malicious commands. This "privilege escalation via peer agent" bypasses HITL because the malicious instruction flows through the legitimate agent communication channel.

**Why it happens:**
Multi-agent architectures implicitly assume that messages between agents are trustworthy. But agents process untrusted external data (log files, config files, error messages, network responses) that can contain prompt injection payloads. When Agent A reads a poisoned log and passes a summary to Agent B, the poison propagates.

**How to avoid:**
- Treat all data from infrastructure as untrusted input. Apply strict input sanitization before feeding logs, configs, or error messages to any LLM agent.
- Implement a "data boundary" between infrastructure data and agent instructions. The skill file provides the instructions; infrastructure data should be clearly delineated in the prompt as "untrusted user data."
- Do not allow agents to instruct other agents to execute commands directly. All execution commands must flow through the central HITL gate, regardless of which agent generated them.
- Add anomaly detection: if a diagnostic agent suddenly produces a fix plan that includes unusual commands (data exfiltration, network calls, permission changes) that are unrelated to the diagnosed problem, flag it.

**Warning signs:**
- Sub-agents execute commands that were not part of the original fix plan.
- The diagnostic output contains instruction-like language that "leaked" from log content.
- Fix plans include steps that have no logical relationship to the diagnosed problem.

**Phase to address:**
Phase 3 (Orchestration) for data boundaries and agent communication sanitization. Phase 4 (POC) must include a prompt injection test case to verify defenses.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Using `child_process.exec()` instead of `execFile()` | Easier to construct commands as strings | Command injection vulnerability surface | Never |
| Hardcoding Ollama as the only LLM provider | Faster v1 development | Rewrite needed for vLLM/llama.cpp support; locks out enterprises with different infrastructure | Only if the abstraction interface is designed but only Ollama is implemented |
| Skipping context budget tracking | Simpler LLM integration | Silent context truncation causing random failures in production | Never -- even a basic token counter is essential |
| Storing all state in SQLite only (skipping human-readable files) | Single storage layer to maintain | Loses git-trackability and human auditability, which are key selling points | Never -- the dual storage is a core differentiator |
| Testing only with small, curated log samples | Tests pass quickly, demo looks good | Complete failure on real production logs (100MB+ files) | Only in Phase 1; Phase 2 must include realistic data volumes |
| Deferring binary packaging to "later" | Focus on features first | Discovering that your native module choices prevent standalone distribution | Never -- validate the binary build pipeline in week 1 |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Ollama API | Using default 2048 token context, not detecting silent truncation | Explicitly set `num_ctx` per model, implement token counting, monitor for truncation indicators |
| Docker Engine API | Assuming Docker socket is always at `/var/run/docker.sock` | Check for Docker socket in multiple locations, support remote Docker hosts, handle Docker Desktop vs Linux Docker differences |
| System commands (nmap, grep, journalctl) | Assuming tools are installed and at expected paths | Check for tool availability at startup, provide clear error messages for missing dependencies, document required system tools |
| SQLite concurrent access | Opening multiple connections from sub-agents simultaneously | Use WAL mode, implement connection pooling, or route all DB writes through the main process |
| Ollama model availability | Assuming the configured model is already pulled/available | Check model availability on startup, provide helpful error messages ("Run `ollama pull llama3.3:70b` first"), consider auto-pull option |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Sending full log files to LLM | Slow responses, context truncation, nonsensical output | Pre-filter with traditional tools (grep, awk) before LLM analysis | Any log file over ~50KB |
| Synchronous LLM calls blocking the CLI | CLI freezes during diagnosis, user thinks it crashed | Use async patterns with progress indicators, stream responses | Any LLM call over 5 seconds (most of them) |
| Loading all skills into orchestrator context | Slow startup, wasted context window, reduced reasoning quality | Lazy-load skills: orchestrator reads skill index, loads only relevant skills per task | More than 10-15 skill files |
| SQLite lock contention from concurrent sub-agents | "Database is locked" errors, failed state writes | Serialize write operations through a single process, use WAL mode | More than 2-3 concurrent sub-agents |
| Ollama cold start latency | First query takes 30-60 seconds while model loads into GPU memory | Keep model loaded with `keep_alive` parameter, or implement a warm-up query on InfraBrain startup | Every fresh start without warm-up |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Running sub-agent processes as root | A hallucinated `rm -rf /` executes with full privileges, destroying the host | Create a dedicated low-privilege user for execution; only escalate specific commands via sudo with allowlist |
| Storing audit logs in a location writable by the execution agent | A compromised or hallucinating agent could delete its own audit trail | Store audit logs in a separate directory with different ownership; make them append-only |
| Not sanitizing LLM output before shell execution | Command injection through crafted LLM responses | Always use `execFile` with argument arrays; add regex validation on command output before execution |
| Trusting skill file content without validation | Malicious skill files could contain prompt injection that overrides safety instructions | Validate skill files against a schema; separate instruction sections from data sections; warn on unsigned skills |
| Exposing the REST/gRPC API without authentication | Any process on the machine can issue commands via the API | Even for local-only: require API key/token authentication; bind to localhost only; support Unix socket communication |
| Logging sensitive infrastructure data (passwords, tokens) in audit trail | Credential exposure in audit logs | Implement a secrets redaction layer that strips known patterns (passwords, API keys, tokens) from logs before storage |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Wall-of-text LLM output in CLI | Admin cannot quickly assess what the system is proposing; loses trust | Structured output: summary line, then expandable details. Use color coding for severity. |
| No progress indication during LLM reasoning | Admin thinks the tool is hung; kills the process | Stream partial output or show a spinner with elapsed time and current phase ("Analyzing logs... 12s") |
| Requiring approval for every single read command | Admin fatigue leads to rubber-stamping approvals (defeating HITL purpose) | Risk-tiered approvals: read-only commands auto-execute, write commands require approval, destructive commands require explicit confirmation |
| Showing raw LLM reasoning/chain-of-thought to non-technical users | Confusing, reduces confidence in the tool | Show clean summaries by default; offer `--verbose` flag for full reasoning chain |
| Unclear rollback state after safety halt | Admin does not know what was changed and what was rolled back | After any halt: display a clear diff of "what changed" and "what was rolled back" with file paths and command history |
| No way to teach the system from corrections | Admin modifies a command but the system never learns from the correction | Log all modifications; surface patterns ("You modified Docker restart commands 5 times -- consider updating the skill file") |

## "Looks Done But Isn't" Checklist

- [ ] **HITL gate:** Often missing edge cases where commands bypass approval -- verify ALL execution paths require approval for write operations, including retries and rollback commands
- [ ] **Circuit breaker:** Often missing reset logic -- verify the circuit breaker can be manually reset by the admin after investigation, not just auto-reset after a timeout
- [ ] **Context window management:** Often missing token counting -- verify you are counting tokens before sending to Ollama, not relying on Ollama's silent truncation
- [ ] **Audit trail:** Often missing the "before" state -- verify every fix records the system state before the change, not just the commands executed and the after state
- [ ] **Rollback:** Often missing partial rollback -- verify the system can roll back when a multi-step plan fails on step 3 of 5 (rolling back steps 1-2, not just step 3)
- [ ] **Binary distribution:** Often missing cross-platform testing -- verify the binary runs on a clean Linux machine with no Node.js installed, not just on the dev machine
- [ ] **Skill loading:** Often missing error handling for malformed skills -- verify the system gracefully handles a skill file with missing sections, invalid YAML frontmatter, or encoding issues
- [ ] **Lock-based concurrency:** Often missing stale lock cleanup -- verify locks are released if the process crashes, not just on clean exit
- [ ] **Ollama integration:** Often missing model version pinning -- verify the system records which model version produced each diagnosis, for auditability

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Hallucinated command executed | HIGH | Review audit log for exact command; assess damage from command output; restore from pre-fix snapshot; add command pattern to denylist |
| Cascading failure from retry loop | HIGH | Trip circuit breaker manually if not auto-tripped; restore to session start snapshot; review the full execution log to understand the cascade chain; add the failure pattern to circuit breaker rules |
| Context truncation causing wrong diagnosis | MEDIUM | Restart diagnosis with explicit context management; review Ollama logs for truncation indicators; increase `num_ctx` or improve pre-filtering in the relevant skill |
| Binary won't run on target platform | MEDIUM | Identify the failing native module; rebuild for target platform; set up CI matrix for all target platforms; consider eliminating the native dependency |
| Prompt injection via log content | HIGH | Halt all execution; audit recent commands for unauthorized actions; review log sources for injected content; implement data sanitization layer; re-run diagnosis with sanitized inputs |
| SQLite database corruption from concurrent access | MEDIUM | Restore from last backup; enable WAL mode; route all writes through single process; add integrity checks on startup |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Hallucinated commands | Phase 1 (Core Engine) | Unit test: feed known-bad commands through validator, verify they are blocked |
| Runaway automation / cascading failures | Phase 1 (Core Engine) + Phase 3 (Orchestration) | Integration test: simulate 3 consecutive fix failures, verify circuit breaker trips and rollback executes |
| Context window overflow | Phase 1 (Core Engine) + Phase 2 (Skills Library) | Test with 100MB+ log files; verify pre-filtering produces output under token budget; verify no silent truncation |
| Local LLM quality cliff | Phase 2 (Skills Library) + Phase 3 (Orchestration) | Test diagnostic accuracy on 10+ real-world scenarios with multi-hop root causes; measure success rate |
| Binary distribution with native modules | Phase 1 (Core Engine) | CI builds SEA binary for Linux x64; test on clean VM with no Node.js; verify SQLite operations work |
| Process isolation != security isolation | Phase 1 (Core Engine) | Security audit: verify no `exec()` calls exist; verify all commands use argument arrays; verify sub-agent user privileges |
| Inter-agent trust exploitation | Phase 3 (Orchestration) + Phase 4 (POC) | Prompt injection test: insert instruction-like content in a log file; verify it does not propagate to execution |
| Enterprise compliance gaps | Phase 4 (POC) | Verify audit log completeness: every command, every decision, every state change is logged with timestamps and model version |

## Sources

- [Thoughtworks: AIOps lessons learned 2025](https://www.thoughtworks.com/insights/blog/generative-ai/aiops-what-we-learned-in-2025)
- [Botpress: AIOps automation pitfalls](https://botpress.com/blog/aiops)
- [OWASP ASI08: Cascading Failures in Agentic AI (2026)](https://adversa.ai/blog/cascading-failures-in-agentic-ai-complete-owasp-asi08-security-guide-2026/)
- [Circuit breaker pattern for AI agents](https://dev.to/tumf/ralph-claude-code-the-technology-to-stop-ai-agents-how-the-circuit-breaker-pattern-prevents-3di4)
- [Trustworthy AI Agents: Kill Switches and Circuit Breakers](https://www.sakurasky.com/blog/missing-primitives-for-trustworthy-ai-part-6/)
- [Ollama context length documentation](https://docs.ollama.com/context-length)
- [Ollama large context size usability issues (GitHub #9890)](https://github.com/ollama/ollama/issues/9890)
- [LLM hallucination in autonomous agents survey](https://arxiv.org/html/2509.18970v1)
- [Inter-agent trust exploitation attack](https://arxiv.org/html/2507.06850v5)
- [Node.js SEA single executable applications](https://nodejs.org/api/single-executable-applications.html)
- [Node.js v25.5 --build-sea feature](https://progosling.com/en/dev-digest/2026-01/nodejs-25-5-build-sea-single-executable)
- [Joyee Cheung: Improving SEA building for Node.js (Jan 2026)](https://joyeecheung.github.io/blog/2026/01/26/improving-single-executable-application-building-for-node-js/)
- [pkg deprecated (GitHub)](https://github.com/vercel/pkg)
- [Node.js Sandbox MCP Server command injection CVE-2025-53372](https://github.com/advisories/GHSA-5w57-2ccq-8w95)
- [vm2 sandbox escape vulnerability (2026)](https://thehackernews.com/2026/01/critical-vm2-nodejs-flaw-allows-sandbox.html)
- [Node.js child_process command injection prevention](https://securecodingpractices.com/prevent-command-injection-node-js-child-process/)
- [Local LLMs vs Cloud LLMs comparison (2026)](https://freeacademy.ai/blog/local-llms-vs-cloud-llms-ollama-privacy-comparison-2026)
- [Enterprise AI compliance and LLM security (2025)](https://futureagi.com/blogs/ai-compliance-guardrails-enterprise-llms-2025)
- [LLM compliance risks and challenges](https://www.lasso.security/blog/llm-compliance)
- [EU AI Act compliance requirements](https://www.promptfoo.dev/blog/ai-regulation-2025/)
- [CSO Online: Agentic AI as CISO nightmare (2025)](https://www.csoonline.com/article/4132860/why-2025s-agentic-ai-boom-is-a-cisos-worst-nightmare.html)

---
*Pitfalls research for: AI IT Operations Platform (InfraBrain)*
*Researched: 2026-03-07*
