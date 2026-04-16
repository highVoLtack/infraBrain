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
import { SessionPanel } from './panels/SessionPanel.js';
import { EntityPanel } from './panels/EntityPanel.js';
import { useResponsive } from './hooks/useResponsive.js';
import type { PanelId, DPEVState, DPEVPhaseState, StepState } from './types.js';

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

    // Extract execution step events for replay
    if (eventType === 'execution_start' || eventType === 'step_complete' || eventType === 'step_failed') {
      const meta = entry.metadata as Record<string, unknown> | undefined;
      if (meta?.command) {
        executionSteps.push({
          stepIndex: (meta.stepIndex as number) ?? executionSteps.length,
          total: (meta.totalSteps as number) ?? 0,
          command: meta.command as string,
          risk: (meta.risk as string) ?? 'safe',
          status: eventType === 'step_failed' ? 'failed' : 'success',
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
      {!text && <Text dimColor> type a command (e.g. debug "nginx is down")</Text>}
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
          setActivePanel('center');
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

  // Global keyboard handling for overlays and navigation
  useInput(
    (input, key) => {
      if (showStatusOverlay) {
        if (key.escape) setShowStatusOverlay(false);
        return;
      }

      if (key.tab) {
        cyclePanel();
        return;
      }

      if (key.escape) {
        if (replaySession) { setReplaySession(undefined); return; }
        if (activePrompt) { setActivePrompt(undefined); return; }
      }
    },
    { isActive: true },
  );

  // Determine center content
  let centerContent: React.ReactElement;
  if (activePrompt) {
    centerContent = (
      <DPEVPanel apiBaseUrl={apiBaseUrl} prompt={activePrompt} />
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
            activeFocus={activePanel === 'left' && !showStatusOverlay}
          />
        }
        rightContent={
          <EntityPanel
            apiBaseUrl={apiBaseUrl}
            activeFocus={activePanel === 'right' && !showStatusOverlay}
          />
        }
        showEntityOverlay={showEntityOverlay}
        entityOverlayContent={
          <EntityPanel
            apiBaseUrl={apiBaseUrl}
            activeFocus={showEntityOverlay && !showStatusOverlay}
          />
        }
      />
      {showStatusOverlay && (
        <StatusOverlay
          apiBaseUrl={apiBaseUrl}
          onDismiss={() => setShowStatusOverlay(false)}
        />
      )}
      <CommandInput
        onSubmit={handleCommand}
        onShortcut={handleShortcut}
        isActive={!showStatusOverlay}
      />
    </Box>
  );
}
