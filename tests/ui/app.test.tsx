/**
 * Tests for App.tsx root component and StatusOverlay
 *
 * Tests pure functions and component rendering via ink-testing-library.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'ink-testing-library';
import { readFileSync } from 'node:fs';
import {
  App,
  parseInfraCommand,
  buildReplayState,
  resolveKeyboardOwner,
  resolveEscapeAction,
} from '../../src/ui/App.js';
import {
  StatusOverlay,
  parseOverlayData,
  renderProgressBar,
} from '../../src/ui/layout/StatusOverlay.js';

// ---- Pure function tests: parseInfraCommand ----

describe('parseInfraCommand', () => {
  it('parses /infra:debug with quoted args', () => {
    const result = parseInfraCommand('/infra:debug "test containers"');
    expect(result).toEqual({ command: 'debug', args: 'test containers' });
  });

  it('parses /infra:status without args', () => {
    const result = parseInfraCommand('/infra:status');
    expect(result).toEqual({ command: 'status', args: '' });
  });

  it('parses /infra:history without args', () => {
    const result = parseInfraCommand('/infra:history');
    expect(result).toEqual({ command: 'history', args: '' });
  });

  it('parses /infra:resume with session ID', () => {
    const result = parseInfraCommand('/infra:resume sess-abc123');
    expect(result).toEqual({ command: 'resume', args: 'sess-abc123' });
  });

  it('returns null for non /infra: input', () => {
    expect(parseInfraCommand('hello world')).toBeNull();
    expect(parseInfraCommand('debug test')).toBeNull();
  });

  it('handles whitespace gracefully', () => {
    const result = parseInfraCommand('  /infra:debug "test"  ');
    expect(result).toEqual({ command: 'debug', args: 'test' });
  });
});

// ---- Pure function tests: buildReplayState ----

describe('buildReplayState', () => {
  it('builds DPEVPhaseState from dpev_phase_start and dpev_phase_complete', () => {
    const entries = [
      {
        eventType: 'dpev_phase_start',
        timestamp: '2026-04-16T10:00:00.000Z',
        metadata: { phase: 'discovery', model: 'qwen3-0.6b' },
      },
      {
        eventType: 'dpev_phase_complete',
        timestamp: '2026-04-16T10:00:01.200Z',
        metadata: { phase: 'discovery', model: 'qwen3-0.6b', duration_ms: 1200 },
      },
    ];

    const state = buildReplayState('sess-001', entries);
    expect(state.phases).toHaveLength(1);
    expect(state.phases[0]!.name).toBe('discovery');
    expect(state.phases[0]!.model).toBe('qwen3-0.6b');
    expect(state.phases[0]!.status).toBe('complete');
    expect(state.phases[0]!.completedAt).toBe(state.phases[0]!.startedAt + 1200);
  });

  it('builds multiple phase entries in order from discovery, diagnosis, plan', () => {
    const entries = [
      { eventType: 'dpev_phase_start', timestamp: '2026-04-16T10:00:00.000Z', metadata: { phase: 'discovery', model: 'qwen3-0.6b' } },
      { eventType: 'dpev_phase_complete', timestamp: '2026-04-16T10:00:01.000Z', metadata: { phase: 'discovery', model: 'qwen3-0.6b', duration_ms: 1000 } },
      { eventType: 'dpev_phase_start', timestamp: '2026-04-16T10:00:02.000Z', metadata: { phase: 'diagnosis', model: 'qwen3-32b' } },
      { eventType: 'dpev_phase_complete', timestamp: '2026-04-16T10:00:05.000Z', metadata: { phase: 'diagnosis', model: 'qwen3-32b', duration_ms: 3000 } },
      { eventType: 'dpev_phase_start', timestamp: '2026-04-16T10:00:06.000Z', metadata: { phase: 'plan', model: 'qwen3-14b' } },
      { eventType: 'dpev_phase_complete', timestamp: '2026-04-16T10:00:08.000Z', metadata: { phase: 'plan', model: 'qwen3-14b', duration_ms: 2000 } },
    ];

    const state = buildReplayState('sess-002', entries);
    expect(state.phases).toHaveLength(3);
    expect(state.phases[0]!.name).toBe('discovery');
    expect(state.phases[1]!.name).toBe('diagnosis');
    expect(state.phases[2]!.name).toBe('plan');
    expect(state.status).toBe('complete');
  });

  it('returns empty phases array when no dpev_phase events exist', () => {
    const entries = [
      { eventType: 'session_start', timestamp: '2026-04-16T10:00:00.000Z', metadata: {} },
      { eventType: 'session_end', timestamp: '2026-04-16T10:00:05.000Z', metadata: {} },
    ];

    const state = buildReplayState('sess-003', entries);
    expect(state.phases).toHaveLength(0);
    expect(state.sessionId).toBe('sess-003');
    expect(state.status).toBe('complete');
  });

  it('computes completedAt from startedAt + duration_ms', () => {
    const entries = [
      { eventType: 'dpev_phase_start', timestamp: '2026-04-16T10:00:00.000Z', metadata: { phase: 'discovery', model: 'qwen3-0.6b' } },
      { eventType: 'dpev_phase_complete', timestamp: '2026-04-16T10:00:02.500Z', metadata: { phase: 'discovery', model: 'qwen3-0.6b', duration_ms: 2500 } },
    ];

    const state = buildReplayState('sess-004', entries);
    const phase = state.phases[0]!;
    const expectedStart = new Date('2026-04-16T10:00:00.000Z').getTime();
    expect(phase.startedAt).toBe(expectedStart);
    expect(phase.completedAt).toBe(expectedStart + 2500);
  });

  it('handles entries in reverse (DESC) order by sorting them ASC before processing', () => {
    // API returns newest first -- buildReplayState should handle this
    const entries = [
      { eventType: 'dpev_phase_complete', timestamp: '2026-04-16T10:00:05.000Z', metadata: { phase: 'diagnosis', model: 'qwen3-32b', duration_ms: 3000 } },
      { eventType: 'dpev_phase_start', timestamp: '2026-04-16T10:00:02.000Z', metadata: { phase: 'diagnosis', model: 'qwen3-32b' } },
      { eventType: 'dpev_phase_complete', timestamp: '2026-04-16T10:00:01.000Z', metadata: { phase: 'discovery', model: 'qwen3-0.6b', duration_ms: 1000 } },
      { eventType: 'dpev_phase_start', timestamp: '2026-04-16T10:00:00.000Z', metadata: { phase: 'discovery', model: 'qwen3-0.6b' } },
    ];

    const state = buildReplayState('sess-005', entries);
    expect(state.phases).toHaveLength(2);
    // After sorting ASC, discovery start comes first
    expect(state.phases[0]!.name).toBe('discovery');
    expect(state.phases[0]!.status).toBe('complete');
    expect(state.phases[1]!.name).toBe('diagnosis');
    expect(state.phases[1]!.status).toBe('complete');
  });

  it('also handles old phase_start/phase_complete event types for backward compat', () => {
    const entries = [
      {
        eventType: 'phase_start',
        timestamp: '2026-04-16T10:00:00.000Z',
        details: { phase: 'discovery', model: 'qwen3-0.6b' },
      },
      {
        eventType: 'phase_complete',
        timestamp: '2026-04-16T10:00:01.000Z',
        details: { phase: 'discovery', model: 'qwen3-0.6b', duration_ms: 1000 },
      },
    ];

    const state = buildReplayState('sess-006', entries);
    expect(state.phases).toHaveLength(1);
    expect(state.phases[0]!.name).toBe('discovery');
    expect(state.phases[0]!.status).toBe('complete');
  });

  // ---- Plan 19.3-06: replay parity with the live observability surface (TERM-UX08) ----

  it('initialises expandedPhases to an empty object (D-04: all phases collapsed)', () => {
    const state = buildReplayState('sess-007', []);
    expect(state.expandedPhases).toBeDefined();
    expect(Object.keys(state.expandedPhases!)).toHaveLength(0);
  });

  it('keeps expandedPhases empty even when phases were reconstructed', () => {
    const entries = [
      { eventType: 'dpev_phase_start', timestamp: '2026-04-17T10:00:00.000Z', metadata: { phase: 'diagnosis', model: 'gemini-2.5-pro' } },
      { eventType: 'dpev_phase_complete', timestamp: '2026-04-17T10:00:03.000Z', metadata: { phase: 'diagnosis', model: 'gemini-2.5-pro', duration_ms: 3000 } },
    ];
    const state = buildReplayState('sess-008', entries);
    expect(state.phases).toHaveLength(1);
    expect(state.expandedPhases).toEqual({});
  });

  it('populates step command/risk/target/stdout from step_complete metadata (D-17 parity)', () => {
    const entries = [
      {
        eventType: 'step_complete',
        timestamp: '2026-04-17T10:00:00.000Z',
        metadata: { stepIndex: 0, totalSteps: 2, command: 'docker ps', risk: 'read', target: 'nginx', stdout: 'listed\n' },
      },
    ];

    const state = buildReplayState('sess-009', entries);
    expect(state.executionSteps).toHaveLength(1);
    expect(state.executionSteps[0]).toEqual({
      stepIndex: 0,
      total: 2,
      command: 'docker ps',
      risk: 'read',
      target: 'nginx',
      status: 'success',
      stdout: 'listed\n',
      stderr: undefined,
    });
  });

  it('populates stderr and a failed status from step_failed metadata', () => {
    const entries = [
      {
        eventType: 'step_failed',
        timestamp: '2026-04-17T10:00:00.000Z',
        metadata: { stepIndex: 1, totalSteps: 2, command: 'nginx -s reload', risk: 'write', stderr: 'error' },
      },
    ];

    const state = buildReplayState('sess-010', entries);
    expect(state.executionSteps).toHaveLength(1);
    expect(state.executionSteps[0]!.status).toBe('failed');
    expect(state.executionSteps[0]!.stderr).toBe('error');
    expect(state.executionSteps[0]!.command).toBe('nginx -s reload');
  });

  it('merges execution_start (pending) and step_complete for the same stepIndex', () => {
    const entries = [
      {
        eventType: 'execution_start',
        timestamp: '2026-04-17T10:00:00.000Z',
        metadata: { stepIndex: 0, totalSteps: 1, command: 'ls', risk: 'read' },
      },
      {
        eventType: 'step_complete',
        timestamp: '2026-04-17T10:00:01.000Z',
        metadata: { stepIndex: 0, stdout: 'out' },
      },
    ];

    const state = buildReplayState('sess-011', entries);
    expect(state.executionSteps).toHaveLength(1);
    const step = state.executionSteps[0]!;
    expect(step.command).toBe('ls');
    expect(step.risk).toBe('read');
    expect(step.status).toBe('success');
    expect(step.stdout).toBe('out');
    expect(step.total).toBe(1);
  });

  it('does not overwrite an already-recorded command with a later undefined', () => {
    const entries = [
      {
        eventType: 'execution_start',
        timestamp: '2026-04-17T10:00:00.000Z',
        metadata: { stepIndex: 0, totalSteps: 1, command: 'ls', risk: 'read', target: 'nginx' },
      },
      {
        eventType: 'step_complete',
        timestamp: '2026-04-17T10:00:01.000Z',
        metadata: { stepIndex: 0, stdout: 'x' },
      },
    ];

    const state = buildReplayState('sess-012', entries);
    const step = state.executionSteps[0]!;
    expect(step.command).toBe('ls');
    expect(step.target).toBe('nginx');
    expect(step.stdout).toBe('x');
  });

  it('records an execution_start-only step as pending rather than dropping it', () => {
    const entries = [
      {
        eventType: 'execution_start',
        timestamp: '2026-04-17T10:00:00.000Z',
        metadata: { stepIndex: 0, totalSteps: 3, command: 'systemctl status nginx', risk: 'read' },
      },
    ];

    const state = buildReplayState('sess-013', entries);
    expect(state.executionSteps).toHaveLength(1);
    expect(state.executionSteps[0]!.status).toBe('pending');
    expect(state.executionSteps[0]!.total).toBe(3);
  });

  it('ignores execution_start envelopes that carry no per-step metadata', () => {
    // src/execution/executor.ts:86 logs a plan-level execution_start with
    // { planSummary, target, stepCount } and no stepIndex/command. That entry must
    // not materialise as a phantom step with an empty command.
    const entries = [
      {
        eventType: 'execution_start',
        timestamp: '2026-04-17T10:00:00.000Z',
        metadata: { planSummary: 'restart nginx', target: 'nginx', stepCount: 2 },
      },
    ];

    const state = buildReplayState('sess-014', entries);
    expect(state.executionSteps).toHaveLength(0);
  });
});

// ---- Pure function tests: parseOverlayData ----

describe('parseOverlayData', () => {
  it('parses health and status responses into overlay data', () => {
    const result = parseOverlayData(
      {
        backends: [
          { baseUrl: 'http://localhost:11434/v1', connected: true, responseTimeMs: 42, models: ['qwen3-32b'] },
        ],
        modelRegistry: [
          { role: 'reasoning', model: 'qwen3-32b' },
          { role: 'worker', model: 'qwen3-0.6b' },
        ],
        inferenceMode: 'parallel',
      },
      {
        cache: { totalEntries: 15, hitRate: 0.73, avgConfidence: 0.85 },
        memory: { incidentCount: 42, entityCount: 88, walSize: '1.2 KB' },
        context: { currentTokens: 8000, maxTokens: 32768 },
      },
    );

    expect(result.backends).toHaveLength(1);
    expect(result.backends[0].connected).toBe(true);
    expect(result.modelAssignments).toHaveLength(2);
    expect(result.modelAssignments[0]).toEqual({ role: 'reasoning', model: 'qwen3-32b' });
    expect(result.cacheStats.hitRate).toBe('73.0%');
    expect(result.cacheStats.totalEntries).toBe(15);
    expect(result.cacheStats.avgConfidence).toBe('85.0%');
    expect(result.memoryStats.incidentCount).toBe(42);
    expect(result.memoryStats.entityCount).toBe(88);
    expect(result.memoryStats.walSize).toBe('1.2 KB');
    expect(result.contextWindow.current).toBe(8000);
    expect(result.contextWindow.max).toBe(32768);
    expect(result.contextWindow.percentage).toBe(24);
    expect(result.inferenceMode).toBe('parallel');
  });

  it('returns defaults when responses are empty', () => {
    const result = parseOverlayData({}, undefined);
    expect(result.backends).toEqual([]);
    expect(result.modelAssignments).toEqual([]);
    expect(result.cacheStats.hitRate).toBe('N/A');
    expect(result.cacheStats.totalEntries).toBe(0);
    expect(result.memoryStats.incidentCount).toBe(0);
    expect(result.contextWindow.percentage).toBe(0);
  });
});

// ---- Pure function tests: renderProgressBar ----

describe('renderProgressBar', () => {
  it('renders 50% progress bar', () => {
    const bar = renderProgressBar(50, 10);
    expect(bar).toBe('[#####-----] 50%');
  });

  it('renders 0% progress bar', () => {
    const bar = renderProgressBar(0, 10);
    expect(bar).toBe('[----------] 0%');
  });

  it('renders 100% progress bar', () => {
    const bar = renderProgressBar(100, 10);
    expect(bar).toBe('[##########] 100%');
  });
});

// ---- Component tests: StatusOverlay ----

describe('StatusOverlay', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    // Mock fetch to return default data
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        backends: [
          { baseUrl: 'http://localhost:11434/v1', connected: true, responseTimeMs: 35, models: ['qwen3-32b'] },
        ],
        inferenceMode: 'sequential',
      }),
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('renders STATUS DASHBOARD title', () => {
    const onDismiss = vi.fn();
    const { lastFrame } = render(
      React.createElement(StatusOverlay, {
        apiBaseUrl: 'http://localhost:3000',
        onDismiss,
      }),
    );
    expect(lastFrame()).toContain('STATUS DASHBOARD');
  });

  it('renders section headers', () => {
    const onDismiss = vi.fn();
    const { lastFrame } = render(
      React.createElement(StatusOverlay, {
        apiBaseUrl: 'http://localhost:3000',
        onDismiss,
      }),
    );
    const frame = lastFrame();
    expect(frame).toContain('Backends');
    expect(frame).toContain('Cache Stats');
    expect(frame).toContain('Memory Stats');
    expect(frame).toContain('Context Window');
    // 19.3-05: "Compression Efficiency / Caveman/Perc integration: v2.0" was
    // superseded by the D-23 "Intelligence Efficiency" section, which carries the
    // same v2.0 placeholders as three named metrics instead of one prose line.
    expect(frame).toContain('Intelligence Efficiency');
  });

  it('calls onDismiss when Esc is pressed', async () => {
    const onDismiss = vi.fn();
    const { stdin } = render(
      React.createElement(StatusOverlay, {
        apiBaseUrl: 'http://localhost:3000',
        onDismiss,
      }),
    );

    // Send Escape key
    stdin.write('\x1B');

    // React 19 batched updates need flush
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(onDismiss).toHaveBeenCalled();
  });
});

// ---- Component tests: App ----

describe('App', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    // Mock fetch for HeaderBar /health polling and SessionPanel/EntityPanel fetches
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/health')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            backends: [
              { baseUrl: 'http://localhost:11434/v1', connected: true, models: ['qwen3-32b'] },
            ],
            summary: 'all_connected',
            inferenceMode: 'sequential',
          }),
        });
      }
      if (url.includes('/history')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ sessions: [], count: 0, entries: [] }),
        });
      }
      if (url.includes('/entities')) {
        return Promise.resolve({
          ok: true,
          json: async () => ([]),
        });
      }
      if (url.includes('/status')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({}),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({}),
      });
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('renders InfraBrain header text', async () => {
    const { lastFrame } = render(
      React.createElement(App, { apiBaseUrl: 'http://localhost:3000' }),
    );
    // Wait for async effects
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(lastFrame()).toContain('InfraBrain');
  });

  it('renders idle view when no prompt is active', () => {
    const { lastFrame } = render(
      React.createElement(App, { apiBaseUrl: 'http://localhost:3000' }),
    );
    expect(lastFrame()).toContain('InfraBrain v1.3');
    expect(lastFrame()).toContain('debug');
  });

  it('opens status overlay with s key shortcut (when input empty)', async () => {
    const { lastFrame, stdin } = render(
      React.createElement(App, { apiBaseUrl: 'http://localhost:3000' }),
    );

    expect(lastFrame()).not.toContain('STATUS DASHBOARD');

    // Press 's' with empty command input — should trigger shortcut
    stdin.write('s');
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(lastFrame()).toContain('STATUS DASHBOARD');
  });

  it('opens status overlay via status command', async () => {
    const { lastFrame, stdin } = render(
      React.createElement(App, { apiBaseUrl: 'http://localhost:3000' }),
    );

    // Initially no overlay
    expect(lastFrame()).not.toContain('STATUS DASHBOARD');

    // Type 'status' command and press Enter
    stdin.write('status');
    await new Promise((resolve) => setTimeout(resolve, 50));
    stdin.write('\r');
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(lastFrame()).toContain('STATUS DASHBOARD');
  });

  it('dismisses status overlay with Esc', async () => {
    const { lastFrame, stdin } = render(
      React.createElement(App, { apiBaseUrl: 'http://localhost:3000' }),
    );

    // Open overlay via command
    stdin.write('status');
    await new Promise((resolve) => setTimeout(resolve, 50));
    stdin.write('\r');
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(lastFrame()).toContain('STATUS DASHBOARD');

    // Press Esc to dismiss
    stdin.write('\x1B');
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(lastFrame()).not.toContain('STATUS DASHBOARD');
  });
});

// ---- Plan 19.3-06 item A: keyboard arbitration ----
//
// Ink fires EVERY registered useInput handler per keystroke — handlers are not
// exclusive. Before this plan, CommandInput was mounted with
// `isActive={!showStatusOverlay}`, so it stayed live through DPEV sessions and
// approval gates and swallowed every printable character (App.tsx:204). Three
// symptoms, one root cause: `j`/`k` phase navigation typed into the prompt, `Esc`
// unmounting the panel before its collapse was ever visible, and — the
// safety-relevant one — `n` answered at a `[Y/n]` approval ALSO landing in the
// command box, one Enter away from being submitted as a command.
//
// The fix is a single explicit notion of which surface owns the keyboard.

const APP_SOURCE = readFileSync(new URL('../../src/ui/App.tsx', import.meta.url), 'utf8');

const PROMPT_GLYPH = '❯';

function commandLine(frame: string | undefined): string {
  return (frame ?? '').split('\n').find((l) => l.includes(PROMPT_GLYPH)) ?? '';
}

describe('resolveKeyboardOwner (19.3-06 item A)', () => {
  const base = {
    showStatusOverlay: false,
    showEntityOverlay: false,
    activePanel: 'center' as const,
    sessionActive: false,
  };

  it('gives the keyboard to the command input when nothing else claims it', () => {
    expect(resolveKeyboardOwner(base)).toBe('command-input');
  });

  it('gives the keyboard to the live DPEV panel during a session', () => {
    expect(resolveKeyboardOwner({ ...base, sessionActive: true })).toBe('dpev-panel');
  });

  it('lets the status overlay outrank everything, including a live session', () => {
    expect(
      resolveKeyboardOwner({ ...base, sessionActive: true, showStatusOverlay: true }),
    ).toBe('status-overlay');
  });

  it('lets the entity overlay outrank the panels but not the status overlay', () => {
    expect(resolveKeyboardOwner({ ...base, showEntityOverlay: true })).toBe('entity-overlay');
    expect(
      resolveKeyboardOwner({ ...base, showEntityOverlay: true, showStatusOverlay: true }),
    ).toBe('status-overlay');
  });

  it('hands the keyboard to whichever side panel Tab focused', () => {
    expect(resolveKeyboardOwner({ ...base, activePanel: 'left' })).toBe('session-panel');
    expect(resolveKeyboardOwner({ ...base, activePanel: 'right' })).toBe('entity-panel');
  });

  it('keeps a focused side panel in charge even during a live session', () => {
    expect(
      resolveKeyboardOwner({ ...base, activePanel: 'left', sessionActive: true }),
    ).toBe('session-panel');
  });

  it('never returns command-input while a session or overlay is up', () => {
    const claimed = [
      { ...base, sessionActive: true },
      { ...base, showStatusOverlay: true },
      { ...base, showEntityOverlay: true },
      { ...base, activePanel: 'left' as const },
      { ...base, activePanel: 'right' as const },
    ];
    for (const ctx of claimed) {
      expect(resolveKeyboardOwner(ctx)).not.toBe('command-input');
    }
  });
});

describe('resolveEscapeAction (19.3-06 item A)', () => {
  const base = {
    showStatusOverlay: false,
    showEntityOverlay: false,
    activePanel: 'center' as const,
    sessionActive: false,
    replayActive: false,
    collapsibleFocusedPhase: false,
  };

  it('does nothing when there is nothing to dismiss', () => {
    expect(resolveEscapeAction(base)).toBe('none');
  });

  it('dismisses the status overlay first', () => {
    expect(
      resolveEscapeAction({ ...base, showStatusOverlay: true, sessionActive: true, replayActive: true }),
    ).toBe('dismiss-status-overlay');
  });

  it('dismisses the entity overlay before touching the session', () => {
    expect(
      resolveEscapeAction({ ...base, showEntityOverlay: true, sessionActive: true }),
    ).toBe('dismiss-entity-overlay');
  });

  it('exits replay mode', () => {
    expect(resolveEscapeAction({ ...base, replayActive: true })).toBe('exit-replay');
  });

  it('exits a live session when no phase body is open', () => {
    expect(resolveEscapeAction({ ...base, sessionActive: true })).toBe('exit-session');
  });

  it('yields to the panel collapse when the focused phase is expanded', () => {
    // The panel's own Esc handler fires on this same keystroke; exiting too would
    // unmount the panel before the collapse could ever be seen.
    expect(
      resolveEscapeAction({ ...base, sessionActive: true, collapsibleFocusedPhase: true }),
    ).toBe('collapse-phase');
  });

  it('exits the session anyway when a side panel owns the keyboard', () => {
    // With focus on the sessions list the DPEV panel's handler is inactive, so
    // deferring to a collapse that will never happen would make Esc a dead key.
    expect(
      resolveEscapeAction({
        ...base,
        sessionActive: true,
        collapsibleFocusedPhase: true,
        activePanel: 'left',
      }),
    ).toBe('exit-session');
  });
});

describe('App keyboard arbitration (19.3-06 item A)', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/stream/debug')) {
        // No SSE backend in tests: useSSE records an error and the panel still mounts.
        return Promise.resolve({ ok: false, status: 503, statusText: 'unavailable' });
      }
      if (url.includes('/health')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ backends: [], summary: 'all_connected', inferenceMode: 'sequential' }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({ sessions: [], count: 0, entries: [] }) });
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  async function startSession(stdin: { write: (s: string) => void }): Promise<void> {
    stdin.write('debug "nginx 502"');
    await new Promise((r) => setTimeout(r, 50));
    stdin.write('\r');
    await new Promise((r) => setTimeout(r, 100));
  }

  it('types a printable key into the command box while it owns the keyboard (control)', async () => {
    const { lastFrame, stdin } = render(
      React.createElement(App, { apiBaseUrl: 'http://localhost:3000' }),
    );
    stdin.write('n');
    await new Promise((r) => setTimeout(r, 100));

    expect(commandLine(lastFrame())).toMatch(new RegExp(`${PROMPT_GLYPH}\\s*n`));
  });

  it('does not leak an approval keystroke into the command box during a live session', async () => {
    const { lastFrame, stdin } = render(
      React.createElement(App, { apiBaseUrl: 'http://localhost:3000' }),
    );
    await startSession(stdin);
    expect(lastFrame()).toContain('nginx 502');

    // The safety case: `n` answering a WRITE approval must not also be typed as a
    // command — a following Enter would have submitted it.
    stdin.write('n');
    await new Promise((r) => setTimeout(r, 100));

    expect(commandLine(lastFrame())).not.toMatch(new RegExp(`${PROMPT_GLYPH}\\s*n`));
  });

  it('does not leak j/k phase navigation into the command box during a live session', async () => {
    const { lastFrame, stdin } = render(
      React.createElement(App, { apiBaseUrl: 'http://localhost:3000' }),
    );
    await startSession(stdin);

    stdin.write('j');
    await new Promise((r) => setTimeout(r, 30));
    stdin.write('k');
    await new Promise((r) => setTimeout(r, 100));

    const line = commandLine(lastFrame());
    expect(line).not.toMatch(new RegExp(`${PROMPT_GLYPH}\\s*j`));
    expect(line).not.toContain('jk');
  });

  it('still opens the status overlay with s during a live session', async () => {
    const { lastFrame, stdin } = render(
      React.createElement(App, { apiBaseUrl: 'http://localhost:3000' }),
    );
    await startSession(stdin);
    expect(lastFrame()).not.toContain('STATUS DASHBOARD');

    stdin.write('s');
    await new Promise((r) => setTimeout(r, 100));

    expect(lastFrame()).toContain('STATUS DASHBOARD');
  });

  it('exits the live session on Esc and returns the keyboard to the command box', async () => {
    const { lastFrame, stdin } = render(
      React.createElement(App, { apiBaseUrl: 'http://localhost:3000' }),
    );
    await startSession(stdin);
    expect(lastFrame()).toContain('nginx 502');

    stdin.write('\x1B');
    await new Promise((r) => setTimeout(r, 100));
    expect(lastFrame()).toContain('InfraBrain v1.3');

    stdin.write('n');
    await new Promise((r) => setTimeout(r, 100));
    expect(commandLine(lastFrame())).toMatch(new RegExp(`${PROMPT_GLYPH}\\s*n`));
  });

  it('threads exactly one keyboard owner into every input consumer', () => {
    // CommandInput was the sole input consumer without an ownership gate.
    expect(APP_SOURCE).toMatch(/isActive=\{keyboardOwner === 'command-input'\}/);
    expect(APP_SOURCE).toMatch(/activeFocus=\{keyboardOwner === 'session-panel'\}/);
    expect(APP_SOURCE).toMatch(/activeFocus=\{keyboardOwner === 'entity-panel'\}/);
    expect(APP_SOURCE).toMatch(/activeFocus=\{keyboardOwner === 'entity-overlay'\}/);
    expect(APP_SOURCE).toMatch(/activeFocus=\{keyboardOwner === 'dpev-panel'\}/);
    // The old ad hoc booleans are gone.
    expect(APP_SOURCE).not.toContain('isActive={!showStatusOverlay}');
    expect(APP_SOURCE).not.toContain("activePanel === 'left' && !showStatusOverlay");
  });
});

// ---- Plan 19.3-06 item B: close Plan 05's sessionTokens seam ----

describe('App wires live session tokens into StatusOverlay (19.3-06 item B)', () => {
  it('passes the DPEV sessionSummary token count to the overlay', () => {
    expect(APP_SOURCE).toMatch(/sessionTokens=\{dpevStatus\.sessionTokens\}/);
  });

  it('receives the token count from the panel rather than re-deriving it', () => {
    expect(APP_SOURCE).toMatch(/onStatusChange=\{handleDpevStatus\}/);
  });
});
