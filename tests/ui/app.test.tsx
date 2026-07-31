/**
 * Tests for App.tsx root component and StatusOverlay
 *
 * Tests pure functions and component rendering via ink-testing-library.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'ink-testing-library';
import { App, parseInfraCommand, buildReplayState } from '../../src/ui/App.js';
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
