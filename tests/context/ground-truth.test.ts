import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  extractGroundTruth,
  parseExplicitPins,
  GroundTruthManager,
} from '../../src/context/ground-truth.js';
import type { PinnedFact } from '../../src/context/types.js';

// ---------------------------------------------------------------------------
// extractGroundTruth
// ---------------------------------------------------------------------------

describe('extractGroundTruth', () => {
  it('detects container names from discovery output', () => {
    const raw = {
      'Running containers': 'nginx\npostgres\nredis',
    };
    const facts = extractGroundTruth(raw);
    const containers = facts.filter((f) => f.type === 'container');
    expect(containers.map((c) => c.value)).toContain('nginx');
    expect(containers.map((c) => c.value)).toContain('postgres');
    expect(containers.map((c) => c.value)).toContain('redis');
  });

  it('detects port numbers from discovery output', () => {
    const raw = {
      'Service config': 'listening on :5432\nredis port 6379\nnginx :80',
    };
    const facts = extractGroundTruth(raw);
    const ports = facts.filter((f) => f.type === 'port');
    const portValues = ports.map((p) => p.value);
    expect(portValues).toContain('5432');
    expect(portValues).toContain('6379');
    expect(portValues).toContain('80');
  });

  it('detects IP addresses (excluding 0.0.0.0 and 127.0.0.1)', () => {
    const raw = {
      'Network info': 'server at 192.168.1.10, binding 0.0.0.0, localhost 127.0.0.1, peer 10.0.0.5',
    };
    const facts = extractGroundTruth(raw);
    const ips = facts.filter((f) => f.type === 'ip');
    const ipValues = ips.map((ip) => ip.value);
    expect(ipValues).toContain('192.168.1.10');
    expect(ipValues).toContain('10.0.0.5');
    expect(ipValues).not.toContain('0.0.0.0');
    expect(ipValues).not.toContain('127.0.0.1');
  });

  it('detects error codes', () => {
    const raw = {
      'Error log': 'process OOM killed\nconnection ECONNREFUSED\nfile ENOENT not found\nexit code 137',
    };
    const facts = extractGroundTruth(raw);
    const errors = facts.filter((f) => f.type === 'error_code');
    const errorValues = errors.map((e) => e.value.toLowerCase());
    expect(errorValues).toContain('oom');
    expect(errorValues).toContain('econnrefused');
    expect(errorValues).toContain('enoent');
    expect(errorValues.some((v) => v.includes('exit') && v.includes('137'))).toBe(true);
  });

  it('deduplicates facts by value', () => {
    const raw = {
      'log1': 'port 5432 error',
      'log2': 'running on port 5432',
    };
    const facts = extractGroundTruth(raw);
    const portFacts = facts.filter((f) => f.type === 'port' && f.value === '5432');
    expect(portFacts).toHaveLength(1);
  });

  it('assigns token counts via countTokens', () => {
    const raw = {
      'Running containers': 'nginx',
    };
    const facts = extractGroundTruth(raw);
    expect(facts.length).toBeGreaterThan(0);
    for (const f of facts) {
      expect(f.tokens).toBeGreaterThan(0);
    }
  });

  it('handles empty discovery output', () => {
    const facts = extractGroundTruth({});
    expect(facts).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// parseExplicitPins
// ---------------------------------------------------------------------------

describe('parseExplicitPins', () => {
  it('extracts [PIN]...[/PIN] markers as custom pinned facts', () => {
    const text = 'Some text [PIN]critical issue: DB down[/PIN] more text [PIN]nginx restarted 3 times[/PIN]';
    const pins = parseExplicitPins(text);
    expect(pins).toHaveLength(2);
    expect(pins[0].type).toBe('custom');
    expect(pins[0].value).toBe('critical issue: DB down');
    expect(pins[1].value).toBe('nginx restarted 3 times');
  });

  it('handles multiline PIN content', () => {
    const text = '[PIN]line one\nline two[/PIN]';
    const pins = parseExplicitPins(text);
    expect(pins).toHaveLength(1);
    expect(pins[0].value).toBe('line one\nline two');
  });

  it('returns empty array when no pins present', () => {
    const pins = parseExplicitPins('no pins here');
    expect(pins).toEqual([]);
  });

  it('assigns token counts to pinned facts', () => {
    const pins = parseExplicitPins('[PIN]some data[/PIN]');
    expect(pins[0].tokens).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// GroundTruthManager
// ---------------------------------------------------------------------------

describe('GroundTruthManager', () => {
  let manager: GroundTruthManager;

  // Small window: 100 tokens, 20% cap = 20 tokens budget
  beforeEach(() => {
    manager = new GroundTruthManager(0.20, 100);
  });

  it('adds a PinnedFact and tracks token count', () => {
    const fact: PinnedFact = {
      id: 'f1', type: 'container', value: 'nginx', tokens: 5, pinnedAt: Date.now(),
    };
    manager.add(fact);
    expect(manager.getTokens()).toBe(5);
    expect(manager.getFacts()).toHaveLength(1);
  });

  it('enforces 20% cap with FIFO eviction of oldest', () => {
    // Budget is 20 tokens. Add facts totaling > 20 tokens.
    const facts: PinnedFact[] = [
      { id: 'f1', type: 'ip', value: '10.0.0.1', tokens: 8, pinnedAt: 1000 },
      { id: 'f2', type: 'ip', value: '10.0.0.2', tokens: 8, pinnedAt: 2000 },
      { id: 'f3', type: 'ip', value: '10.0.0.3', tokens: 8, pinnedAt: 3000 },
    ];
    // Total would be 24 > 20, so oldest (f1) should be evicted
    for (const f of facts) manager.add(f);
    expect(manager.getTokens()).toBeLessThanOrEqual(20);
    const remaining = manager.getFacts();
    expect(remaining.find((f) => f.id === 'f1')).toBeUndefined();
  });

  it('eviction priority: IPs first, then ports, then containers, then error_codes', () => {
    // Budget: 20 tokens. Add mixed types totaling > 20.
    const facts: PinnedFact[] = [
      { id: 'ip1', type: 'ip', value: '10.0.0.1', tokens: 6, pinnedAt: 1000 },
      { id: 'port1', type: 'port', value: '5432', tokens: 6, pinnedAt: 2000 },
      { id: 'cont1', type: 'container', value: 'nginx', tokens: 6, pinnedAt: 3000 },
      { id: 'err1', type: 'error_code', value: 'OOM', tokens: 6, pinnedAt: 4000 },
    ];
    // Total: 24, budget: 20 -> must evict 4+ tokens
    // Should evict IP first (least important)
    for (const f of facts) manager.add(f);
    const remaining = manager.getFacts();
    expect(remaining.find((f) => f.id === 'ip1')).toBeUndefined();
    expect(remaining.find((f) => f.id === 'err1')).toBeDefined();
  });

  it('getTokens returns total token count of all pinned facts', () => {
    manager.add({ id: 'f1', type: 'container', value: 'a', tokens: 3, pinnedAt: 1 });
    manager.add({ id: 'f2', type: 'port', value: '80', tokens: 4, pinnedAt: 2 });
    expect(manager.getTokens()).toBe(7);
  });

  it('buildSection returns formatted ground truth string', () => {
    manager.add({ id: 'f1', type: 'container', value: 'nginx', tokens: 3, pinnedAt: 1 });
    manager.add({ id: 'f2', type: 'port', value: '5432', tokens: 3, pinnedAt: 2 });
    manager.add({ id: 'f3', type: 'error_code', value: 'OOM', tokens: 3, pinnedAt: 3 });
    const section = manager.buildSection();
    expect(section).toContain('## Ground Truth');
    expect(section).toContain('nginx');
    expect(section).toContain('5432');
    expect(section).toContain('OOM');
  });

  it('buildSection groups facts by type', () => {
    manager.add({ id: 'f1', type: 'container', value: 'nginx', tokens: 2, pinnedAt: 1 });
    manager.add({ id: 'f2', type: 'container', value: 'redis', tokens: 2, pinnedAt: 2 });
    manager.add({ id: 'f3', type: 'port', value: '80', tokens: 2, pinnedAt: 3 });
    const section = manager.buildSection();
    expect(section).toContain('Containers:');
    expect(section).toContain('Ports:');
  });
});
