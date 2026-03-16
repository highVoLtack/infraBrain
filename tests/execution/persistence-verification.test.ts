import { describe, it, expect, vi } from 'vitest';
import {
  isConfigModification,
  isRestartStep,
  verifyPersistence,
  type ConfigModificationRecord,
  type PersistenceVerificationResult,
} from '../../src/execution/persistence-verification.js';
import type { SelfHealContext } from '../../src/execution/types.js';

// Mock self-healer's verifyEffect
vi.mock('../../src/execution/self-healer.js', () => ({
  verifyEffect: vi.fn(),
}));

import { verifyEffect } from '../../src/execution/self-healer.js';

describe('isConfigModification', () => {
  it('detects sed -i (in-place edit)', () => {
    expect(isConfigModification("sed -i 's/bind 127.0.0.1/bind 0.0.0.0/' /etc/redis.conf")).toBe(true);
  });

  it('detects sed without -i (stdout write)', () => {
    expect(isConfigModification("sed 's/bind 127.0.0.1/bind 0.0.0.0/' /etc/redis.conf")).toBe(true);
  });

  it('detects tee to config file', () => {
    expect(isConfigModification('tee /etc/redis.conf')).toBe(true);
  });

  it('detects echo redirect to config file', () => {
    expect(isConfigModification("echo 'bind 0.0.0.0' > /etc/redis.conf")).toBe(true);
  });

  it('detects CONFIG SET (case-insensitive)', () => {
    expect(isConfigModification('CONFIG SET bind 0.0.0.0')).toBe(true);
    expect(isConfigModification('config set maxmemory 100mb')).toBe(true);
  });

  it('detects ALTER SYSTEM SET', () => {
    expect(isConfigModification('ALTER SYSTEM SET max_connections = 200')).toBe(true);
    expect(isConfigModification('alter system set work_mem = 256MB')).toBe(true);
  });

  it('returns false for read-only commands', () => {
    expect(isConfigModification('docker exec redis-1 cat /etc/redis.conf')).toBe(false);
    expect(isConfigModification('ls -la /app/data')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isConfigModification('')).toBe(false);
  });
});

describe('isRestartStep', () => {
  it('detects docker restart', () => {
    expect(isRestartStep('docker restart redis-1')).toBe(true);
  });

  it('detects docker compose restart', () => {
    expect(isRestartStep('docker compose restart')).toBe(true);
  });

  it('detects systemctl reload', () => {
    expect(isRestartStep('systemctl reload nginx')).toBe(true);
  });

  it('detects systemctl restart', () => {
    expect(isRestartStep('systemctl restart postgresql')).toBe(true);
  });

  it('returns false for non-restart commands', () => {
    expect(isRestartStep('docker exec redis-1 cat /etc/redis.conf')).toBe(false);
    expect(isRestartStep('docker logs redis-1')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isRestartStep('')).toBe(false);
  });
});

describe('ConfigModificationRecord', () => {
  it('stores stepIndex, command, stepDescription', () => {
    const record: ConfigModificationRecord = {
      stepIndex: 2,
      command: "sed -i 's/bind 127/bind 0/' /etc/redis.conf",
      stepDescription: 'Update Redis bind address',
    };
    expect(record.stepIndex).toBe(2);
    expect(record.command).toContain('sed');
    expect(record.stepDescription).toBe('Update Redis bind address');
  });
});

describe('verifyPersistence', () => {
  const mockHealContext = {
    maxAttempts: 5,
    stepDescription: 'test step',
    stepRisk: 'write' as const,
  } as unknown as SelfHealContext;

  it('calls verifyEffect for each config modification after delay', async () => {
    const mocked = vi.mocked(verifyEffect);
    mocked.mockResolvedValue({ verified: true, evidence: 'bind 0.0.0.0' });

    const configMods: ConfigModificationRecord[] = [
      { stepIndex: 1, command: "sed -i 's/bind 127/bind 0/' /etc/redis.conf", stepDescription: 'Update bind' },
      { stepIndex: 3, command: 'CONFIG SET maxmemory 100mb', stepDescription: 'Set maxmemory' },
    ];

    const results = await verifyPersistence(configMods, mockHealContext, 0); // 0ms delay for tests

    expect(mocked).toHaveBeenCalledTimes(2);
    expect(results).toHaveLength(2);
    expect(results[0].verified).toBe(true);
    expect(results[0].reverted).toBe(false);
    expect(results[1].verified).toBe(true);
    expect(results[1].reverted).toBe(false);
  });

  it('marks reverted=true when verifyEffect returns verified=false', async () => {
    const mocked = vi.mocked(verifyEffect);
    mocked.mockResolvedValue({ verified: false, reason: 'config value reverted' });

    const configMods: ConfigModificationRecord[] = [
      { stepIndex: 2, command: "sed 's/bind 127/bind 0/' /etc/redis.conf", stepDescription: 'Update bind' },
    ];

    const results = await verifyPersistence(configMods, mockHealContext, 0);

    expect(results).toHaveLength(1);
    expect(results[0].verified).toBe(false);
    expect(results[0].reverted).toBe(true);
  });

  it('marks verified=true, reverted=false when verifyEffect skips (fail-open)', async () => {
    const mocked = vi.mocked(verifyEffect);
    mocked.mockResolvedValue({ verified: true, skipped: true });

    const configMods: ConfigModificationRecord[] = [
      { stepIndex: 0, command: 'CONFIG SET bind 0.0.0.0', stepDescription: 'Set bind' },
    ];

    const results = await verifyPersistence(configMods, mockHealContext, 0);

    expect(results).toHaveLength(1);
    expect(results[0].verified).toBe(true);
    expect(results[0].reverted).toBe(false);
  });

  it('returns empty array for empty config mods', async () => {
    const results = await verifyPersistence([], mockHealContext, 0);
    expect(results).toHaveLength(0);
  });

  it('includes configMod reference in each result', async () => {
    const mocked = vi.mocked(verifyEffect);
    mocked.mockResolvedValue({ verified: true });

    const configMods: ConfigModificationRecord[] = [
      { stepIndex: 5, command: 'tee /etc/nginx.conf', stepDescription: 'Write nginx config' },
    ];

    const results = await verifyPersistence(configMods, mockHealContext, 0);

    expect(results[0].configMod).toEqual(configMods[0]);
  });
});
