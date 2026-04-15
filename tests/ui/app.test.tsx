/**
 * Tests for App.tsx root component and StatusOverlay
 *
 * Tests pure functions and component rendering via ink-testing-library.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'ink-testing-library';
import { App, parseInfraCommand } from '../../src/ui/App.js';
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
    expect(frame).toContain('Compression Efficiency');
    expect(frame).toContain('Caveman/Perc integration: v2.0');
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
