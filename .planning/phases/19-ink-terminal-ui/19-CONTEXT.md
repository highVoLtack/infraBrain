# Phase 19: Ink/React Terminal UI - Context

**Gathered:** 2026-04-15
**Status:** Ready for planning

<domain>
## Phase Boundary

Admin interacts with InfraBrain through a rich, reactive terminal interface built with Ink (React for CLI). Three-panel Obsidian-style layout with live DPEV tracking, token-by-token streaming, interactive approval components, entity knowledge graph, and session history. All existing CLI commands (`/infra:debug`, `/infra:status`, `/infra:history`, `/infra:resume`) work through the Ink renderer with identical behavior. Express REST API serves SSE endpoints for live streaming.

**Key constraint:** Data comes from LanceDB (not Qdrant) for both cache and memory. UI must show provider and resourceType on all entity/incident displays for universal Company OS support.

Requirements: TERM-01, TERM-02, TERM-03, TERM-04, TERM-05, TERM-06, TERM-07, TERM-08

</domain>

<decisions>
## Implementation Decisions

### Data Source
- LanceDB is the sole data source for cache entries (fix_cache table) and semantic memory (mem_incidents, mem_entities tables) -- NOT Qdrant
- All entity and incident displays must include `provider` (e.g. Docker, Postgres, Nginx) and `resourceType` for universal company-wide usability

### Layout: Obsidian-Style 3-Panel
- Left panel (20%): Session tree grouped by date (Today, Yesterday, This Week, Older)
- Center panel (55%): DPEV stream -- the main viewport for active diagnosis and session replay
- Right panel (25%): Entity knowledge graph with hybrid graph + detail pane
- Persistent 2-3 line header bar at top showing critical system metrics
- Panel proportions are defaults at >= 120 cols; responsive breakpoints adapt layout

### DPEV Streaming (Center Panel)
- **Token-by-token streaming** via SSE from Express backend (TERM-02, TERM-07) -- essential for perceived latency during complex diagnoses
- Dynamic header per DPEV phase showing: active model name (e.g. "Qwen3-32B"), elapsed time counter, phase status icon
- **Collapsing accordion** for phase transitions: completed phases collapse to 1-line summary (e.g. "DISCOVERY [checkmark] 1.2s -- 3 containers found"), active phase fully expanded with streaming
- Parallel inference from Phase 18 visible: header shows which model is active (reasoning vs worker)

### Cache Hit Display
- **Inline fast-path banner** (`<CacheHitBanner />` component) replaces the Diagnosis accordion section
- Shows: confidence score, source incident ID + date, root cause summary, provider + resourceType
- Displays all Phase 16 provenance data (similarity, incident ID, provider, resourceType)
- Banner interrupts DPEV flow and waits for user approval (Y = use cached fix, N = re-diagnose) before collapsing

### Execution Step Cards (TERM-06)
- **Inline step cards** showing all steps simultaneously: command text, risk level (color-coded), target container, provider, approval status
- Admin sees full execution sequence for informed approval decisions
- Output area compact by default, auto-expands on error to show stdout/stderr
- Each step shows: step N/total, status icon, command, risk badge, provider + target

### Approval Components (TERM-03)
- **Dedicated React components** using Ink's `useInput` hook -- NOT readline
- Ink takes over stdin; approval components are integrated into the DPEV flow without blocking it
- Three tiers preserved: READ (auto-approve), WRITE (Y/N component), DESTRUCTIVE (typed-target confirm component)
- Approval component renders inline within the Execute step card

### Entity Graph (Right Panel)
- **Hybrid layout**: top half shows compact tree graph grouped by provider, bottom half shows detail pane for selected entity
- **Live updates** during active DPEV session: entities appear in real-time as Discovery and Diagnosis extract them
- Newly discovered entities highlighted with visual markers (color change, "NEW" indicator)
- **Color intensity by recency**: current session entities bright/bold, past entities dimmer proportional to age
- Accessibility: filled circle (filled) for live entities, empty circle for memory entities -- not color-only
- Detail pane shows: type, provider, resourceType, valid_from/valid_to timestamps, session count, related incidents
- Data sourced from LanceDB mem_entities table

### Entity Graph Navigation
- **Arrow keys + Enter** as primary: Up/Down to select entity, Enter to expand detail, Esc to collapse
- **Vim aliases**: j/k mapped as alternative to Up/Down for power users
- **Tab** cycles focus between left/center/right panels
- Search within graph via `/` key

### Left Panel: Session History
- **Date-grouped tree**: Active session at top (highlighted), then Today, Yesterday, This Week, Older
- Each session shows: outcome icon (checkmark/X/hourglass), target service name, expert_domain icon, timestamp
- Collapsible date groups (accordion pattern matching center panel)
- **Fuzzy search bar** at top, triggered by `/` key (Obsidian quick-switcher style)
- Search uses hybrid: fuzzy title match + LanceDB vector semantic search for related incidents
- Real-time filtering as user types

### Session Navigation
- Selecting a past session loads **read-only session replay** in center panel (collapsed DPEV accordion)
- Right panel syncs to show historical entity state from that session
- Prominent "Return to live" button + Esc keystroke to return to active session
- Replay feels like opening a read-only archive file in Obsidian

### Status Dashboard (TERM-04)
- **Persistent header bar** (2-3 lines, always visible): InfraBrain version, inference mode (parallel/sequential with color), active model name, backend health dots (green/yellow/red), active session count, cache entry count
- Header color adapts: green for local vLLM, blue for parallel mode, different hue for cloud (Gemini) backends
- **Full overlay dashboard** on `s` keystroke: backends with latency, model assignments (reasoning/worker), cache hit rate + avg confidence, memory incident/entity counts + WAL size, context window token usage visualization
- Overlay is modal (Esc to dismiss), DPEV stream visually paused in background (logically continues)

### Responsive Layout (TERM-05)
- **>= 120 cols**: Full 3-panel layout (20/55/25 split)
- **80-119 cols**: 2-panel layout (25/75), entity graph hidden but available via `g` toggle key as overlay
- **< 80 cols**: Single panel (center only), other panels accessible via Tab cycling
- Uses Ink's `useStdout` hook to detect terminal width and react to resize events
- DPEV stream readability is top priority at all widths

### Keyboard Shortcut Map
- `Tab`: Cycle panel focus (left -> center -> right -> left)
- `Arrow keys` / `j`/`k`: Navigate within focused panel
- `Enter`: Expand/select in focused panel
- `Esc`: Collapse detail / dismiss overlay / return to live session
- `/`: Search (context-dependent: session search in left panel, entity search in right panel)
- `s`: Toggle status dashboard overlay
- `g`: Toggle entity graph (in 2-panel mode where graph is hidden)
- `Y`/`N`: Approval responses (when approval component is active)

### Claude's Discretion
- SSE endpoint design and event format for streaming
- Exact Ink component hierarchy and state management approach
- Box-drawing character set and exact visual styling
- Spinner and loading animation implementations
- How `--json` mode interacts with Ink (likely bypass Ink entirely, output raw JSON)
- Error/disconnect state UI handling
- Exact color palette for risk levels, provider badges, status indicators

</decisions>

<specifics>
## Specific Ideas

- "Obsidian-style layout" -- the three-panel split mirrors Obsidian's sidebar + editor + graph view
- "Quick Switcher" feeling for the session search -- type `/` and instant fuzzy filter
- "Return to live" must be prominent and instant -- Esc or a visible button
- Entity graph should feel like a "living nervous system" updating in real-time during DPEV
- Cache hit banner should feel like an Obsidian "callout" block -- visually distinct, interruptive
- Accordion collapse on completed phases keeps terminal clean even for complex multi-step fixes
- Header bar as the "dashboard of the Company OS" -- always showing the Intelligence Layer's vital signs
- Status overlay as a "technical cockpit" -- hard facts about the pipeline (latency, hit rates, token usage)
- Color intensity for temporal depth: bright = now, dim = past -- natural visual hierarchy
- Expert domain icons next to sessions (e.g. whale for Docker) for instant domain recognition
- Works on 49-inch monitor AND tiny SSH session equally well

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/cli/formatter.ts`: Chalk-based formatters (formatStatusDashboard, formatDPEVSummary, formatHistoryTable) -- patterns to replicate in Ink components
- `src/cli/approval.ts`: Three-tier approval logic (requestApproval with READ/WRITE/DESTRUCTIVE) -- port to Ink useInput components
- `src/cli/repl.ts`: Current readline-based REPL -- will be replaced by Ink app entry point
- `src/cli/commands.ts`: Commander-based command registration -- keep commander for arg parsing, render via Ink
- `src/cache/lance-store.ts`: CacheStore singleton for LanceDB fix_cache table -- query for cache display
- `src/memory/incident-store.ts`: IncidentStore for mem_incidents table -- query for session history
- `src/memory/entity-store.ts`: EntityStore for mem_entities table -- query for entity graph
- `src/cache/embedder.ts`: BGE-M3 embeddings via generateEmbedding() -- reuse for semantic session search
- `src/api/routes/health.ts`: /health endpoint returning backend status, inference mode, model list -- feed into header bar
- `src/api/routes/status.ts`: /status endpoint returning active plans, recent sessions, locks -- feed into dashboard

### Established Patterns
- Singleton factory pattern (CacheStore, IncidentStore) -- maintain for any new stores
- LLM provider has `streamDiagnosis()` async iterable -- exists but unused, wire into SSE endpoint
- Express routes return structured JSON -- add SSE endpoints alongside existing REST
- Commander for CLI parsing -- keep as entry point, hand off rendering to Ink
- Chalk color coding: green (READ), yellow (WRITE), red (DESTRUCTIVE) -- carry into Ink theme

### Integration Points
- `src/index.ts`: Main entry point -- needs Ink app initialization instead of readline REPL
- `src/orchestrator/pipeline.ts`: runDPEV() -- needs to emit events for SSE streaming instead of returning complete result
- `src/api/routes/execute.ts`: Execute route -- needs to emit step-by-step progress events
- `src/api/routes/health.ts`: Health route -- already returns inferenceMode, backends, models
- `streamDiagnosis()` in LLM provider -- wire into SSE endpoint for token-by-token streaming

</code_context>

<deferred>
## Deferred Ideas

- Web UI layer on top of REST API (TERM-A01 in v2 requirements) -- separate from terminal UI
- Mobile-responsive web interface -- out of scope, CLI-first
- Customizable panel sizes via drag handles -- terminal limitation, use fixed breakpoints
- Plugin system for custom dashboard widgets -- future enhancement

</deferred>

---

*Phase: 19-ink-terminal-ui*
*Context gathered: 2026-04-15*
