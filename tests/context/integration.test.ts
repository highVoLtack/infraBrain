/**
 * Integration tests for the full context management pipeline.
 * Tests: noise filter -> ContextManager -> buildContext end-to-end.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ContextManager } from '../../src/context/context-manager.js';
import { filterNoise } from '../../src/context/noise-filter.js';
import { countTokens } from '../../src/context/token-counter.js';

// Mock fs for snapshot writes (no real file system in tests)
vi.mock('node:fs', () => ({
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

// Mock ai SDK for worker model calls
vi.mock('ai', () => ({
  generateObject: vi.fn(),
}));

describe('Context Management Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('full pipeline with compaction', () => {
    it('triggers compaction when discovery output exceeds 83% of small window', async () => {
      // Create discovery output that will produce enough tokens to exceed 83% of a 500-token window
      const largeOutput = Array.from({ length: 50 }, (_, i) =>
        `ERROR: connection refused on port ${3000 + i} from host app-server-${i}.local at ${Date.now()}`
      ).join('\n');

      const discoveryRaw: Record<string, string> = {
        'Docker logs': largeOutput,
        'System status': 'nginx-web running on 172.18.0.5:8080\npostgres-db running on 172.18.0.6:5432',
      };

      // Filter noise first (no noise patterns to remove here)
      const { filtered } = await filterNoise(discoveryRaw);

      // Create ContextManager with small window to force compaction
      const cm = new ContextManager(
        { windowSize: 500, threshold: 0.83, target: 0.60, groundTruthCap: 0.20 },
        '/tmp/test-ctx',
        'test-session',
      );

      cm.ingestDiscovery(filtered);

      // Usage should exceed threshold
      const usageBefore = cm.getUsage();
      expect(usageBefore.percentage).toBeGreaterThanOrEqual(0.83);

      // Compaction should fire
      const result = await cm.maybeCompact();
      expect(result).not.toBeNull();
      expect(result!.tokensAfter).toBeLessThan(result!.tokensBefore);

      // buildContext should still produce valid output
      const context = cm.buildContext();
      expect(context).toContain('Ground Truth');
    });

    it('does not fire compaction when context is below 83%', async () => {
      const discoveryRaw: Record<string, string> = {
        'Running containers': 'nginx-web\npostgres-db',
        'Port check': '8080 open\n5432 open',
      };

      const { filtered } = await filterNoise(discoveryRaw);

      const cm = new ContextManager(
        { windowSize: 10000, threshold: 0.83, target: 0.60, groundTruthCap: 0.20 },
        '/tmp/test-ctx',
        'test-session',
      );

      cm.ingestDiscovery(filtered);

      const usage = cm.getUsage();
      expect(usage.percentage).toBeLessThan(0.83);

      const result = await cm.maybeCompact();
      expect(result).toBeNull();

      // buildContext should include all observations
      const context = cm.buildContext();
      expect(context).toContain('nginx-web');
      expect(context).toContain('postgres-db');
      expect(context).toContain('Observations');
    });
  });

  describe('ground truth survival', () => {
    it('container names and error codes survive compaction', async () => {
      // Discovery with identifiable container names and error codes
      const discoveryRaw: Record<string, string> = {
        'Running containers': 'nginx-frontend\napi-backend\nredis-cache',
        'Error log': 'OOM killed process 1234\nECONNREFUSED on api-backend:3000',
        // Pad with enough content to force compaction
        'Verbose log': Array.from({ length: 40 }, (_, i) =>
          `[${Date.now()}] Processing request ${i} with payload size ${i * 100} bytes`
        ).join('\n'),
      };

      const { filtered } = await filterNoise(discoveryRaw);

      const cm = new ContextManager(
        { windowSize: 500, threshold: 0.83, target: 0.60, groundTruthCap: 0.20 },
        '/tmp/test-ctx',
        'test-session',
      );

      cm.ingestDiscovery(filtered);

      // Force compaction
      await cm.maybeCompact();

      const context = cm.buildContext();

      // Ground truth should survive: container names and error codes
      expect(context).toContain('nginx-frontend');
      expect(context).toContain('api-backend');
      expect(context).toContain('redis-cache');
      expect(context).toContain('OOM');
      expect(context).toContain('ECONNREFUSED');
    });
  });

  describe('noise filter integration', () => {
    it('removes healthcheck spam before reaching context', async () => {
      const discoveryRaw: Record<string, string> = {
        'Docker events': [
          'health_status: healthy',
          'ERROR: connection timeout on postgres-db',
          'health_status: unhealthy',
          'CRITICAL: disk space low on /var/lib/docker',
          'healthcheck passed for nginx',
          'Started docker-cleanup.service',
          '-- Logs begin at Thu 2026-01-01 --',
        ].join('\n'),
      };

      const { filtered, removedCount } = await filterNoise(discoveryRaw);
      expect(removedCount).toBeGreaterThan(0);

      const cm = new ContextManager(
        { windowSize: 10000, threshold: 0.83, target: 0.60, groundTruthCap: 0.20 },
        '/tmp/test-ctx',
        'test-session',
      );

      cm.ingestDiscovery(filtered);
      const context = cm.buildContext();

      // Real errors should survive
      expect(context).toContain('connection timeout');
      expect(context).toContain('disk space low');

      // Noise should be absent
      expect(context).not.toContain('health_status: healthy');
      expect(context).not.toContain('healthcheck passed');
      expect(context).not.toContain('Logs begin at');
    });

    it('applies skill-declared noise patterns', async () => {
      const discoveryRaw: Record<string, string> = {
        'App logs': [
          'CUSTOM_METRIC: cpu=45%',
          'ERROR: database connection lost',
          'CUSTOM_METRIC: memory=78%',
          'WARN: slow query detected',
        ].join('\n'),
      };

      const skillPatterns = ['CUSTOM_METRIC'];
      const { filtered, removedCount } = await filterNoise(discoveryRaw, skillPatterns);

      expect(removedCount).toBeGreaterThan(0);

      const cm = new ContextManager(
        { windowSize: 10000, threshold: 0.83, target: 0.60, groundTruthCap: 0.20 },
        '/tmp/test-ctx',
        'test-session',
      );

      cm.ingestDiscovery(filtered);
      const context = cm.buildContext();

      // Skill-pattern-matched lines should be removed
      expect(context).not.toContain('CUSTOM_METRIC');
      // Real errors should survive
      expect(context).toContain('database connection lost');
      expect(context).toContain('slow query detected');
    });
  });

  describe('once-per-threshold compaction guard', () => {
    it('compaction fires only once even if called multiple times', async () => {
      const discoveryRaw: Record<string, string> = {
        'Large output': Array.from({ length: 50 }, (_, i) =>
          `Line ${i}: detailed diagnostic information about service-${i}`
        ).join('\n'),
      };

      const { filtered } = await filterNoise(discoveryRaw);

      const cm = new ContextManager(
        { windowSize: 500, threshold: 0.83, target: 0.60, groundTruthCap: 0.20 },
        '/tmp/test-ctx',
        'test-session',
      );

      cm.ingestDiscovery(filtered);

      // First call should fire
      const first = await cm.maybeCompact();
      expect(first).not.toBeNull();

      // Second call should return null (once-only guard)
      const second = await cm.maybeCompact();
      expect(second).toBeNull();
    });
  });

  describe('token tracking accuracy', () => {
    it('tracks token usage through the full pipeline', async () => {
      const discoveryRaw: Record<string, string> = {
        'Container list': 'nginx-app\npostgres-db',
        'Status': 'All systems operational on 172.18.0.10:8080',
      };

      const { filtered } = await filterNoise(discoveryRaw);

      const cm = new ContextManager(
        { windowSize: 10000, threshold: 0.83, target: 0.60, groundTruthCap: 0.20 },
        '/tmp/test-ctx',
        'test-session',
      );

      cm.ingestDiscovery(filtered);
      const usage = cm.getUsage();

      // Tokens should be positive and tracked
      expect(usage.tokens).toBeGreaterThan(0);
      expect(usage.percentage).toBeGreaterThan(0);
      expect(usage.percentage).toBeLessThan(1);
      expect(usage.groundTruthTokens).toBeGreaterThanOrEqual(0);
    });
  });
});
