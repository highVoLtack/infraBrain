import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import { captureSnapshot, SNAPSHOT_COMMANDS, getSnapshotCommand } from '../../src/execution/snapshot.js';
import type { FixStep } from '../../src/orchestrator/types.js';
import type { RunResult } from '../../src/execution/types.js';

vi.mock('node:fs');

describe('SNAPSHOT_COMMANDS', () => {
  it('is a non-empty record of command prefix mappings', () => {
    expect(Object.keys(SNAPSHOT_COMMANDS).length).toBeGreaterThan(0);
  });
});

describe('getSnapshotCommand', () => {
  it('maps "docker stop nginx" to "docker inspect nginx"', () => {
    expect(getSnapshotCommand('docker stop nginx')).toBe('docker inspect nginx');
  });

  it('maps "docker rm mycontainer" to "docker inspect mycontainer"', () => {
    expect(getSnapshotCommand('docker rm mycontainer')).toBe('docker inspect mycontainer');
  });

  it('maps "docker restart web" to "docker inspect web"', () => {
    expect(getSnapshotCommand('docker restart web')).toBe('docker inspect web');
  });

  it('maps "systemctl restart sshd" to "systemctl show sshd"', () => {
    expect(getSnapshotCommand('systemctl restart sshd')).toBe('systemctl show sshd');
  });

  it('maps "systemctl stop nginx" to "systemctl show nginx"', () => {
    expect(getSnapshotCommand('systemctl stop nginx')).toBe('systemctl show nginx');
  });

  it('maps "cp /etc/nginx/nginx.conf /tmp/backup" to "cat /etc/nginx/nginx.conf"', () => {
    expect(getSnapshotCommand('cp /etc/nginx/nginx.conf /tmp/backup')).toBe('cat /etc/nginx/nginx.conf');
  });

  it('maps "mv /tmp/old /tmp/new" to "cat /tmp/old"', () => {
    expect(getSnapshotCommand('mv /tmp/old /tmp/new')).toBe('cat /tmp/old');
  });

  it('maps "tee /etc/hosts" to "cat /etc/hosts"', () => {
    expect(getSnapshotCommand('tee /etc/hosts')).toBe('cat /etc/hosts');
  });

  it('maps "docker network connect frontend backend" to "docker network inspect frontend"', () => {
    expect(getSnapshotCommand('docker network connect frontend backend')).toBe('docker network inspect frontend');
  });

  it('maps "docker network disconnect frontend backend" to "docker network inspect frontend"', () => {
    expect(getSnapshotCommand('docker network disconnect frontend backend')).toBe('docker network inspect frontend');
  });

  it('returns null for unknown WRITE command', () => {
    expect(getSnapshotCommand('some-unknown-tool --flag')).toBeNull();
  });
});

describe('captureSnapshot', () => {
  const mockRunner = {
    run: vi.fn<() => Promise<RunResult>>(),
  };

  beforeEach(() => {
    vi.resetAllMocks();
    mockRunner.run.mockResolvedValue({ stdout: 'snapshot output', stderr: '', exitCode: 0 });
    vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
    vi.mocked(fs.writeFileSync).mockReturnValue(undefined);
  });

  it('returns null for READ step (no snapshot needed)', async () => {
    const step: FixStep = { command: 'cat /etc/hosts', description: 'read hosts', rollback: '', risk: 'read' };
    const result = await captureSnapshot(step, mockRunner, '/tmp/session', 0);
    expect(result).toBeNull();
    expect(mockRunner.run).not.toHaveBeenCalled();
  });

  it('returns null for unknown command prefix', async () => {
    const step: FixStep = { command: 'some-unknown-tool --flag', description: 'unknown', rollback: '', risk: 'write' };
    const result = await captureSnapshot(step, mockRunner, '/tmp/session', 0);
    expect(result).toBeNull();
    expect(mockRunner.run).not.toHaveBeenCalled();
  });

  it('captures snapshot for docker stop command', async () => {
    const step: FixStep = { command: 'docker stop nginx', description: 'stop nginx', rollback: 'docker start nginx', risk: 'destructive' };
    const result = await captureSnapshot(step, mockRunner, '/tmp/session', 2);

    expect(result).not.toBeNull();
    expect(result!.stepIndex).toBe(2);
    expect(result!.command).toBe('docker stop nginx');
    expect(result!.snapshotCommand).toBe('docker inspect nginx');
    expect(result!.output).toBe('snapshot output');
    expect(result!.capturedAt).toBeDefined();
  });

  it('runs the correct snapshot command via runner', async () => {
    const step: FixStep = { command: 'systemctl restart sshd', description: 'restart sshd', rollback: 'systemctl restart sshd', risk: 'write' };
    await captureSnapshot(step, mockRunner, '/tmp/session', 1);

    expect(mockRunner.run).toHaveBeenCalledWith(
      'systemctl',
      ['show', 'sshd'],
      expect.objectContaining({ timeout: expect.any(Number) }),
    );
  });

  it('creates snapshots/ directory and writes JSON file', async () => {
    const step: FixStep = { command: 'docker stop nginx', description: 'stop', rollback: 'docker start nginx', risk: 'destructive' };
    await captureSnapshot(step, mockRunner, '/tmp/session', 3);

    expect(fs.mkdirSync).toHaveBeenCalledWith('/tmp/session/snapshots', { recursive: true });
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      '/tmp/session/snapshots/step-3.json',
      expect.any(String),
    );

    // Verify JSON content
    const writtenJson = JSON.parse(vi.mocked(fs.writeFileSync).mock.calls[0][1] as string);
    expect(writtenJson.stepIndex).toBe(3);
    expect(writtenJson.snapshotCommand).toBe('docker inspect nginx');
  });
});
