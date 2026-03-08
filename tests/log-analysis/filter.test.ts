import { describe, it, expect } from 'vitest';
import { preFilterLogs, formatForLLM } from '../../src/log-analysis/filter.js';
import type { LogEntry } from '../../src/log-analysis/types.js';

function makeEntry(overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    timestamp: '2024-03-07T14:23:01.000Z',
    level: 'info',
    message: 'test message',
    source: 'test',
    raw: 'raw log line',
    ...overrides,
  };
}

function makeEntries(count: number, overrides: Partial<LogEntry> = {}): LogEntry[] {
  return Array.from({ length: count }, (_, i) =>
    makeEntry({ message: `message ${i}`, ...overrides })
  );
}

describe('preFilterLogs', () => {
  it('returns all entries when count is under the limit (200 lines)', () => {
    const entries = makeEntries(50);
    const result = preFilterLogs({ entries });

    expect(result.filtered.length).toBe(50);
    expect(result.truncated).toBe(false);
    expect(result.message).toBeUndefined();
  });

  it('truncates to 200 lines when input exceeds limit, includes truncation note', () => {
    const entries = makeEntries(500);
    const result = preFilterLogs({ entries });

    expect(result.filtered.length).toBe(200);
    expect(result.truncated).toBe(true);
    expect(result.message).toBe('Showing 200 of 500 matches');
  });

  it('returns entries with level filter applied (e.g., only errors)', () => {
    const entries = [
      makeEntry({ level: 'error', message: 'an error' }),
      makeEntry({ level: 'info', message: 'info msg' }),
      makeEntry({ level: 'warn', message: 'a warning' }),
      makeEntry({ level: 'error', message: 'another error' }),
    ];
    const result = preFilterLogs({ entries, levelFilter: 'error' });

    expect(result.filtered.length).toBe(2);
    expect(result.filtered.every(e => e.level === 'error')).toBe(true);
    expect(result.truncated).toBe(false);
  });

  it('level filter is case-insensitive', () => {
    const entries = [
      makeEntry({ level: 'error', message: 'err' }),
      makeEntry({ level: 'info', message: 'ok' }),
    ];
    const result = preFilterLogs({ entries, levelFilter: 'ERROR' });
    expect(result.filtered.length).toBe(1);
  });

  it('returns a "no matching entries" message when input has zero matches', () => {
    const entries = makeEntries(10, { level: 'info' });
    const result = preFilterLogs({ entries, levelFilter: 'error' });

    expect(result.filtered.length).toBe(0);
    expect(result.message).toBe('No matching log entries found');
  });

  it('accepts a custom line limit (not just 200)', () => {
    const entries = makeEntries(100);
    const result = preFilterLogs({ entries, maxLines: 50 });

    expect(result.filtered.length).toBe(50);
    expect(result.truncated).toBe(true);
    expect(result.message).toBe('Showing 50 of 100 matches');
  });

  it('keeps the most recent (last) entries when truncating', () => {
    const entries = makeEntries(10);
    const result = preFilterLogs({ entries, maxLines: 3 });

    // Should keep last 3 entries (most recent)
    expect(result.filtered.length).toBe(3);
    expect(result.filtered[0].message).toBe('message 7');
    expect(result.filtered[2].message).toBe('message 9');
  });
});

describe('formatForLLM', () => {
  it('formats entries as "TIMESTAMP [LEVEL] SOURCE: MESSAGE" one per line', () => {
    const entries = [
      makeEntry({ timestamp: '2024-03-07T14:23:01.000Z', level: 'error', source: 'nginx', message: 'upstream timed out' }),
      makeEntry({ timestamp: '2024-03-07T14:24:00.000Z', level: 'info', source: 'mysql', message: 'ready for connections' }),
    ];
    const output = formatForLLM(entries);
    const lines = output.split('\n').filter(Boolean);

    expect(lines.length).toBe(2);
    expect(lines[0]).toBe('2024-03-07T14:23:01.000Z [error] nginx: upstream timed out');
    expect(lines[1]).toBe('2024-03-07T14:24:00.000Z [info] mysql: ready for connections');
  });
});
