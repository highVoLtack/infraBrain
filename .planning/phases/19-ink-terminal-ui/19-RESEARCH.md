# Phase 19: Ink/React Terminal UI - Research

**Researched:** 2026-04-15
**Domain:** Terminal UI (Ink/React), Server-Sent Events, Responsive CLI Layout
**Confidence:** HIGH

## Summary

Phase 19 replaces InfraBrain's readline-based REPL with a rich, reactive terminal UI built on Ink v7 (React for CLI). The architecture is a three-panel Obsidian-style layout with live DPEV streaming via SSE from the existing Express backend. The project already has a `streamDiagnosis()` async iterable on the LLM provider that yields token-by-token, and all data stores (LanceDB for cache, incidents, entities) are already built. The UI work is primarily a rendering layer over existing backend APIs.

Ink v7.0.0 (released April 8, 2026) requires Node.js 22+ and React 19.2+. The project runs Node.js v25.2.1 (compatible) and uses ESM (`"type": "module"` in package.json). The existing stack uses TypeScript 5.9, Express 5, Vitest 4, and Chalk 5. Ink uses Yoga (Facebook's flexbox engine) for layout -- all CSS-like flex properties work. Key Ink v7 additions (`useWindowSize`, `useAnimation`, `useFocus`, `alternateScreen`) directly map to phase requirements.

**Primary recommendation:** Add Ink v7 + React 19.2 + `@inkjs/ui` v2. Build SSE endpoints on existing Express routes. Use `alternateScreen` mode for the full-screen dashboard. Consume SSE from Ink via native `fetch()` streaming (no EventSource needed for POST-based endpoints). Keep Commander for arg parsing, hand off rendering to Ink.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- LanceDB is the sole data source for cache entries (fix_cache table) and semantic memory (mem_incidents, mem_entities tables) -- NOT Qdrant
- All entity and incident displays must include `provider` and `resourceType` for universal company-wide usability
- Layout: Obsidian-Style 3-Panel (left 20%, center 55%, right 25%)
- Left panel: Session tree grouped by date (Today, Yesterday, This Week, Older)
- Center panel: DPEV stream with token-by-token streaming via SSE, collapsing accordion for phase transitions
- Right panel: Entity knowledge graph with hybrid graph + detail pane
- Persistent 2-3 line header bar at top with critical system metrics
- Token-by-token streaming via SSE from Express backend (TERM-02, TERM-07)
- Cache hit display: inline fast-path banner replacing Diagnosis accordion section
- Execution step cards showing all steps simultaneously with risk-level color coding
- Approval components using Ink's `useInput` hook, NOT readline
- Three approval tiers: READ (auto-approve), WRITE (Y/N component), DESTRUCTIVE (typed-target confirm)
- Entity graph: hybrid layout (tree top, detail pane bottom), live updates during DPEV, color intensity by recency
- Entity graph navigation: Arrow keys + Enter, Vim aliases (j/k), Tab cycles panels, `/` search
- Session navigation: selecting past session loads read-only replay, "Return to live" button + Esc
- Status dashboard: persistent header bar + full overlay on `s` keystroke
- Responsive layout: >= 120 cols (3-panel), 80-119 cols (2-panel), < 80 cols (single panel)
- Keyboard shortcut map: Tab, Arrow/j/k, Enter, Esc, `/`, `s`, `g`, `Y`/`N`

### Claude's Discretion
- SSE endpoint design and event format for streaming
- Exact Ink component hierarchy and state management approach
- Box-drawing character set and exact visual styling
- Spinner and loading animation implementations
- How `--json` mode interacts with Ink (likely bypass Ink entirely, output raw JSON)
- Error/disconnect state UI handling
- Exact color palette for risk levels, provider badges, status indicators

### Deferred Ideas (OUT OF SCOPE)
- Web UI layer on top of REST API (TERM-A01 in v2 requirements)
- Mobile-responsive web interface
- Customizable panel sizes via drag handles
- Plugin system for custom dashboard widgets
- Caveman semantic compression (v2.0 Perc -- Phase 19 only pre-builds UI hook placeholder)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| TERM-01 | Admin sees live DPEV phase tracking (which phase, model, elapsed time) | SSE event stream with `dpev:phase` events; Ink `useAnimation` hook for elapsed time counter; `useWindowSize` for responsive header |
| TERM-02 | Admin sees streaming LLM output in real-time (not buffered) | SSE endpoint wrapping existing `streamDiagnosis()` async iterable; Ink state updates on each token chunk |
| TERM-03 | Approval prompts as Ink React components with `useInput` | Ink `useInput` hook replaces readline; `useFocus` for approval component focus; three-tier approval components |
| TERM-04 | Rich status dashboard with panels | Ink `Box` flexbox layout with `useWindowSize` for responsive panels; `alternateScreen` for full overlay |
| TERM-05 | Terminal output adapts to terminal width | Ink `useWindowSize` hook; responsive breakpoints at 120/80 cols; `flexGrow` + percentage widths |
| TERM-06 | Step-by-step execution progress with per-step status icons | SSE `exec:step` events from execute route; Ink step card components with color-coded risk badges |
| TERM-07 | Express REST API serves SSE endpoints for live streaming | New SSE routes on existing Express server; event format design; connection management |
| TERM-08 | All existing CLI commands work through Ink renderer | Commander kept for arg parsing; Ink `render()` replaces console.log output; `--json` bypasses Ink |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| ink | 7.0.0 | React renderer for terminal UI | Only viable React-based terminal renderer; Yoga flexbox layout; used by GitHub Copilot CLI, Prisma, Shopify |
| react | 19.2.x | Component model and hooks | Required by Ink v7; latest stable React |
| @inkjs/ui | 2.0.0 | Pre-built Ink components (Spinner, Select, TextInput, ConfirmInput, Badge, ProgressBar, Alert) | Official companion library; saves building common components from scratch |
| ink-testing-library | 4.0.0 | Testing utilities for Ink components | Official test utilities; `render()`, `lastFrame()`, `stdin.write()` for simulating input |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @types/react | 19.x | TypeScript types for React | Required for TypeScript + React JSX |
| fullscreen-ink | latest | Full-screen terminal rendering wrapper | Use for the fullscreen Ink app container with resize handling |

### NOT Needed (Existing or Built-In)
| Category | Why Not Needed |
|----------|----------------|
| EventSource client | Use native `fetch()` with `ReadableStream` for SSE consumption -- simpler than EventSource for POST requests and avoids extra dependency |
| State management lib | React `useState`/`useReducer` sufficient for TUI complexity per Ink community consensus |
| chalk (display) | Ink `<Text>` has built-in color/bold/dim props; chalk stays for `--json` mode and non-Ink output paths |
| express-sse | Manual SSE implementation is ~20 lines; library adds no value for this use case |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| ink | blessed/blessed-contrib | blessed is abandoned; no React model; no TypeScript types |
| ink | bubbletea (Go) | Would require Go sidecar; breaks "single TypeScript runtime" constraint |
| @inkjs/ui | Custom components | @inkjs/ui provides Spinner, ConfirmInput, Select that directly match phase requirements |
| fullscreen-ink | Manual alternateScreen | Ink v7 has built-in `alternateScreen` option; fullscreen-ink may not be needed if Ink v7 handles it natively |

**Installation:**
```bash
npm install ink@7 react@19 @inkjs/ui@2 ink-testing-library@4 @types/react@19
```

**TSConfig addition for JSX:**
```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "react"
  }
}
```

## Architecture Patterns

### Recommended Project Structure
```
src/
├── cli/                     # Existing -- keep Commander, approval logic, json-envelope
│   ├── commands.ts          # Keep: arg parsing, --json mode
│   ├── approval.ts          # Keep: extractTarget() reused; requestApproval() replaced by Ink
│   ├── formatter.ts         # Keep: formatters used in --json mode fallback
│   └── repl.ts              # REPLACE: readline REPL replaced by Ink app
├── ui/                      # NEW: Ink components
│   ├── App.tsx              # Root Ink app: 3-panel layout, keyboard routing, SSE connection
│   ├── hooks/
│   │   ├── useSSE.ts        # Custom hook: fetch() SSE consumer, parses event stream
│   │   ├── useDPEV.ts       # DPEV state machine: tracks phases, model, elapsed time
│   │   ├── usePanel.ts      # Panel focus management with Tab cycling
│   │   └── useResponsive.ts # Responsive breakpoint hook wrapping useWindowSize
│   ├── layout/
│   │   ├── HeaderBar.tsx    # Persistent 2-3 line header (TERM-04)
│   │   ├── PanelLayout.tsx  # 3-panel/2-panel/1-panel responsive container
│   │   └── StatusOverlay.tsx# Full overlay dashboard (TERM-04, `s` key)
│   ├── panels/
│   │   ├── SessionPanel.tsx # Left panel: session tree, fuzzy search
│   │   ├── DPEVPanel.tsx    # Center panel: streaming DPEV with accordion
│   │   └── EntityPanel.tsx  # Right panel: entity graph + detail pane
│   ├── components/
│   │   ├── DPEVPhaseHeader.tsx  # Per-phase header: model, elapsed, status icon
│   │   ├── StreamingText.tsx    # Token-by-token text renderer
│   │   ├── CacheHitBanner.tsx   # Cache hit callout with approval gate
│   │   ├── StepCard.tsx         # Execution step card (TERM-06)
│   │   ├── ApprovalWrite.tsx    # Y/N approval component (TERM-03)
│   │   ├── ApprovalDestructive.tsx # Typed-target confirmation (TERM-03)
│   │   ├── EntityTree.tsx       # Compact tree grouped by provider
│   │   ├── EntityDetail.tsx     # Detail pane for selected entity
│   │   └── SessionItem.tsx      # Session list item with outcome icon
│   └── theme.ts             # Color palette, risk level colors, provider badges
├── api/
│   └── routes/
│       ├── stream-debug.ts  # NEW: SSE endpoint for DPEV streaming
│       └── stream-execute.ts# NEW: SSE endpoint for execution progress
└── index.ts                 # Modified: render Ink app instead of startRepl()
```

### Pattern 1: SSE Event Protocol
**What:** Structured event format for DPEV streaming over SSE
**When to use:** All real-time communication from Express backend to Ink client

```typescript
// SSE Event Types -- each maps to a DPEV phase or UI update
interface SSEEvent {
  // DPEV phase lifecycle
  'dpev:phase': { phase: 'discovery' | 'diagnosis' | 'plan' | 'execution' | 'verification'; model: string; status: 'active' | 'complete' };
  // Token-by-token streaming
  'dpev:token': { text: string; phase: string };
  // Structured diagnosis complete
  'dpev:diagnosis': { rootCause: string; correlation: string; structuredDiagnosis: object };
  // Cache hit detected
  'dpev:cache-hit': { similarity: number; confidence: number; sourceSessionId: string; sourceDate: string; skillName: string };
  // Fix plan generated
  'dpev:plan': { fixPlan: object; planTable: string };
  // Execution step progress
  'exec:step': { stepIndex: number; total: number; command: string; risk: string; status: 'pending' | 'running' | 'success' | 'failed' | 'skipped'; stdout?: string; stderr?: string };
  // Approval required
  'exec:approval': { command: string; riskLevel: string; target: string; stepIndex: number };
  // Session complete
  'dpev:complete': { sessionId: string; status: string };
  // Error
  'dpev:error': { message: string; phase?: string };
}

// Express SSE endpoint pattern
function sendSSE(res: Response, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}
```

### Pattern 2: SSE Consumption via Native Fetch
**What:** Custom React hook consuming SSE without EventSource dependency
**When to use:** Ink components that need live data from Express SSE endpoints

```typescript
// useSSE.ts -- fetch-based SSE consumer
// Native EventSource only supports GET; our streaming endpoints need POST
// Node.js fetch() with ReadableStream is the cleanest approach
async function* parseSSEStream(response: Response): AsyncGenerator<{ event: string; data: string }> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    let currentEvent = '';
    let currentData = '';
    for (const line of lines) {
      if (line.startsWith('event: ')) {
        currentEvent = line.slice(7);
      } else if (line.startsWith('data: ')) {
        currentData = line.slice(6);
      } else if (line === '' && currentEvent && currentData) {
        yield { event: currentEvent, data: currentData };
        currentEvent = '';
        currentData = '';
      }
    }
  }
}
```

### Pattern 3: Responsive Panel Layout
**What:** Three-tier responsive layout based on terminal width
**When to use:** Root layout component

```typescript
// useResponsive.ts
import { useWindowSize } from 'ink';

type LayoutMode = 'full' | 'compact' | 'minimal';

function useResponsive(): { mode: LayoutMode; columns: number; rows: number } {
  const { columns, rows } = useWindowSize();
  const mode: LayoutMode =
    columns >= 120 ? 'full' :
    columns >= 80 ? 'compact' :
    'minimal';
  return { mode, columns, rows };
}

// PanelLayout.tsx
// full:    [left 20%] [center 55%] [right 25%]
// compact: [center 75%] [right 25% -- hidden, toggle with 'g']
// minimal: [center 100%] -- Tab cycles overlays
```

### Pattern 4: DPEV State Machine
**What:** Centralized state tracking for DPEV phases, streaming tokens, and approval gates
**When to use:** Center panel manages all DPEV flow state

```typescript
interface DPEVState {
  sessionId: string;
  phases: Array<{
    name: string;
    model: string;
    startedAt: number;
    completedAt?: number;
    status: 'active' | 'complete' | 'error';
    tokens: string; // accumulated streaming text
  }>;
  activePhaseIndex: number;
  cacheHit?: CacheHitProvenance;
  fixPlan?: FixPlan;
  executionSteps: StepState[];
  pendingApproval?: ApprovalRequest;
  status: 'idle' | 'streaming' | 'awaiting-approval' | 'executing' | 'complete' | 'error';
}

// useReducer pattern for complex state transitions
type DPEVAction =
  | { type: 'PHASE_START'; phase: string; model: string }
  | { type: 'PHASE_COMPLETE'; phase: string }
  | { type: 'TOKEN'; text: string }
  | { type: 'CACHE_HIT'; provenance: CacheHitProvenance }
  | { type: 'PLAN_READY'; fixPlan: FixPlan }
  | { type: 'STEP_UPDATE'; stepIndex: number; status: string; stdout?: string; stderr?: string }
  | { type: 'APPROVAL_REQUIRED'; command: string; riskLevel: string; target: string }
  | { type: 'APPROVAL_RESPONSE'; approved: boolean }
  | { type: 'COMPLETE'; status: string }
  | { type: 'ERROR'; message: string };
```

### Pattern 5: Panel Focus Management
**What:** Tab-cycling focus between panels with visual indicators
**When to use:** Multi-panel layout with keyboard navigation

```typescript
// usePanel.ts -- wraps Ink's useFocus + useFocusManager
// Tab cycles: left -> center -> right -> left
// Each panel's border changes (e.g., bold + color) when focused
// useInput within focused panel handles panel-specific shortcuts
// Global shortcuts (s, g, Esc) work regardless of panel focus
```

### Pattern 6: Ink Entry Point Integration
**What:** Replace readline REPL with Ink app, keeping Commander for arg parsing
**When to use:** src/index.ts modification

```typescript
// Modified index.ts flow:
// 1. Commander parses args (same as today)
// 2. If --json flag or one-shot command: bypass Ink, use existing formatters
// 3. If interactive mode: render(<App />) instead of startRepl()
// 4. App component connects SSE, manages panels, handles keyboard
```

### Anti-Patterns to Avoid
- **console.log inside Ink render tree:** Breaks Ink's layout engine. All output must go through `<Text>` components. Use Ink's `<Static>` for permanent output if needed.
- **Blocking the render loop:** Never use synchronous I/O or long computations in render. All data fetching must be async in hooks/effects.
- **Rendering thousands of nodes without virtualization:** Ink renders to a string; massive lists cause performance issues. Session history and entity lists MUST use `.slice()` windowing.
- **Mixing readline with Ink:** Ink takes over stdin; readline must NOT be used simultaneously. This is why approval.ts needs Ink-native replacements.
- **Hardcoded column widths:** Use percentage-based `flexGrow` and `useWindowSize` for all sizing (TERM-05).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Terminal spinner | Custom frame animation | `@inkjs/ui Spinner` | Handles frame timing, cleanup, accessibility |
| Y/N confirmation | Custom input parser | `@inkjs/ui ConfirmInput` (or thin wrapper with Ink `useInput`) | Handles edge cases (capital/lower, Enter default) |
| Progress bar | ASCII art progress | `@inkjs/ui ProgressBar` | Handles terminal width, color theming |
| Status badges | Chalk color strings | `@inkjs/ui Badge` | Consistent styling, theme integration |
| Alert/callout blocks | Manual box-drawing | `@inkjs/ui Alert` | Matches the "callout" pattern for cache hit banner |
| Flexbox layout | Manual column calculation | Ink `<Box>` with Yoga | Full CSS flexbox engine; handles all edge cases |
| Terminal resize detection | SIGWINCH listener | Ink `useWindowSize` hook | Auto re-renders on resize; cross-platform |
| Focus management | Custom focus tracker | Ink `useFocus` + `useFocusManager` | Tab cycling built-in; focus IDs for programmatic control |
| SSE parsing | Custom text parser | Fetch ReadableStream + line-based parser | ~30 lines; EventSource library unnecessary for simple format |

**Key insight:** Ink v7 and `@inkjs/ui` provide nearly all the primitives needed. The main engineering effort is wiring SSE events into React state and designing the DPEV accordion/streaming UX -- not building low-level terminal rendering.

## Common Pitfalls

### Pitfall 1: SSE Connection Lifecycle
**What goes wrong:** SSE connections leak when Ink app unmounts or user navigates away from active session.
**Why it happens:** `fetch()` with streaming response body stays open; AbortController must be used for cleanup.
**How to avoid:** Every `useSSE` hook must create an `AbortController` and call `controller.abort()` in the `useEffect` cleanup function. Test this explicitly.
**Warning signs:** Memory growth, "connection refused" errors after many sessions.

### Pitfall 2: Ink + console.log Conflict
**What goes wrong:** Using `console.log` inside the Ink render tree corrupts terminal output.
**Why it happens:** Ink manages stdout buffer directly; raw writes bypass its layout engine.
**How to avoid:** Replace ALL console.log in UI-facing code with `<Text>` components. For debug logging during development, write to stderr (`console.error`) or a file.
**Warning signs:** Garbled terminal output, layout shifts, text appearing in wrong positions.

### Pitfall 3: Rendering Performance with Long Streams
**What goes wrong:** Appending every token to a growing string causes re-renders of the entire component tree.
**Why it happens:** React re-renders on state change; long diagnosis text = expensive re-renders.
**How to avoid:** Use windowed rendering -- only show the last N lines of streaming text in the viewport. Keep full text in a ref, render a slice. Completed phases collapse to 1-line summary (per CONTEXT.md accordion pattern).
**Warning signs:** Visible lag during long diagnosis streams, terminal flickering.

### Pitfall 4: Stdin Ownership Between Ink and Commander
**What goes wrong:** Commander tries to read stdin for interactive prompts while Ink owns it.
**Why it happens:** Ink takes exclusive control of stdin via `setRawMode(true)`.
**How to avoid:** Commander only parses initial args (sync). All interactive prompts (approval, search) are Ink components using `useInput`. Never mix readline and Ink in the same process.
**Warning signs:** Hung terminal, input not being processed, key presses lost.

### Pitfall 5: alternateScreen Exit Cleanup
**What goes wrong:** If the app crashes or is killed (SIGKILL), the terminal stays in alternate screen mode.
**Why it happens:** Alternate screen escape sequence (`\x1b[?1049h`) is not undone on abnormal exit.
**How to avoid:** Register SIGINT/SIGTERM handlers that restore terminal state. Ink v7 handles this for normal exits via `useApp().exit()`, but add explicit signal handlers for safety.
**Warning signs:** Terminal looks "blank" after crash; user must run `reset` command.

### Pitfall 6: Focus System and Modal Overlays
**What goes wrong:** When status overlay is open, keyboard input still routes to panel behind it.
**Why it happens:** Ink's focus system cycles through all focusable components unless explicitly disabled.
**How to avoid:** When overlay is active, set `isActive: false` on panel `useFocus` hooks to exclude them from Tab cycle. Re-enable when overlay dismisses.
**Warning signs:** Pressing keys in overlay triggers actions in background panels.

### Pitfall 7: Express SSE with Proxy Buffering
**What goes wrong:** SSE events arrive in bursts instead of real-time when behind a reverse proxy.
**Why it happens:** Nginx/Apache buffer responses by default.
**How to avoid:** Set `X-Accel-Buffering: no` header and `Cache-Control: no-cache` on SSE responses. Call `res.flushHeaders()` before streaming. The existing Express server runs locally (port 3000), so this is mainly a concern for future proxy setups.
**Warning signs:** Tokens arriving in batches instead of individually.

## Code Examples

### SSE Endpoint on Express (Server Side)
```typescript
// Source: Express SSE pattern (standard)
// src/api/routes/stream-debug.ts
import { Router } from 'express';
import type { Response } from 'express';

function initSSE(res: Response): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
}

function sendEvent(res: Response, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

// POST /stream/debug -- SSE version of /debug
router.post('/', async (req, res) => {
  initSSE(res);

  // ... run DPEV pipeline with event callbacks ...
  // On each phase: sendEvent(res, 'dpev:phase', { phase, model, status })
  // On each token: sendEvent(res, 'dpev:token', { text: chunk, phase })
  // On completion: sendEvent(res, 'dpev:complete', { sessionId, status })

  res.end();
});
```

### Ink App Root with alternateScreen
```typescript
// Source: Ink v7 documentation
// src/ui/App.tsx
import React from 'react';
import { render, Box } from 'ink';
import { HeaderBar } from './layout/HeaderBar.js';
import { PanelLayout } from './layout/PanelLayout.js';

function App({ apiBaseUrl }: { apiBaseUrl: string }) {
  return (
    <Box flexDirection="column" width="100%" height="100%">
      <HeaderBar apiBaseUrl={apiBaseUrl} />
      <PanelLayout apiBaseUrl={apiBaseUrl} />
    </Box>
  );
}

// Entry point: render with alternate screen
render(<App apiBaseUrl="http://localhost:3000" />, {
  exitOnCtrlC: true,
});
```

### useInput for Approval Component
```typescript
// Source: Ink v7 useInput hook
// src/ui/components/ApprovalWrite.tsx
import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

interface Props {
  command: string;
  onResponse: (approved: boolean) => void;
}

function ApprovalWrite({ command, onResponse }: Props) {
  const [responded, setResponded] = useState(false);

  useInput((input, key) => {
    if (responded) return;
    if (input === 'y' || input === 'Y' || key.return) {
      setResponded(true);
      onResponse(true);
    } else if (input === 'n' || input === 'N') {
      setResponded(true);
      onResponse(false);
    }
  });

  return (
    <Box flexDirection="column">
      <Text color="yellow">Execute "{command}"? [Y/n]</Text>
      {responded && <Text dimColor>Response submitted</Text>}
    </Box>
  );
}
```

### Responsive Layout with useWindowSize
```typescript
// Source: Ink v7 useWindowSize hook
import { useWindowSize } from 'ink';

function PanelLayout() {
  const { columns } = useWindowSize();

  if (columns >= 120) {
    return (
      <Box flexDirection="row" flexGrow={1}>
        <Box width="20%"><SessionPanel /></Box>
        <Box width="55%"><DPEVPanel /></Box>
        <Box width="25%"><EntityPanel /></Box>
      </Box>
    );
  } else if (columns >= 80) {
    return (
      <Box flexDirection="row" flexGrow={1}>
        <Box width="25%"><SessionPanel /></Box>
        <Box width="75%"><DPEVPanel /></Box>
        {/* EntityPanel available via 'g' toggle as overlay */}
      </Box>
    );
  } else {
    return (
      <Box flexGrow={1}>
        <DPEVPanel />
        {/* Other panels via Tab cycling */}
      </Box>
    );
  }
}
```

### ink-testing-library Pattern
```typescript
// Source: ink-testing-library v4 README
import { render } from 'ink-testing-library';
import React from 'react';
import { ApprovalWrite } from '../src/ui/components/ApprovalWrite.js';

test('ApprovalWrite renders prompt and handles Y', () => {
  const onResponse = vi.fn();
  const { lastFrame, stdin } = render(
    <ApprovalWrite command="docker restart nginx" onResponse={onResponse} />
  );

  expect(lastFrame()).toContain('Execute "docker restart nginx"?');
  expect(lastFrame()).toContain('[Y/n]');

  stdin.write('Y');
  expect(onResponse).toHaveBeenCalledWith(true);
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Ink v5/v6 + React 18 | Ink v7 + React 19.2 | April 2026 | New hooks: useWindowSize, useAnimation, useBoxMetrics, usePaste |
| `useStdout().columns` | `useWindowSize()` | Ink v7 | Dedicated hook with auto-rerender on resize |
| Manual fullscreen | `alternateScreen: true` | Ink v7 | Built-in alternate buffer; no external library needed |
| `key.delete` for backspace | `key.backspace` | Ink v7 | Breaking: backspace detection code must use new property |
| `key.meta` on Escape | `key.escape` only | Ink v7 | Breaking: Escape handler code must check key.escape |
| readline for prompts | Ink `useInput` + `useFocus` | This phase | readline and Ink cannot coexist on stdin |
| Chalk console.log | Ink `<Text>` components | This phase | Chalk stays for non-Ink paths (--json mode) |
| Buffered LLM response | SSE token streaming | This phase | New SSE endpoints parallel existing REST routes |

**Deprecated/outdated:**
- **fullscreen-ink package**: May be unnecessary with Ink v7's built-in `alternateScreen` option -- verify before adding dependency
- **ink-select-input**: Superseded by `@inkjs/ui Select` component
- **ink-text-input**: Superseded by `@inkjs/ui TextInput` component
- **ink-spinner**: Superseded by `@inkjs/ui Spinner` component

## Open Questions

1. **Ink v7 + @inkjs/ui v2 Compatibility**
   - What we know: Ink v7 released April 8, 2026; @inkjs/ui v2 released May 2024
   - What's unclear: Whether @inkjs/ui v2 is compatible with Ink v7 (it was built for Ink v5/v6)
   - Recommendation: Test `npm install ink@7 @inkjs/ui@2` for peer dependency conflicts. If incompatible, build thin wrappers using Ink v7 primitives (Spinner = useAnimation, ConfirmInput = useInput).

2. **alternateScreen vs fullscreen-ink**
   - What we know: Ink v7 has built-in `alternateScreen` option in `render()`
   - What's unclear: Whether `alternateScreen` provides full 100%-height rendering or just buffer switching
   - Recommendation: Try `alternateScreen` first; add fullscreen-ink only if layout doesn't fill terminal

3. **SSE Endpoint Design: New Routes vs Modifying Existing**
   - What we know: `/debug` and `/execute` are the existing REST routes
   - What's unclear: Whether to add `/stream/debug` and `/stream/execute` as new routes, or add `Accept: text/event-stream` content negotiation to existing routes
   - Recommendation: New routes (`/stream/debug`, `/stream/execute`) to avoid breaking existing REST API contract and keep backward compatibility clean

4. **DPEV Pipeline Refactor for Event Emission**
   - What we know: `runDPEV()` currently returns a complete `DPEVResult` object
   - What's unclear: How to make it emit events during execution without major refactor
   - Recommendation: Create a `runDPEVStreaming()` variant that accepts an event emitter callback. The existing `runDPEV()` stays unchanged for backward compatibility.

5. **Approval Flow Over SSE**
   - What we know: SSE is unidirectional (server -> client); approval requires bidirectional communication
   - What's unclear: How Ink client sends approval response back to the server
   - Recommendation: SSE sends `exec:approval` event; Ink client sends approval response via separate POST to `/execute/approve` endpoint. Server waits on a Promise that resolves when approval POST arrives.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.0.18 |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run tests/ui --reporter=verbose` |
| Full suite command | `npx vitest run` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TERM-01 | DPEV phase header shows phase name, model, elapsed time | unit | `npx vitest run tests/ui/dpev-panel.test.tsx -t "phase header" -x` | Wave 0 |
| TERM-02 | Streaming text renders token-by-token | unit | `npx vitest run tests/ui/streaming-text.test.tsx -x` | Wave 0 |
| TERM-03 | Approval components handle Y/N/typed input | unit | `npx vitest run tests/ui/approval.test.tsx -x` | Wave 0 |
| TERM-04 | Status dashboard renders header bar and overlay | unit | `npx vitest run tests/ui/status-dashboard.test.tsx -x` | Wave 0 |
| TERM-05 | Layout adapts to terminal width breakpoints | unit | `npx vitest run tests/ui/responsive-layout.test.tsx -x` | Wave 0 |
| TERM-06 | Step cards render with correct status icons and risk colors | unit | `npx vitest run tests/ui/step-card.test.tsx -x` | Wave 0 |
| TERM-07 | SSE endpoint streams DPEV events | integration | `npx vitest run tests/api/stream-debug.test.ts -x` | Wave 0 |
| TERM-08 | Existing commands produce identical output | integration | `npx vitest run tests/cli/commands.test.ts -x` | Exists |

### Sampling Rate
- **Per task commit:** `npx vitest run tests/ui --reporter=verbose`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/ui/dpev-panel.test.tsx` -- covers TERM-01 (phase header display)
- [ ] `tests/ui/streaming-text.test.tsx` -- covers TERM-02 (token streaming render)
- [ ] `tests/ui/approval.test.tsx` -- covers TERM-03 (all 3 approval tiers)
- [ ] `tests/ui/status-dashboard.test.tsx` -- covers TERM-04 (header bar + overlay)
- [ ] `tests/ui/responsive-layout.test.tsx` -- covers TERM-05 (3 breakpoints)
- [ ] `tests/ui/step-card.test.tsx` -- covers TERM-06 (step cards with risk colors)
- [ ] `tests/api/stream-debug.test.ts` -- covers TERM-07 (SSE endpoint)
- [ ] TSConfig JSX configuration: `"jsx": "react-jsx"` in tsconfig.json
- [ ] Vitest config update: include `tests/ui/**/*.test.tsx` pattern
- [ ] Framework install: `npm install ink@7 react@19 @inkjs/ui@2 ink-testing-library@4 @types/react@19`

## Sources

### Primary (HIGH confidence)
- [Ink v7 GitHub](https://github.com/vadimdemedes/ink) -- README: hooks API, components, alternateScreen, layout system
- [Ink v7.0.0 Release](https://github.com/vadimdemedes/ink/releases/tag/v7.0.0) -- Breaking changes: Node 22+, React 19.2+, key.backspace fix, key.meta change
- [@inkjs/ui GitHub](https://github.com/vadimdemedes/ink-ui) -- Component inventory: Spinner, ConfirmInput, Select, Badge, ProgressBar, Alert
- [ink-testing-library](https://github.com/vadimdemedes/ink-testing-library) -- Test API: render(), lastFrame(), stdin.write()
- Existing codebase: `src/llm/provider.ts` streamDiagnosis() async iterable, `src/api/routes/*.ts` Express routes

### Secondary (MEDIUM confidence)
- [TUI Development: Ink + React](https://combray.prose.sh/2025-12-01-tui-development) -- Multi-panel layout patterns, focus management, performance considerations
- [Express SSE patterns 2026](https://1xapi.com/blog/implement-server-sent-events-sse-nodejs-2026) -- SSE header configuration, connection management
- [Fetch Event Source patterns](https://blog.logrocket.com/using-fetch-event-source-server-sent-events-react/) -- POST-based SSE consumption via fetch

### Tertiary (LOW confidence)
- @inkjs/ui v2 + Ink v7 compatibility -- UNVERIFIED; @inkjs/ui v2 was released for Ink v5/v6; may need testing

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- Ink v7 is the only viable React terminal renderer; version requirements verified against project Node.js and config
- Architecture: HIGH -- Multi-panel layout, SSE streaming, and focus management patterns are well-documented in Ink ecosystem
- Pitfalls: HIGH -- Console.log conflict, stdin ownership, and SSE lifecycle are well-known issues with empirical guidance
- SSE endpoint design: MEDIUM -- Standard Express SSE patterns are proven, but the streaming DPEV pipeline refactor is project-specific
- @inkjs/ui compatibility: LOW -- Needs runtime verification with `npm install`

**Research date:** 2026-04-15
**Valid until:** 2026-05-15 (Ink v7 is freshly released; ecosystem may stabilize)
