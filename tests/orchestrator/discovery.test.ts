import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock runner module
vi.mock('../../src/execution/runner.js', () => ({
  needsShell: vi.fn((cmd: string) => /[|><;`]|&&|\|\|/.test(cmd)),
  parseCommand: vi.fn((cmd: string) => {
    const tokens = cmd.split(/\s+/);
    return { executable: tokens[0], args: tokens.slice(1) };
  }),
  runCommand: vi.fn(async () => ({ stdout: 'mock-output', stderr: '', exitCode: 0 })),
  runShellCommand: vi.fn(async () => ({ stdout: 'mock-output', stderr: '', exitCode: 0 })),
}));

// Mock toon-encoder module
vi.mock('../../src/llm/toon-encoder.js', () => ({
  encodeForLLM: vi.fn((data: unknown, label?: string) => {
    const json = JSON.stringify(data);
    return label ? `${label}:\n${json}` : json;
  }),
}));

import {
  extractCommandTarget,
  runParallelDiscovery,
  getContainerQueue,
} from '../../src/orchestrator/discovery.js';
import { runCommand, runShellCommand } from '../../src/execution/runner.js';
import { encodeForLLM } from '../../src/llm/toon-encoder.js';
import type { DiscoveryCommand } from '../../src/orchestrator/types.js';

describe('extractCommandTarget', () => {
  it('extracts container from docker exec', () => {
    expect(extractCommandTarget('docker exec postgres-demo psql -U postgres')).toBe('postgres-demo');
  });

  it('extracts container from docker logs', () => {
    expect(extractCommandTarget('docker logs nginx-proxy --tail 100')).toBe('nginx-proxy');
  });

  it('returns __host__ for docker ps', () => {
    expect(extractCommandTarget('docker ps -a --format "{{.Names}}"')).toBe('__host__');
  });

  it('returns __host__ for docker stats', () => {
    expect(extractCommandTarget('docker stats --no-stream')).toBe('__host__');
  });

  it('returns __host__ for docker network commands', () => {
    expect(extractCommandTarget('docker network ls')).toBe('__host__');
  });

  it('returns __host__ for non-docker commands', () => {
    expect(extractCommandTarget('cat /etc/hosts')).toBe('__host__');
  });

  it('extracts container from docker inspect', () => {
    expect(extractCommandTarget('docker inspect my-app')).toBe('my-app');
  });

  it('extracts container from docker exec with -it flags', () => {
    expect(extractCommandTarget('docker exec -it my-container bash')).toBe('my-container');
  });
});

describe('runParallelDiscovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clear container queues between tests
    getContainerQueue('__clear__');
  });

  it('returns empty result for empty commands', async () => {
    const result = await runParallelDiscovery([]);
    expect(result).toEqual({ context: '', raw: {} });
  });

  it('runs commands targeting different containers in parallel', async () => {
    const delay = 50;
    const commands: DiscoveryCommand[] = [
      { command: 'docker exec postgres-demo psql -U postgres -c "SELECT 1"', label: 'pg-check' },
      { command: 'docker exec nginx-proxy cat /etc/nginx/nginx.conf', label: 'nginx-conf' },
      { command: 'docker exec redis-cache redis-cli ping', label: 'redis-ping' },
    ];

    vi.mocked(runShellCommand).mockImplementation(async () => {
      await new Promise(r => setTimeout(r, delay));
      return { stdout: 'ok', stderr: '', exitCode: 0 };
    });
    vi.mocked(runCommand).mockImplementation(async () => {
      await new Promise(r => setTimeout(r, delay));
      return { stdout: 'ok', stderr: '', exitCode: 0 };
    });

    const start = Date.now();
    await runParallelDiscovery(commands);
    const elapsed = Date.now() - start;

    // Parallel: should be ~1x delay, not 3x
    expect(elapsed).toBeLessThan(delay * 2);
  });

  it('serializes commands targeting the same container', async () => {
    const delay = 50;
    const commands: DiscoveryCommand[] = [
      { command: 'docker exec postgres-demo psql -U postgres -c "SELECT 1"', label: 'pg-check1' },
      { command: 'docker exec postgres-demo psql -U postgres -c "SELECT 2"', label: 'pg-check2' },
    ];

    vi.mocked(runShellCommand).mockImplementation(async () => {
      await new Promise(r => setTimeout(r, delay));
      return { stdout: 'ok', stderr: '', exitCode: 0 };
    });

    const start = Date.now();
    await runParallelDiscovery(commands);
    const elapsed = Date.now() - start;

    // Serialized: should be ~2x delay
    expect(elapsed).toBeGreaterThanOrEqual(delay * 1.5);
  });

  it('runs mixed targets with parallel + serialized behavior', async () => {
    const delay = 50;
    const commands: DiscoveryCommand[] = [
      { command: 'docker exec postgres-demo psql -U postgres -c "SELECT 1"', label: 'pg1' },
      { command: 'docker exec postgres-demo psql -U postgres -c "SELECT 2"', label: 'pg2' },
      { command: 'docker exec nginx-proxy cat /etc/nginx/nginx.conf', label: 'nginx' },
    ];

    vi.mocked(runShellCommand).mockImplementation(async () => {
      await new Promise(r => setTimeout(r, delay));
      return { stdout: 'ok', stderr: '', exitCode: 0 };
    });
    vi.mocked(runCommand).mockImplementation(async () => {
      await new Promise(r => setTimeout(r, delay));
      return { stdout: 'ok', stderr: '', exitCode: 0 };
    });

    const start = Date.now();
    await runParallelDiscovery(commands);
    const elapsed = Date.now() - start;

    // pg1+pg2 serialized (100ms) runs in parallel with nginx (50ms)
    // Total should be ~100ms, not 150ms
    expect(elapsed).toBeGreaterThanOrEqual(delay * 1.5);
    expect(elapsed).toBeLessThan(delay * 2.5);
  });

  it('isolates errors -- one failure does not abort others', async () => {
    const commands: DiscoveryCommand[] = [
      { command: 'docker exec postgres-demo psql -U postgres -c "SELECT 1"', label: 'pg-ok' },
      { command: 'docker exec bad-container fail', label: 'bad' },
      { command: 'docker exec nginx-proxy cat /etc/nginx/nginx.conf', label: 'nginx-ok' },
    ];

    let callCount = 0;
    vi.mocked(runShellCommand).mockImplementation(async () => {
      callCount++;
      if (callCount === 2) {
        throw new Error('Container not found');
      }
      return { stdout: 'ok', stderr: '', exitCode: 0 };
    });
    vi.mocked(runCommand).mockImplementation(async () => {
      callCount++;
      if (callCount === 2) {
        throw new Error('Container not found');
      }
      return { stdout: 'ok', stderr: '', exitCode: 0 };
    });

    const result = await runParallelDiscovery(commands);

    // The two successful commands should be in results
    expect(result.raw['pg-ok']).toBe('ok');
    expect(result.raw['nginx-ok']).toBe('ok');
    // The failed command should not be in results
    expect(result.raw['bad']).toBeUndefined();
  });

  it('preserves result order matching original command array', async () => {
    const commands: DiscoveryCommand[] = [
      { command: 'docker exec a-container cmd1', label: 'first' },
      { command: 'docker exec b-container cmd2', label: 'second' },
      { command: 'docker exec c-container cmd3', label: 'third' },
    ];

    // Commands resolve in reverse order (c fastest, a slowest)
    let callIdx = 0;
    vi.mocked(runCommand).mockImplementation(async () => {
      const delay = [30, 20, 10][callIdx++] ?? 10;
      await new Promise(r => setTimeout(r, delay));
      return { stdout: `output-${callIdx}`, stderr: '', exitCode: 0 };
    });

    const result = await runParallelDiscovery(commands);

    // Keys should be in original command order
    const keys = Object.keys(result.raw);
    expect(keys).toEqual(['first', 'second', 'third']);
  });

  it('encodes results with TOON using correct label', async () => {
    const commands: DiscoveryCommand[] = [
      { command: 'docker exec pg psql -U postgres -c "SELECT 1"', label: 'pg-test' },
    ];

    vi.mocked(runShellCommand).mockResolvedValue({
      stdout: 'test-output', stderr: '', exitCode: 0,
    });
    vi.mocked(runCommand).mockResolvedValue({
      stdout: 'test-output', stderr: '', exitCode: 0,
    });

    await runParallelDiscovery(commands);

    expect(encodeForLLM).toHaveBeenCalledWith(
      { 'pg-test': 'test-output' },
      'Discovery (ground truth from live system)',
    );
  });

  it('uses stderr when stdout is empty', async () => {
    const commands: DiscoveryCommand[] = [
      { command: 'docker exec pg some-cmd', label: 'test' },
    ];

    vi.mocked(runCommand).mockResolvedValue({
      stdout: '', stderr: 'error info', exitCode: 1,
    });

    const result = await runParallelDiscovery(commands);
    expect(result.raw['test']).toBe('error info');
  });

  it('uses (empty) when both stdout and stderr are empty', async () => {
    const commands: DiscoveryCommand[] = [
      { command: 'docker exec pg some-cmd', label: 'test' },
    ];

    vi.mocked(runCommand).mockResolvedValue({
      stdout: '', stderr: '', exitCode: 0,
    });

    const result = await runParallelDiscovery(commands);
    expect(result.raw['test']).toBe('(empty)');
  });
});
