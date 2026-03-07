import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock approval module
vi.mock('../../src/cli/approval.js', async (importOriginal) => {
  const original = await importOriginal() as any;
  return {
    ...original,
    requestApproval: vi.fn(),
  };
});

import { registerCommands } from '../../src/cli/commands.js';
import { requestApproval } from '../../src/cli/approval.js';
import type { ApprovalResult } from '../../src/cli/approval.js';
import { RiskLevel } from '../../src/safety/types.js';

describe('registerCommands', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    globalThis.fetch = originalFetch;
  });

  it('creates a program with debug and health commands', () => {
    const program = registerCommands({ apiBaseUrl: 'http://localhost:3000' });
    const commandNames = program.commands.map((c) => c.name());
    expect(commandNames).toContain('debug');
    expect(commandNames).toContain('health');
  });

  it('debug command sends POST to /debug with prompt', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        sessionId: 'test-session',
        diagnosis: 'Port 80 is in use by nginx.',
        commands: [
          { command: 'lsof -i :80', riskLevel: 'read', allowed: true },
        ],
      }),
    });
    globalThis.fetch = mockFetch;

    const program = registerCommands({ apiBaseUrl: 'http://localhost:3000' });
    // Commander exitOverride prevents process.exit
    program.exitOverride();

    await program.parseAsync(['debug', 'What is using port 80?'], { from: 'user' });

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3000/debug',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'What is using port 80?' }),
      }),
    );
  });

  it('health command sends GET to /health', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'ok',
        ollama: 'connected',
        models: [{ name: 'llama3.3:70b' }],
      }),
    });
    globalThis.fetch = mockFetch;

    const program = registerCommands({ apiBaseUrl: 'http://localhost:3000' });
    program.exitOverride();

    await program.parseAsync(['health'], { from: 'user' });

    expect(mockFetch).toHaveBeenCalledWith('http://localhost:3000/health');
  });

  it('debug command displays error message on API failure', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'prompt is required' }),
    });
    globalThis.fetch = mockFetch;

    const program = registerCommands({ apiBaseUrl: 'http://localhost:3000' });
    program.exitOverride();

    await program.parseAsync(['debug', 'test'], { from: 'user' });

    // Should have logged an error message
    const logCalls = consoleSpy.mock.calls.flat().join(' ');
    expect(logCalls).toContain('prompt is required');
  });

  it('health command shows disconnected status when Ollama is down', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'ok',
        ollama: 'disconnected',
        error: 'Ollama not detected at http://localhost:11434. Run `ollama serve` first.',
      }),
    });
    globalThis.fetch = mockFetch;

    const program = registerCommands({ apiBaseUrl: 'http://localhost:3000' });
    program.exitOverride();

    await program.parseAsync(['health'], { from: 'user' });

    const logCalls = consoleSpy.mock.calls.flat().join(' ');
    expect(logCalls).toContain('Ollama not detected');
  });

  it('debug command handles network errors gracefully', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

    const program = registerCommands({ apiBaseUrl: 'http://localhost:3000' });
    program.exitOverride();

    await program.parseAsync(['debug', 'test'], { from: 'user' });

    const logCalls = consoleSpy.mock.calls.flat().join(' ');
    expect(logCalls).toContain('Failed to connect to API');
  });

  describe('approval gate wiring', () => {
    const mockRl = {
      question: vi.fn(),
      close: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
    } as any;

    it('debug command calls requestApproval for each allowed command', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          sessionId: 'test-session',
          diagnosis: 'Port 80 is in use.',
          commands: [
            { command: 'lsof -i :80', riskLevel: 'read', allowed: true },
            { command: 'kill -9 1234', riskLevel: 'write', allowed: true },
          ],
        }),
      });
      globalThis.fetch = mockFetch;

      vi.mocked(requestApproval).mockResolvedValue({
        approved: true,
        approvalType: 'auto',
        command: 'lsof -i :80',
        riskLevel: RiskLevel.READ,
      });

      const program = registerCommands({ apiBaseUrl: 'http://localhost:3000', rl: mockRl });
      program.exitOverride();

      await program.parseAsync(['debug', 'What is using port 80?'], { from: 'user' });

      expect(requestApproval).toHaveBeenCalledTimes(2);
      expect(requestApproval).toHaveBeenCalledWith('lsof -i :80', 'read', mockRl);
      expect(requestApproval).toHaveBeenCalledWith('kill -9 1234', 'write', mockRl);
    });

    it('debug command displays formatApprovalResult after approval', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          sessionId: 'test-session',
          diagnosis: 'Check disk.',
          commands: [
            { command: 'df -h', riskLevel: 'read', allowed: true },
          ],
        }),
      });
      globalThis.fetch = mockFetch;

      vi.mocked(requestApproval).mockResolvedValue({
        approved: true,
        approvalType: 'auto',
        command: 'df -h',
        riskLevel: RiskLevel.READ,
      });

      const program = registerCommands({ apiBaseUrl: 'http://localhost:3000', rl: mockRl });
      program.exitOverride();

      await program.parseAsync(['debug', 'check disk'], { from: 'user' });

      // formatApprovalResult should have been called and its output logged
      const logCalls = consoleSpy.mock.calls.flat().join(' ');
      expect(logCalls).toContain('Approved');
    });

    it('blocked commands are displayed but NOT sent to requestApproval', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          sessionId: 'test-session',
          diagnosis: 'Dangerous.',
          commands: [
            { command: 'rm -rf /', riskLevel: 'blocked', allowed: false, reason: 'Blocked pattern' },
          ],
        }),
      });
      globalThis.fetch = mockFetch;

      const program = registerCommands({ apiBaseUrl: 'http://localhost:3000', rl: mockRl });
      program.exitOverride();

      await program.parseAsync(['debug', 'test blocked'], { from: 'user' });

      expect(requestApproval).not.toHaveBeenCalled();
    });

    it('rejected commands display rejection result', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          sessionId: 'test-session',
          diagnosis: 'Restart service.',
          commands: [
            { command: 'systemctl restart nginx', riskLevel: 'write', allowed: true },
          ],
        }),
      });
      globalThis.fetch = mockFetch;

      vi.mocked(requestApproval).mockResolvedValue({
        approved: false,
        approvalType: 'y_n',
        command: 'systemctl restart nginx',
        riskLevel: RiskLevel.WRITE,
      });

      const program = registerCommands({ apiBaseUrl: 'http://localhost:3000', rl: mockRl });
      program.exitOverride();

      await program.parseAsync(['debug', 'restart nginx'], { from: 'user' });

      const logCalls = consoleSpy.mock.calls.flat().join(' ');
      expect(logCalls).toContain('Rejected');
    });
  });
});
