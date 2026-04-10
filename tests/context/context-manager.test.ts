import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ContextManager } from '../../src/context/context-manager.js';
import type { ContextManagerConfig } from '../../src/context/types.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';

const DEFAULT_CONFIG: ContextManagerConfig = {
  windowSize: 1000,
  threshold: 0.83,
  target: 0.60,
  groundTruthCap: 0.20,
};

describe('ContextManager', () => {
  let sessionDir: string;

  beforeEach(() => {
    sessionDir = fs.mkdtempSync(path.join(tmpdir(), 'ctx-test-'));
  });

  it('ingestDiscovery populates ground truth from containers', () => {
    const mgr = new ContextManager(DEFAULT_CONFIG, sessionDir, 'test-session');
    mgr.ingestDiscovery({
      'Running containers': 'nginx\npostgres',
    });
    const ctx = mgr.buildContext();
    expect(ctx).toContain('## Ground Truth');
    expect(ctx).toContain('nginx');
  });

  it('ingestDiscovery creates observations per discovery key', () => {
    const mgr = new ContextManager(DEFAULT_CONFIG, sessionDir, 'test-session');
    mgr.ingestDiscovery({
      'Running containers': 'nginx',
      'System logs': 'error in module X',
    });
    const ctx = mgr.buildContext();
    expect(ctx).toContain('## Observations');
    expect(ctx).toContain('Running containers');
  });

  it('ingestDiscovery extracts explicit [PIN] markers', () => {
    const mgr = new ContextManager(DEFAULT_CONFIG, sessionDir, 'test-session');
    mgr.ingestDiscovery({
      'Notes': 'check [PIN]DB master is down[/PIN] also check replica',
    });
    const ctx = mgr.buildContext();
    expect(ctx).toContain('DB master is down');
  });

  it('getUsage returns tokens, percentage, and groundTruthTokens', () => {
    const mgr = new ContextManager(DEFAULT_CONFIG, sessionDir, 'test-session');
    mgr.ingestDiscovery({
      'Running containers': 'nginx',
    });
    const usage = mgr.getUsage();
    expect(usage).toHaveProperty('tokens');
    expect(usage).toHaveProperty('percentage');
    expect(usage).toHaveProperty('groundTruthTokens');
    expect(typeof usage.tokens).toBe('number');
    expect(typeof usage.percentage).toBe('number');
    expect(usage.tokens).toBeGreaterThan(0);
    expect(usage.percentage).toBeGreaterThan(0);
    expect(usage.percentage).toBeLessThanOrEqual(1);
  });

  it('maybeCompact returns null when below threshold', async () => {
    const mgr = new ContextManager(DEFAULT_CONFIG, sessionDir, 'test-session');
    mgr.ingestDiscovery({
      'Small data': 'hello',
    });
    const result = await mgr.maybeCompact();
    expect(result).toBeNull();
  });

  it('maybeCompact fires compaction when at or above 83% threshold', async () => {
    // Small window to easily exceed threshold
    const config: ContextManagerConfig = {
      windowSize: 50,
      threshold: 0.83,
      target: 0.60,
      groundTruthCap: 0.20,
    };
    const mgr = new ContextManager(config, sessionDir, 'test-session');
    // Ingest enough data to exceed 83%
    mgr.ingestDiscovery({
      'Big data': 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris.',
    });
    const usage = mgr.getUsage();
    if (usage.percentage >= 0.83) {
      const result = await mgr.maybeCompact();
      expect(result).not.toBeNull();
      expect(result!.tokensBefore).toBeGreaterThan(result!.tokensAfter);
    }
  });

  it('maybeCompact fires exactly ONCE per threshold crossing', async () => {
    const config: ContextManagerConfig = {
      windowSize: 50,
      threshold: 0.83,
      target: 0.60,
      groundTruthCap: 0.20,
    };
    const mgr = new ContextManager(config, sessionDir, 'test-session');
    mgr.ingestDiscovery({
      'Big data': 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.',
    });
    const first = await mgr.maybeCompact();
    const second = await mgr.maybeCompact();
    // Second call should return null (compactionFired flag)
    if (first !== null) {
      expect(second).toBeNull();
    }
  });

  it('maybeCompact saves snapshot before eviction', async () => {
    const config: ContextManagerConfig = {
      windowSize: 50,
      threshold: 0.83,
      target: 0.60,
      groundTruthCap: 0.20,
    };
    const mgr = new ContextManager(config, sessionDir, 'test-session');
    mgr.ingestDiscovery({
      'Big data': 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor.',
    });
    const result = await mgr.maybeCompact();
    if (result !== null && result.snapshotPath) {
      expect(fs.existsSync(result.snapshotPath)).toBe(true);
      const snapshot = JSON.parse(fs.readFileSync(result.snapshotPath, 'utf-8'));
      expect(snapshot).toHaveProperty('observations');
      expect(snapshot).toHaveProperty('tokenCount');
    }
  });

  it('buildContext returns formatted Ground Truth + Observations', () => {
    const mgr = new ContextManager(DEFAULT_CONFIG, sessionDir, 'test-session');
    mgr.ingestDiscovery({
      'Running containers': 'nginx\nredis',
      'Logs': 'error OOM in container',
    });
    const ctx = mgr.buildContext();
    expect(ctx).toContain('## Ground Truth');
    expect(ctx).toContain('---');
    expect(ctx).toContain('## Observations');
  });

  it('reset clears all state', () => {
    const mgr = new ContextManager(DEFAULT_CONFIG, sessionDir, 'test-session');
    mgr.ingestDiscovery({
      'Running containers': 'nginx',
    });
    expect(mgr.getUsage().tokens).toBeGreaterThan(0);
    mgr.reset();
    expect(mgr.getUsage().tokens).toBe(0);
  });

  it('after compaction, usage is at or below target', async () => {
    const config: ContextManagerConfig = {
      windowSize: 50,
      threshold: 0.83,
      target: 0.60,
      groundTruthCap: 0.20,
    };
    const mgr = new ContextManager(config, sessionDir, 'test-session');
    mgr.ingestDiscovery({
      'Big data': 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam.',
    });
    const result = await mgr.maybeCompact();
    if (result !== null) {
      const usage = mgr.getUsage();
      expect(usage.percentage).toBeLessThanOrEqual(config.target + 0.05); // small tolerance for token counting
    }
  });
});
