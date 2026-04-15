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
import type { PanelId, DPEVState } from './types.js';

// ---- Pure logic (testable without React) ----

export type InputMode = 'normal' | 'command';

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
      <Text dimColor>Type /infra:debug "prompt" to diagnose an issue</Text>
      <Text dimColor>Type /infra:status to open status dashboard</Text>
      <Text dimColor>Type /infra:history to browse past sessions</Text>
      <Text dimColor>Type /infra:resume to load a resumable session</Text>
      <Text> </Text>
      <Text dimColor>Shortcuts: Tab=cycle panels  s=status  g=entities  Esc=dismiss</Text>
    </Box>
  );
}

// ---- CommandInput sub-component ----

function CommandInput({
  onSubmit,
  onCancel,
}: {
  onSubmit: (input: string) => void;
  onCancel: () => void;
}): React.ReactElement {
  const [text, setText] = useState('');

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
    } else if (key.return) {
      onSubmit(text);
      setText('');
    } else if (key.backspace || key.delete) {
      setText((t) => t.slice(0, -1));
    } else if (input && !key.ctrl && !key.meta) {
      setText((t) => t + input);
    }
  }, { isActive: true });

  return (
    <Box paddingX={1}>
      <Text color="yellow">/infra:</Text>
      <Text>{text}</Text>
      <Text color="gray">_</Text>
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

  // Input mode
  const [inputMode, setInputMode] = useState<InputMode>('normal');

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
          // Build a minimal DPEVState for replay
          const replayState: DPEVState = {
            sessionId,
            phases: [],
            activePhaseIndex: -1,
            executionSteps: [],
            status: 'complete',
          };

          // Extract phases from audit entries if available
          for (const entry of (data.entries || [])) {
            if (entry.eventType === 'phase_start' || entry.eventType === 'phase_complete') {
              const phaseName = (entry.details as Record<string, unknown>)?.phase as string;
              if (phaseName && !replayState.phases.some(p => p.name === phaseName)) {
                replayState.phases.push({
                  name: phaseName,
                  model: ((entry.details as Record<string, unknown>)?.model as string) || '?',
                  startedAt: new Date(entry.timestamp as string).getTime(),
                  status: 'complete',
                  tokens: '',
                  completedAt: new Date(entry.timestamp as string).getTime(),
                });
              }
            }
          }

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
      const fullCommand = `/infra:${input}`;
      const parsed = parseInfraCommand(fullCommand);
      if (!parsed) {
        setInputMode('normal');
        return;
      }

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
      setInputMode('normal');
    },
    [handleSessionSelect],
  );

  // Global keyboard handling (disabled when overlay or command input is active)
  useInput(
    (input, key) => {
      if (showStatusOverlay || inputMode === 'command') return;

      if (key.tab) {
        cyclePanel();
        return;
      }

      if (input === 's') {
        setShowStatusOverlay(true);
        return;
      }

      if (input === 'g' && mode === 'compact') {
        setShowEntityOverlay((prev) => !prev);
        return;
      }

      if (key.escape) {
        // Return from replay to idle
        if (replaySession) {
          setReplaySession(undefined);
          return;
        }
        // Reset active prompt
        if (activePrompt) {
          setActivePrompt(undefined);
          return;
        }
      }

      if (input === '/') {
        setInputMode('command');
        return;
      }
    },
    { isActive: !showStatusOverlay && inputMode !== 'command' },
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
      {inputMode === 'command' && (
        <CommandInput
          onSubmit={handleCommand}
          onCancel={() => setInputMode('normal')}
        />
      )}
    </Box>
  );
}
