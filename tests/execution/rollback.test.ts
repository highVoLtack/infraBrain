import { describe, it, expect, vi, beforeEach } from 'vitest';
import { rollbackStep } from '../../src/execution/rollback.js';
import type { FixStep } from '../../src/orchestrator/types.js';
import type { RunResult, SnapshotRecord } from '../../src/execution/types.js';

describe('rollbackStep', () => {
  const mockRunner = {
    run: vi.fn<() => Promise<RunResult>>(),
  };

  const mockAuditLogger = {
    logExecution: vi.fn(),
  };

  const mockConfig = {
    execution: { commandTimeoutMs: 30000, maxBufferBytes: 1024 * 1024 },
  };

  const step: FixStep = {
    command: 'docker stop nginx',
    description: 'stop nginx container',
    rollback: 'docker start nginx',
    risk: 'destructive',
  };

  const snapshot: SnapshotRecord = {
    stepIndex: 0,
    command: 'docker stop nginx',
    snapshotCommand: 'docker inspect nginx',
    output: '{"State": "running"}',
    capturedAt: '2026-03-08T00:00:00Z',
  };

  beforeEach(() => {
    vi.resetAllMocks();
    mockRunner.run.mockResolvedValue({ stdout: 'ok', stderr: '', exitCode: 0 });
  });

  it('executes the rollback command via runner', async () => {
    await rollbackStep(step, snapshot, { runner: mockRunner, auditLogger: mockAuditLogger, config: mockConfig });

    expect(mockRunner.run).toHaveBeenCalledWith(
      'docker',
      ['start', 'nginx'],
      expect.objectContaining({ timeout: 30000 }),
    );
  });

  it('is auto-approved (no approval gate call)', async () => {
    // rollbackStep does not take or use an approval function
    const result = await rollbackStep(step, snapshot, { runner: mockRunner, auditLogger: mockAuditLogger, config: mockConfig });
    expect(result.success).toBe(true);
    // Only runner and audit logger should be called, no approval
  });

  it('logs rollback_start and rollback_complete audit events', async () => {
    await rollbackStep(step, snapshot, { runner: mockRunner, auditLogger: mockAuditLogger, config: mockConfig });

    expect(mockAuditLogger.logExecution).toHaveBeenCalledWith('rollback_start', expect.objectContaining({
      command: 'docker start nginx',
    }));
    expect(mockAuditLogger.logExecution).toHaveBeenCalledWith('rollback_complete', expect.objectContaining({
      command: 'docker start nginx',
    }));
  });

  it('logs rollback_failed as CRITICAL when rollback command fails', async () => {
    mockRunner.run.mockResolvedValue({ stdout: '', stderr: 'error starting', exitCode: 1 });

    const result = await rollbackStep(step, snapshot, { runner: mockRunner, auditLogger: mockAuditLogger, config: mockConfig });

    expect(result.success).toBe(false);
    expect(result.error).toContain('error starting');
    expect(mockAuditLogger.logExecution).toHaveBeenCalledWith('rollback_failed', expect.objectContaining({
      severity: 'CRITICAL',
      command: 'docker start nginx',
    }));
  });

  it('does NOT retry on rollback failure', async () => {
    mockRunner.run.mockResolvedValue({ stdout: '', stderr: 'fail', exitCode: 1 });

    await rollbackStep(step, snapshot, { runner: mockRunner, auditLogger: mockAuditLogger, config: mockConfig });

    // Runner should only be called once (no retries)
    expect(mockRunner.run).toHaveBeenCalledTimes(1);
  });

  it('returns success status on successful rollback', async () => {
    const result = await rollbackStep(step, snapshot, { runner: mockRunner, auditLogger: mockAuditLogger, config: mockConfig });
    expect(result).toEqual({ success: true });
  });

  it('handles undefined snapshot gracefully', async () => {
    const result = await rollbackStep(step, undefined, { runner: mockRunner, auditLogger: mockAuditLogger, config: mockConfig });
    expect(result.success).toBe(true);
    expect(mockRunner.run).toHaveBeenCalled();
  });
});
