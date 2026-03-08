import { describe, it, expect } from 'vitest';
import { formatStatusDashboard } from '../../src/cli/formatter.js';
import chalk from 'chalk';

// Disable chalk colors in tests for predictable assertions
chalk.level = 0;

describe('formatStatusDashboard', () => {
  it('shows Connected when Ollama is connected', () => {
    const data = {
      ollama: { connected: true, modelName: 'llama3.3:70b', responseTimeMs: 42 },
      activePlans: [],
      recentSessions: [],
      locks: [],
    };

    const output = formatStatusDashboard(data);
    expect(output).toContain('Connected');
    expect(output).toContain('llama3.3:70b');
    expect(output).toContain('42ms');
  });

  it('shows Disconnected when Ollama is not connected', () => {
    const data = {
      ollama: { connected: false, error: 'Connection refused' },
      activePlans: [],
      recentSessions: [],
      locks: [],
    };

    const output = formatStatusDashboard(data);
    expect(output).toContain('Disconnected');
    expect(output).toContain('Connection refused');
  });

  it('shows active plans with progress', () => {
    const data = {
      ollama: { connected: true, modelName: 'llama3.3:70b', responseTimeMs: 10 },
      activePlans: [{
        sessionId: 'abc-123',
        status: 'active',
        currentPlan: {
          id: 'plan-1',
          description: 'Fix nginx config',
          currentStep: 2,
          steps: [{}, {}, {}, {}, {}],
          status: 'in_progress',
        },
      }],
      recentSessions: [],
      locks: [],
    };

    const output = formatStatusDashboard(data);
    expect(output).toContain('Fix nginx config');
    expect(output).toContain('2/5');
  });

  it('shows recent sessions', () => {
    const data = {
      ollama: { connected: true, modelName: 'llama3.3:70b', responseTimeMs: 10 },
      activePlans: [],
      recentSessions: [{
        sessionId: 'sess-1',
        status: 'completed',
        updatedAt: '2026-03-08T10:00:00Z',
        createdAt: '2026-03-08T09:00:00Z',
      }],
      locks: [],
    };

    const output = formatStatusDashboard(data);
    expect(output).toContain('sess-1');
    expect(output).toContain('completed');
  });

  it('hides locks section when no locks present', () => {
    const data = {
      ollama: { connected: true, modelName: 'llama3.3:70b', responseTimeMs: 10 },
      activePlans: [],
      recentSessions: [],
      locks: [],
    };

    const output = formatStatusDashboard(data);
    expect(output).not.toContain('Locks');
  });

  it('shows locks section when locks are present', () => {
    const data = {
      ollama: { connected: true, modelName: 'llama3.3:70b', responseTimeMs: 10 },
      activePlans: [],
      recentSessions: [],
      locks: [{
        target: 'nginx',
        sessionId: 'sess-2',
        adminName: 'admin1',
        createdAt: new Date(Date.now() - 60000).toISOString(),
        pid: 1234,
        planSummary: 'Fix config',
      }],
    };

    const output = formatStatusDashboard(data);
    expect(output).toContain('Locks');
    expect(output).toContain('nginx');
    expect(output).toContain('admin1');
  });
});
