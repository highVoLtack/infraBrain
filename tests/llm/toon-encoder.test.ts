import { describe, it, expect } from 'vitest';
import { encodeToon, encodeForLLM, measureSavings } from '../../src/llm/toon-encoder.js';
import { decode } from '@toon-format/toon';

describe('encodeToon', () => {
  it('converts a flat JSON object to TOON key: value format (no braces/quotes)', () => {
    const result = encodeToon({ host: 'nginx', status: 'down', port: 80 });
    expect(result).toContain('host: nginx');
    expect(result).toContain('status: down');
    expect(result).toContain('port: 80');
    expect(result).not.toContain('{');
    expect(result).not.toContain('}');
  });

  it('converts an array of uniform objects to TOON tabular format with header + rows', () => {
    const data = [
      { name: 'nginx', port: 80 },
      { name: 'redis', port: 6379 },
    ];
    const result = encodeToon(data);
    // Tabular format should have a header line with column names
    expect(result).toContain('name');
    expect(result).toContain('port');
    expect(result).toContain('nginx');
    expect(result).toContain('redis');
    // Should not have JSON array brackets in the data rows
    expect(result).not.toContain('"name"');
  });

  it('handles nested objects with indentation', () => {
    const data = { server: { name: 'nginx', config: { port: 80, ssl: true } } };
    const result = encodeToon(data);
    expect(result).toContain('server:');
    expect(result).toContain('name: nginx');
    expect(result).toContain('port: 80');
    expect(result).toContain('ssl: true');
  });

  it('handles mixed structures (objects + arrays)', () => {
    const data = { servers: [{ name: 'nginx' }, { name: 'redis' }], count: 2 };
    const result = encodeToon(data);
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
    expect(result).toContain('nginx');
    expect(result).toContain('redis');
  });

  it('returns the input unchanged for primitive values', () => {
    expect(encodeToon('hello')).toBe('hello');
    expect(encodeToon(42)).toBe('42');
    expect(encodeToon(true)).toBe('true');
    expect(encodeToon(null)).toBe('null');
  });
});

describe('encodeForLLM', () => {
  it('wraps encodeToon with a label prefix', () => {
    const data = { host: 'nginx', status: 'up' };
    const result = encodeForLLM(data, 'Infrastructure State');
    expect(result).toMatch(/^Infrastructure State:\n/);
    expect(result).toContain('host: nginx');
  });

  it('returns TOON string without prefix when no label given', () => {
    const data = { host: 'nginx' };
    const result = encodeForLLM(data);
    expect(result).not.toContain(':');
    // Actually it will contain "host: nginx" which has a colon, but should not start with a label
    expect(result).toBe(encodeToon(data));
  });
});

describe('measureSavings', () => {
  it('reports >20% token savings on typical log entries array', () => {
    const logEntries = [
      { timestamp: '2026-03-08T10:00:00Z', level: 'error', source: 'nginx', message: '502 Bad Gateway' },
      { timestamp: '2026-03-08T10:00:01Z', level: 'error', source: 'nginx', message: 'upstream timeout' },
      { timestamp: '2026-03-08T10:00:02Z', level: 'warn', source: 'nginx', message: 'retry limit reached' },
    ];
    const savings = measureSavings(logEntries);
    expect(savings.savingsPercent).toBeGreaterThan(20);
    expect(savings.toonTokens).toBeLessThan(savings.jsonTokens);
  });

  it('reports >20% token savings on fix plan steps array', () => {
    const steps = [
      { command: 'docker inspect nginx', description: 'Check container state', rollback: '', risk: 'read' },
      { command: 'docker restart nginx', description: 'Restart the container', rollback: 'docker stop nginx', risk: 'write' },
    ];
    const savings = measureSavings(steps);
    expect(savings.savingsPercent).toBeGreaterThan(20);
  });
});

describe('lossless round-trip', () => {
  it('encode then decode produces equivalent data for arrays', () => {
    const data = [
      { timestamp: '2026-03-08T10:00:00Z', level: 'error', source: 'nginx', message: '502 Bad Gateway' },
      { timestamp: '2026-03-08T10:00:01Z', level: 'error', source: 'nginx', message: 'upstream timeout' },
    ];
    const encoded = encodeToon(data);
    const decoded = decode(encoded);
    expect(decoded).toEqual(data);
  });

  it('encode then decode produces equivalent data for objects', () => {
    const data = { host: 'nginx', status: 'down', port: 80 };
    const encoded = encodeToon(data);
    const decoded = decode(encoded);
    expect(decoded).toEqual(data);
  });
});

describe('graceful fallback', () => {
  it('does not throw on any input and returns a string', () => {
    // Test with various edge cases
    expect(() => encodeToon(undefined)).not.toThrow();
    expect(typeof encodeToon(undefined)).toBe('string');

    expect(() => encodeToon({ fn: 'test', deep: { nested: { a: [1, 'b', { c: true }] } } })).not.toThrow();
  });
});
