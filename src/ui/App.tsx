/**
 * App.tsx - Root Ink application component
 *
 * Renders full-screen Ink app with:
 * - HeaderBar (persistent top)
 * - PanelLayout (3/2/1 responsive panels)
 * - StatusOverlay (modal on 's' key)
 * - Global keyboard routing (Tab, s, g, Esc)
 * - CommandInput for /infra: commands
 * - DPEVPanel as center content (live or replay)
 * - SessionPanel (left) and EntityPanel (right)
 *
 * Replaces readline REPL as the interactive mode entry point.
 */

import React, { useState, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import { HeaderBar } from './layout/HeaderBar.js';
import { PanelLayout } from './layout/PanelLayout.js';
import { StatusOverlay } from './layout/StatusOverlay.js';
import { DPEVPanel } from './panels/DPEVPanel.js';
import type { DPEVLiveStatus } from './panels/DPEVPanel.js';
import { SessionPanel } from './panels/SessionPanel.js';
import { EntityPanel } from './panels/EntityPanel.js';
import { useResponsive } from './hooks/useResponsive.js';
import type { PanelId, DPEVState, DPEVPhaseState, StepState } from './types.js';

// ---- Keyboard arbitration (19.3-06 item A) ----

/**
 * Ink fires EVERY registered `useInput` handler for each keystroke — handlers are not
 * exclusive. Before this, `CommandInput`'s active flag was tied to nothing but the
 * status overlay, so it stayed live through DPEV sessions and approval gates and
 * swallowed every printable character. Three symptoms shared that root cause: `j`/`k`
 * navigation typed into the prompt, `Esc` unmounting the panel before its collapse was
 * visible, and `n` answered at a `[Y/n]` approval ALSO landing in the command box, one
 * Enter away from being submitted as a command.
 *
 * The cure is a single explicit owner rather than another ad hoc boolean: exactly one
 * surface holds the keyboard at any moment, and every consumer derives its `isActive` /
 * `activeFocus` from that one value.
 */
export type KeyboardOwner =
  | 'status-overlay'
  | 'entity-overlay'
  | 'session-panel'
  | 'entity-panel'
  | 'dpev-panel'
  | 'command-input';

export interface KeyboardContext {
  showStatusOverlay: boolean;
  showEntityOverlay: boolean;
  activePanel: PanelId;
  /** A live DPEV session is running (or finished but still on screen). */
  sessionActive: boolean;
}

/** Modals outrank panels; a Tab-focused panel outranks the session; typing is the floor. */
export function resolveKeyboardOwner(ctx: KeyboardContext): KeyboardOwner {
  if (ctx.showStatusOverlay) return 'status-overlay';
  if (ctx.showEntityOverlay) return 'entity-overlay';
  if (ctx.activePanel === 'left') return 'session-panel';
  if (ctx.activePanel === 'right') return 'entity-panel';
  if (ctx.sessionActive) return 'dpev-panel';
  return 'command-input';
}

export type EscapeAction =
  | 'dismiss-status-overlay'
  | 'dismiss-entity-overlay'
  | 'collapse-phase'
  | 'exit-replay'
  | 'exit-session'
  | 'none';

export interface EscapeContext extends KeyboardContext {
  replayActive: boolean;
  /** From DPEVPanel's `canCollapseFocusedPhase` — Esc has a visible collapse to do. */
  collapsibleFocusedPhase: boolean;
}

/**
 * `collapse-phase` means "App does nothing": DPEVPanel's own handler collapses the
 * phase on this same keystroke. It only applies while the panel actually owns the
 * keyboard — otherwise its handler is inactive and deferring to a collapse that will
 * never happen would make Esc a dead key.
 */
export function resolveEscapeAction(ctx: EscapeContext): EscapeAction {
  if (ctx.showStatusOverlay) return 'dismiss-status-overlay';
  if (ctx.showEntityOverlay) return 'dismiss-entity-overlay';
  if (ctx.replayActive) return 'exit-replay';
  if (ctx.sessionActive) {
    const owner = resolveKeyboardOwner(ctx);
    return owner === 'dpev-panel' && ctx.collapsibleFocusedPhase
      ? 'collapse-phase'
      : 'exit-session';
  }
  return 'none';
}

// ---- Pure logic (testable without React) ----

/**
 * Pure function: build a DPEVState from audit event entries.
 * Handles both new dpev_phase_start/complete and old phase_start/complete event types.
 * Sorts entries by timestamp ASC before processing (API may return DESC order).
 * Exported for unit testing.
 */
export function buildReplayState(
  sessionId: string,
  entries: Array<Record<string, unknown>>,
): DPEVState {
  // Sort entries by timestamp ascending (API returns newest first)
  const sorted = [...entries].sort((a, b) => {
    const ta = new Date(a.timestamp as string).getTime();
    const tb = new Date(b.timestamp as string).getTime();
    return ta - tb;
  });

  const phases: DPEVPhaseState[] = [];
  const executionSteps: StepState[] = [];

  for (const entry of sorted) {
    const eventType = entry.eventType as string;

    // Handle new dpev_phase_start events
    if (eventType === 'dpev_phase_start') {
      const meta = entry.metadata as Record<string, unknown> | undefined;
      phases.push({
        name: (meta?.phase as string) || 'unknown',
        model: (meta?.model as string) || '?',
        startedAt: new Date(entry.timestamp as string).getTime(),
        status: 'active',
        tokens: '',
      });
    } else if (eventType === 'dpev_phase_complete') {
      const meta = entry.metadata as Record<string, unknown> | undefined;
      const phaseName = (meta?.phase as string) || 'unknown';
      const existing = phases.find(p => p.name === phaseName);
      if (existing) {
        existing.status = 'complete';
        existing.completedAt = existing.startedAt + ((meta?.duration_ms as number) || 0);
      } else {
        // Phase arrived as complete without prior start (robust handling)
        const ts = new Date(entry.timestamp as string).getTime();
        phases.push({
          name: phaseName,
          model: (meta?.model as string) || '?',
          startedAt: ts - ((meta?.duration_ms as number) || 0),
          completedAt: ts,
          status: 'complete',
          tokens: '',
        });
      }
    }

    // Handle old phase_start/phase_complete event types (backward compat)
    if (eventType === 'phase_start') {
      const details = entry.details as Record<string, unknown> | undefined;
      const phaseName = (details?.phase as string) || 'unknown';
      if (!phases.some(p => p.name === phaseName)) {
        phases.push({
          name: phaseName,
          model: (details?.model as string) || '?',
          startedAt: new Date(entry.timestamp as string).getTime(),
          status: 'active',
          tokens: '',
        });
      }
    } else if (eventType === 'phase_complete') {
      const details = entry.details as Record<string, unknown> | undefined;
      const phaseName = (details?.phase as string) || 'unknown';
      const existing = phases.find(p => p.name === phaseName);
      if (existing) {
        existing.status = 'complete';
        const durationMs = (details?.duration_ms as number) || 0;
        if (durationMs > 0) {
          existing.completedAt = existing.startedAt + durationMs;
        } else {
          existing.completedAt = new Date(entry.timestamp as string).getTime();
        }
      } else {
        const ts = new Date(entry.timestamp as string).getTime();
        const durationMs = (details?.duration_ms as number) || 0;
        phases.push({
          name: phaseName,
          model: (details?.model as string) || '?',
          startedAt: durationMs > 0 ? ts - durationMs : ts,
          completedAt: ts,
          status: 'complete',
          tokens: '',
        });
      }
    }

    // Extract execution step events for replay.
    // D-17 parity: replay must carry command/risk/target/stdout/stderr, not just a
    // synthesized status, or TERM-UX08's "every step's command + output" is unmet.
    if (eventType === 'execution_start' || eventType === 'step_complete' || eventType === 'step_failed') {
      const meta = entry.metadata as Record<string, unknown> | undefined;
      // executor.ts:86 logs a plan-level execution_start ({ planSummary, target,
      // stepCount }) with no stepIndex — that envelope is not a step.
      if (!meta || typeof meta.stepIndex !== 'number') continue;

      const stepIndex = meta.stepIndex;
      const existingIdx = executionSteps.findIndex(s => s.stepIndex === stepIndex);

      const command = typeof meta.command === 'string' ? meta.command : undefined;
      const risk = typeof meta.risk === 'string' ? meta.risk : undefined;
      const target = typeof meta.target === 'string' ? meta.target : undefined;
      const total = typeof meta.totalSteps === 'number' ? meta.totalSteps : undefined;
      const stdout = typeof meta.stdout === 'string' ? meta.stdout : undefined;
      const stderr = typeof meta.stderr === 'string' ? meta.stderr : undefined;

      const status: StepState['status'] =
        eventType === 'execution_start' ? 'pending'
        : eventType === 'step_failed' ? 'failed'
        : 'success';

      if (existingIdx >= 0) {
        // Merge, mirroring the runtime STEP_UPDATE reducer: the later event owns
        // status/stdout/stderr, but must never erase fields an earlier event captured.
        const prior = executionSteps[existingIdx]!;
        executionSteps[existingIdx] = {
          ...prior,
          status,
          stdout: stdout ?? prior.stdout,
          stderr: stderr ?? prior.stderr,
          command: command ?? prior.command,
          risk: risk ?? prior.risk,
          target: target ?? prior.target,
          total: total ?? prior.total,
        };
      } else {
        executionSteps.push({
          stepIndex,
          total: total ?? 0,
          command: command ?? '',
          risk: risk ?? '',
          status,
          stdout,
          stderr,
          target,
        });
      }
    }
  }

  return {
    sessionId,
    phases,
    activePhaseIndex: -1,
    executionSteps,
    status: 'complete',
    // D-04: replay opens with every phase collapsed — the overview first, drill in on demand.
    expandedPhases: {},
  };
}

/**
 * Pure function: parse a /infra: command string into command name and args.
 * Returns null if not a valid /infra: command.
 */
export function parseInfraCommand(input: string): { command: string; args: string } | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/infra:')) return null;

  const withoutPrefix = trimmed.slice(7); // Remove "/infra:"
  const spaceIdx = withoutPrefix.indexOf(' ');
  if (spaceIdx === -1) {
    return { command: withoutPrefix, args: '' };
  }
  return {
    command: withoutPrefix.slice(0, spaceIdx),
    args: withoutPrefix.slice(spaceIdx + 1).replace(/^["']|["']$/g, '').trim(),
  };
}

// ---- IdleView sub-component ----

function IdleView(): React.ReactElement {
  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Text bold color="cyanBright">InfraBrain v1.3</Text>
      <Text> </Text>
      <Text dimColor>Commands:</Text>
      <Text dimColor>  debug &lt;prompt&gt;   Diagnose an issue</Text>
      <Text dimColor>  status           Open status dashboard</Text>
      <Text dimColor>  history          Browse past sessions</Text>
      <Text dimColor>  resume           Load a resumable session</Text>
      <Text> </Text>
      <Text dimColor>Keys: Tab=panels  s=status  g=entities  Esc=back</Text>
    </Box>
  );
}

// ---- CommandInput sub-component ----

function CommandInput({
  onSubmit,
  onShortcut,
  isActive,
}: {
  onSubmit: (input: string) => void;
  onShortcut?: (key: string) => boolean;
  isActive: boolean;
}): React.ReactElement {
  const [text, setText] = useState('');

  useInput((input, key) => {
    if (key.return && text.trim()) {
      onSubmit(text);
      setText('');
    } else if (key.backspace || key.delete) {
      setText((t) => t.slice(0, -1));
    } else if (!text && input && onShortcut?.(input)) {
      // Single-key shortcut handled when input is empty
    } else if (input && !key.ctrl && !key.meta && !key.tab && !key.escape) {
      setText((t) => t + input);
    }
  }, { isActive });

  return (
    <Box paddingX={1} borderStyle="single" borderColor={isActive ? 'cyanBright' : 'gray'}>
      <Text color="cyanBright" bold>{'\u276F'} </Text>
      <Text>{text}</Text>
      <Text color="gray">{isActive ? '_' : ''}</Text>
      {!text && (
        <Text dimColor>
          {isActive
            ? ' type a command (e.g. debug "nginx is down")'
            : ' Tab to focus the prompt'}
        </Text>
      )}
    </Box>
  );
}

// ---- Main App Component ----

export interface AppProps {
  apiBaseUrl: string;
  initialCommand?: { type: string; args: string[] };
}

const PANEL_ORDER: PanelId[] = ['left', 'center', 'right'];

export function App({ apiBaseUrl }: AppProps): React.ReactElement {
  // Panel focus management
  const [activePanel, setActivePanel] = useState<PanelId>('center');

  // Responsive layout
  const { mode } = useResponsive();

  // Overlay states
  const [showStatusOverlay, setShowStatusOverlay] = useState(false);
  const [showEntityOverlay, setShowEntityOverlay] = useState(false);

  // DPEV states
  const [activePrompt, setActivePrompt] = useState<string | undefined>();
  const [replaySession, setReplaySession] = useState<DPEVState | undefined>();

  // Entity refresh counter -- increment to trigger EntityPanel re-fetch
  const [entityRefreshKey, setEntityRefreshKey] = useState(0);

  // What the live DPEV panel reports upward: cumulative session tokens (feeds the
  // StatusOverlay context bar — 19.3-06 item B) and whether Esc has a collapse to do.
  const [dpevStatus, setDpevStatus] = useState<DPEVLiveStatus>({ collapsible: false });

  const handleDpevStatus = useCallback((next: DPEVLiveStatus) => {
    // Returning the previous reference bails React out of a re-render, so an
    // unchanged projection never re-renders the header and side panels.
    setDpevStatus((prev) =>
      prev.sessionTokens === next.sessionTokens && prev.collapsible === next.collapsible
        ? prev
        : next,
    );
  }, []);

  // Panel cycling
  const cyclePanel = useCallback(() => {
    setActivePanel((current) => {
      const idx = PANEL_ORDER.indexOf(current);
      return PANEL_ORDER[(idx + 1) % PANEL_ORDER.length]!;
    });
  }, []);

  // Handle session selection from SessionPanel
  const handleSessionSelect = useCallback(
    async (sessionId: string) => {
      try {
        const res = await fetch(`${apiBaseUrl}/history?session=${sessionId}&verbose=true`);
        if (res.ok) {
          const data = await res.json() as { entries: Array<Record<string, unknown>> };
          const replayState = buildReplayState(sessionId, data.entries || []);
          setReplaySession(replayState);
          setActivePrompt(undefined);
          setDpevStatus({ collapsible: false });
          setActivePanel('center');
          setEntityRefreshKey(k => k + 1);
        }
      } catch {
        // Graceful degradation
      }
    },
    [apiBaseUrl],
  );

  // Handle command submission from CommandInput
  const handleCommand = useCallback(
    (input: string) => {
      const trimmed = input.trim();
      // Support both "debug ..." and "/infra:debug ..." formats
      const parsed = trimmed.startsWith('/infra:')
        ? parseInfraCommand(trimmed)
        : parseInfraCommand(`/infra:${trimmed}`);

      if (!parsed) return;

      switch (parsed.command) {
        case 'debug':
          if (parsed.args) {
            setActivePrompt(parsed.args);
            setReplaySession(undefined);
            setDpevStatus({ collapsible: false });
          }
          break;
        case 'status':
          setShowStatusOverlay(true);
          break;
        case 'history':
          setActivePanel('left');
          break;
        case 'resume':
          if (parsed.args) {
            handleSessionSelect(parsed.args);
          }
          break;
      }
    },
    [handleSessionSelect],
  );

  // Shortcut handler for CommandInput (fires when input field is empty)
  const handleShortcut = useCallback(
    (key: string): boolean => {
      if (key === 's') {
        setShowStatusOverlay((v) => !v);
        return true;
      }
      if (key === 'g' && mode === 'compact') {
        setShowEntityOverlay((v) => !v);
        return true;
      }
      return false;
    },
    [mode],
  );

  // Exactly one surface owns the keyboard at any moment (19.3-06 item A).
  const keyboardContext: KeyboardContext = {
    showStatusOverlay,
    showEntityOverlay,
    activePanel,
    sessionActive: activePrompt !== undefined,
  };
  const keyboardOwner = resolveKeyboardOwner(keyboardContext);

  // Global keyboard handling for overlays and navigation
  useInput(
    (input, key) => {
      if (key.escape) {
        switch (resolveEscapeAction({
          ...keyboardContext,
          replayActive: replaySession !== undefined,
          collapsibleFocusedPhase: dpevStatus.collapsible,
        })) {
          case 'dismiss-status-overlay':
            setShowStatusOverlay(false);
            return;
          case 'dismiss-entity-overlay':
            setShowEntityOverlay(false);
            return;
          case 'exit-replay':
            setReplaySession(undefined);
            return;
          case 'exit-session':
            setActivePrompt(undefined);
            setDpevStatus({ collapsible: false });
            setEntityRefreshKey(k => k + 1);
            return;
          // DPEVPanel's own handler collapses the focused phase on this same
          // keystroke — unmounting the panel here would hide the collapse.
          case 'collapse-phase':
          case 'none':
            return;
        }
      }

      // An open overlay is modal: it swallows everything except its own toggles.
      if (keyboardOwner === 'status-overlay' || keyboardOwner === 'entity-overlay') {
        if (input === 's') setShowStatusOverlay(v => !v);
        else if (input === 'g' && mode === 'compact') setShowEntityOverlay(v => !v);
        return;
      }

      if (key.tab) {
        cyclePanel();
        return;
      }

      // `s` / `g` belong to CommandInput's onShortcut while it owns the keyboard —
      // routing them here too would toggle the overlay on the `s` of a typed "status".
      if (keyboardOwner !== 'command-input' && input) {
        if (input === 's') { setShowStatusOverlay(v => !v); return; }
        if (input === 'g' && mode === 'compact') { setShowEntityOverlay(v => !v); return; }
      }
    },
    { isActive: true },
  );

  // Determine center content
  let centerContent: React.ReactElement;
  if (activePrompt) {
    centerContent = (
      <DPEVPanel
        key={activePrompt}
        apiBaseUrl={apiBaseUrl}
        prompt={activePrompt}
        activeFocus={keyboardOwner === 'dpev-panel'}
        onStatusChange={handleDpevStatus}
      />
    );
  } else if (replaySession) {
    centerContent = (
      <Box flexDirection="column">
        <DPEVPanel apiBaseUrl={apiBaseUrl} replaySession={replaySession} />
        <Box marginTop={1}>
          <Text color="yellow" bold>Replay mode</Text>
          <Text dimColor> - Press Esc to return to live</Text>
        </Box>
      </Box>
    );
  } else {
    centerContent = <IdleView />;
  }

  return (
    <Box flexDirection="column" width="100%" height="100%">
      <HeaderBar apiBaseUrl={apiBaseUrl} />
      <PanelLayout
        apiBaseUrl={apiBaseUrl}
        activePanel={activePanel}
        centerContent={centerContent}
        leftContent={
          <SessionPanel
            apiBaseUrl={apiBaseUrl}
            onSelect={handleSessionSelect}
            activeFocus={keyboardOwner === 'session-panel'}
          />
        }
        rightContent={
          <EntityPanel
            apiBaseUrl={apiBaseUrl}
            activeFocus={keyboardOwner === 'entity-panel'}
            refreshKey={entityRefreshKey}
          />
        }
        showEntityOverlay={showEntityOverlay}
        entityOverlayContent={
          <EntityPanel
            apiBaseUrl={apiBaseUrl}
            activeFocus={keyboardOwner === 'entity-overlay'}
            refreshKey={entityRefreshKey}
          />
        }
      />
      {showStatusOverlay && (
        <StatusOverlay
          apiBaseUrl={apiBaseUrl}
          onDismiss={() => setShowStatusOverlay(false)}
          sessionTokens={dpevStatus.sessionTokens}
        />
      )}
      <CommandInput
        onSubmit={handleCommand}
        onShortcut={handleShortcut}
        isActive={keyboardOwner === 'command-input'}
      />
    </Box>
  );
}
