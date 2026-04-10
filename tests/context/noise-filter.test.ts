import { describe, it, expect, vi } from 'vitest';
import { filterNoise, NOISE_PATTERNS } from '../../src/context/noise-filter.js';

// Mock the ai SDK generateObject
vi.mock('ai', () => ({
  generateObject: vi.fn(),
}));

import { generateObject } from 'ai';

const mockedGenerateObject = vi.mocked(generateObject);

describe('NOISE_PATTERNS', () => {
  it('exports an array of RegExp patterns', () => {
    expect(Array.isArray(NOISE_PATTERNS)).toBe(true);
    expect(NOISE_PATTERNS.length).toBeGreaterThan(0);
    for (const p of NOISE_PATTERNS) {
      expect(p).toBeInstanceOf(RegExp);
    }
  });
});

describe('filterNoise', () => {
  describe('healthcheck spam removal', () => {
    it('removes lines with health_status: healthy', async () => {
      const raw = { logs: 'health_status: healthy\nimportant error message' };
      const result = await filterNoise(raw);
      expect(result.filtered.logs).toBe('important error message');
      expect(result.removedCount).toBe(1);
    });

    it('removes lines with healthcheck passed/failed', async () => {
      const raw = { check: 'healthcheck for nginx passed\nactual log line\nhealthcheck failed for redis' };
      const result = await filterNoise(raw);
      expect(result.filtered.check).toBe('actual log line');
      expect(result.removedCount).toBe(2);
    });
  });

  describe('systemd boilerplate removal', () => {
    it('removes Started/Stopped service lines', async () => {
      const raw = { svc: 'Started nginx.service\nError: connection refused\nStopped redis.service' };
      const result = await filterNoise(raw);
      expect(result.filtered.svc).toBe('Error: connection refused');
      expect(result.removedCount).toBe(2);
    });

    it('removes systemd Starting and Reached target lines', async () => {
      const raw = {
        journal: 'systemd[1]: Starting Docker Application Container Engine...\nContainer crashed\nsystemd[1]: Reached target Multi-User System.',
      };
      const result = await filterNoise(raw);
      expect(result.filtered.journal).toBe('Container crashed');
      expect(result.removedCount).toBe(2);
    });
  });

  describe('journal metadata removal', () => {
    it('removes journal begin/end/rotate lines', async () => {
      const raw = {
        logs: '-- Logs begin at Mon 2025-01-01 --\nOOM killed process\n-- No entries --\n-- Journal has been rotated --',
      };
      const result = await filterNoise(raw);
      expect(result.filtered.logs).toBe('OOM killed process');
      expect(result.removedCount).toBe(3);
    });
  });

  describe('empty/whitespace line removal', () => {
    it('removes empty and whitespace-only lines', async () => {
      const raw = { out: 'line 1\n\n   \nline 2\n\t\n' };
      const result = await filterNoise(raw);
      expect(result.filtered.out).toBe('line 1\nline 2');
      expect(result.removedCount).toBeGreaterThanOrEqual(3);
    });
  });

  describe('skill-declared noise patterns', () => {
    it('applies additional skill patterns from string[]', async () => {
      const raw = { logs: 'DEBUG: heartbeat ok\nERROR: disk full\nDEBUG: heartbeat ok' };
      const result = await filterNoise(raw, ['DEBUG:\\s+heartbeat']);
      expect(result.filtered.logs).toBe('ERROR: disk full');
      expect(result.removedCount).toBe(2);
    });
  });

  describe('worker model threshold', () => {
    it('does NOT invoke worker model when unrecognized lines < 10', async () => {
      const lines = Array.from({ length: 9 }, (_, i) => `unknown line ${i}`).join('\n');
      const raw = { cmd: lines };
      const mockModel = {} as any;

      const result = await filterNoise(raw, [], mockModel);
      expect(result.workerModelUsed).toBe(false);
      expect(mockedGenerateObject).not.toHaveBeenCalled();
      // All 9 unrecognized lines should be kept
      expect(result.filtered.cmd!.split('\n').length).toBe(9);
    });

    it('invokes worker model when unrecognized lines >= 10', async () => {
      const lines = Array.from({ length: 12 }, (_, i) => `unknown line ${i}`);
      const raw = { cmd: lines.join('\n') };
      const mockModel = {} as any;

      // Worker model returns only some lines as relevant
      mockedGenerateObject.mockResolvedValueOnce({
        object: { relevant: ['unknown line 0', 'unknown line 5', 'unknown line 11'] },
      } as any);

      const result = await filterNoise(raw, [], mockModel);
      expect(result.workerModelUsed).toBe(true);
      expect(mockedGenerateObject).toHaveBeenCalledOnce();
      expect(result.filtered.cmd!.split('\n').length).toBe(3);
    });

    it('includes all unrecognized lines when no workerModel provided', async () => {
      const lines = Array.from({ length: 15 }, (_, i) => `unknown line ${i}`).join('\n');
      const raw = { cmd: lines };

      const result = await filterNoise(raw);
      expect(result.workerModelUsed).toBe(false);
      expect(result.filtered.cmd!.split('\n').length).toBe(15);
    });
  });

  describe('return shape', () => {
    it('returns { filtered, removedCount, workerModelUsed }', async () => {
      const result = await filterNoise({ a: 'test line' });
      expect(result).toHaveProperty('filtered');
      expect(result).toHaveProperty('removedCount');
      expect(result).toHaveProperty('workerModelUsed');
      expect(typeof result.removedCount).toBe('number');
      expect(typeof result.workerModelUsed).toBe('boolean');
    });
  });

  describe('multiple discovery keys', () => {
    it('filters each key independently', async () => {
      const raw = {
        containers: 'health_status: healthy\nnginx running',
        services: 'Started foo.service\npostgres active',
      };
      const result = await filterNoise(raw);
      expect(result.filtered.containers).toBe('nginx running');
      expect(result.filtered.services).toBe('postgres active');
      expect(result.removedCount).toBe(2);
    });
  });
});
