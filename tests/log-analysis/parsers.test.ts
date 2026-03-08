import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { detectLogFormat } from '../../src/log-analysis/detector.js';
import { parseSyslog } from '../../src/log-analysis/parsers/syslog.js';
import { parseJsonLog } from '../../src/log-analysis/parsers/json.js';
import { parseDockerLog } from '../../src/log-analysis/parsers/docker.js';
import { parseJournaldLog } from '../../src/log-analysis/parsers/journald.js';
import { parseLog } from '../../src/log-analysis/parsers/index.js';
import { LogFormat } from '../../src/log-analysis/types.js';

const FIXTURES_DIR = join(import.meta.dirname, '..', 'fixtures', 'logs');
const readFixture = (name: string): string => readFileSync(join(FIXTURES_DIR, name), 'utf-8');

describe('detectLogFormat', () => {
  it('identifies JSON format when first line starts with {', () => {
    const sample = readFixture('json.log');
    expect(detectLogFormat(sample)).toBe(LogFormat.JSON);
  });

  it('identifies Docker format (ISO8601 timestamp with Z followed by stream type)', () => {
    const sample = readFixture('docker.log');
    expect(detectLogFormat(sample)).toBe(LogFormat.DOCKER);
  });

  it('identifies journald format ("-- Journal begins" header)', () => {
    const sample = readFixture('journald.log');
    expect(detectLogFormat(sample)).toBe(LogFormat.JOURNALD);
  });

  it('identifies syslog format (BSD-style "Mon DD HH:MM:SS hostname")', () => {
    const sample = readFixture('syslog.log');
    expect(detectLogFormat(sample)).toBe(LogFormat.SYSLOG);
  });

  it('defaults to syslog for unrecognized formats', () => {
    const unrecognized = 'some random log line\nanother line of text\nnothing special here';
    expect(detectLogFormat(unrecognized)).toBe(LogFormat.SYSLOG);
  });
});

describe('parseSyslog', () => {
  it('extracts timestamp, level, message, source from BSD syslog lines', () => {
    const lines = readFixture('syslog.log').split('\n').filter(Boolean);
    const entries = parseSyslog(lines);

    expect(entries.length).toBeGreaterThan(0);
    // First line: nginx upstream timeout
    const first = entries[0];
    expect(first.timestamp).toBeTruthy();
    expect(first.source).toBe('nginx');
    expect(first.message).toContain('upstream timed out');
    expect(first.raw).toBe(lines[0]);
  });

  it('normalizes level from message keywords', () => {
    const lines = readFixture('syslog.log').split('\n').filter(Boolean);
    const entries = parseSyslog(lines);

    // Line with "error:" should have error level
    const errorEntry = entries.find(e => e.message.includes('cannot allocate memory'));
    expect(errorEntry?.level).toBe('error');

    // Line with "Warning:" should have warn level
    const warnEntry = entries.find(e => e.message.includes('Aborted connection'));
    expect(warnEntry?.level).toBe('warn');
  });

  it('preserves raw original line', () => {
    const lines = readFixture('syslog.log').split('\n').filter(Boolean);
    const entries = parseSyslog(lines);
    entries.forEach((entry, i) => {
      expect(entry.raw).toBe(lines[i]);
    });
  });

  it('handles malformed lines gracefully', () => {
    const lines = ['not a syslog line at all', 'another garbage line'];
    const entries = parseSyslog(lines);
    // Should return entries with raw line preserved, not crash
    expect(entries.length).toBe(2);
    entries.forEach((entry, i) => {
      expect(entry.raw).toBe(lines[i]);
    });
  });
});

describe('parseJsonLog', () => {
  it('extracts fields from JSON structured log lines', () => {
    const lines = readFixture('json.log').split('\n').filter(Boolean);
    const entries = parseJsonLog(lines);

    expect(entries.length).toBeGreaterThan(0);
    const first = entries[0];
    expect(first.timestamp).toBe('2024-03-07T14:23:01.000Z');
    expect(first.level).toBe('error');
    expect(first.message).toBe('Connection pool exhausted');
    expect(first.source).toBe('api-gateway');
  });

  it('handles varying field names (time/@timestamp, severity, msg)', () => {
    const lines = readFixture('json.log').split('\n').filter(Boolean);
    const entries = parseJsonLog(lines);

    // Line 3 uses "time", "severity", "msg" instead of standard fields
    const entry = entries[2];
    expect(entry.timestamp).toBe('2024-03-07T14:23:10.000Z');
    expect(entry.level).toBe('warn');
    expect(entry.message).toBe('High memory usage detected');
  });

  it('handles missing fields gracefully', () => {
    const lines = ['{"message":"no timestamp or level"}'];
    const entries = parseJsonLog(lines);
    expect(entries.length).toBe(1);
    expect(entries[0].message).toBe('no timestamp or level');
    expect(entries[0].level).toBe('info'); // default
    expect(entries[0].timestamp).toBeTruthy(); // should have some default
  });

  it('handles invalid JSON gracefully', () => {
    const lines = ['not json at all', '{"valid":"json","level":"info","message":"ok"}'];
    const entries = parseJsonLog(lines);
    // Should not crash, malformed lines still produce an entry with raw
    expect(entries.length).toBe(2);
    expect(entries[0].raw).toBe('not json at all');
    expect(entries[1].message).toBe('ok');
  });

  it('preserves raw original line', () => {
    const lines = readFixture('json.log').split('\n').filter(Boolean);
    const entries = parseJsonLog(lines);
    entries.forEach((entry, i) => {
      expect(entry.raw).toBe(lines[i]);
    });
  });
});

describe('parseDockerLog', () => {
  it('extracts timestamp and container info from Docker log format', () => {
    const lines = readFixture('docker.log').split('\n').filter(Boolean);
    const entries = parseDockerLog(lines);

    expect(entries.length).toBeGreaterThan(0);
    const first = entries[0];
    expect(first.timestamp).toContain('2024-03-07');
    expect(first.source).toBe('docker');
    expect(first.message).toContain('Starting application');
  });

  it('infers error level from stderr stream type', () => {
    const lines = readFixture('docker.log').split('\n').filter(Boolean);
    const entries = parseDockerLog(lines);

    const stderrEntry = entries.find(e => e.message.includes('ECONNREFUSED'));
    expect(stderrEntry?.level).toBe('error');

    const stdoutEntry = entries.find(e => e.message.includes('Starting application'));
    expect(stdoutEntry?.level).toBe('info');
  });

  it('preserves raw original line', () => {
    const lines = readFixture('docker.log').split('\n').filter(Boolean);
    const entries = parseDockerLog(lines);
    entries.forEach((entry, i) => {
      expect(entry.raw).toBe(lines[i]);
    });
  });

  it('handles malformed lines gracefully', () => {
    const lines = ['not a docker log line'];
    const entries = parseDockerLog(lines);
    expect(entries.length).toBe(1);
    expect(entries[0].raw).toBe('not a docker log line');
  });
});

describe('parseJournaldLog', () => {
  it('extracts fields from journald-style output', () => {
    const lines = readFixture('journald.log').split('\n').filter(Boolean);
    const entries = parseJournaldLog(lines);

    // Should skip the "-- Journal begins" header line
    expect(entries.length).toBeGreaterThan(0);
    const first = entries[0];
    expect(first.timestamp).toBeTruthy();
    expect(first.source).toContain('nginx');
    expect(first.message).toContain('upstream timed out');
  });

  it('extracts unit name as source', () => {
    const lines = readFixture('journald.log').split('\n').filter(Boolean);
    const entries = parseJournaldLog(lines);

    const dockerEntry = entries.find(e => e.message.includes('Container abc123'));
    expect(dockerEntry?.source).toContain('docker');
  });

  it('preserves raw original line', () => {
    const lines = readFixture('journald.log').split('\n').filter(Boolean);
    const entries = parseJournaldLog(lines);
    // entries skip header, so raw should match non-header lines
    entries.forEach(entry => {
      expect(entry.raw).toBeTruthy();
      expect(entry.raw).not.toContain('-- Journal begins');
    });
  });

  it('handles malformed lines gracefully', () => {
    const lines = ['garbage line', 'another garbage line'];
    const entries = parseJournaldLog(lines);
    expect(entries.length).toBe(2);
    entries.forEach((entry, i) => {
      expect(entry.raw).toBe(lines[i]);
    });
  });
});

describe('parseLog (unified dispatcher)', () => {
  it('dispatches to correct parser based on detected format', () => {
    const syslogText = readFixture('syslog.log');
    const result = parseLog(syslogText);
    expect(result.format).toBe(LogFormat.SYSLOG);
    expect(result.entries.length).toBeGreaterThan(0);

    const jsonText = readFixture('json.log');
    const jsonResult = parseLog(jsonText);
    expect(jsonResult.format).toBe(LogFormat.JSON);
    expect(jsonResult.entries.length).toBeGreaterThan(0);

    const dockerText = readFixture('docker.log');
    const dockerResult = parseLog(dockerText);
    expect(dockerResult.format).toBe(LogFormat.DOCKER);
    expect(dockerResult.entries.length).toBeGreaterThan(0);

    const journaldText = readFixture('journald.log');
    const journaldResult = parseLog(journaldText);
    expect(journaldResult.format).toBe(LogFormat.JOURNALD);
    expect(journaldResult.entries.length).toBeGreaterThan(0);
  });

  it('returns unparseable lines in the unparseable array', () => {
    // parseLog should track lines that couldn't be parsed
    const text = readFixture('syslog.log');
    const result = parseLog(text);
    expect(result.unparseable).toBeDefined();
    expect(Array.isArray(result.unparseable)).toBe(true);
  });
});
