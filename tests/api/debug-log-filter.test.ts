import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the log-analysis modules before importing the function under test
vi.mock('../../src/log-analysis/parsers/index.js', () => ({
  parseLog: vi.fn(),
}));
vi.mock('../../src/log-analysis/filter.js', () => ({
  preFilterLogs: vi.fn(),
  formatForLLM: vi.fn(),
}));

import { preFilterIfLogHeavy } from '../../src/orchestrator/diagnosis.js';
import { parseLog } from '../../src/log-analysis/parsers/index.js';
import { preFilterLogs, formatForLLM } from '../../src/log-analysis/filter.js';
import type { LogFormat } from '../../src/log-analysis/types.js';

const mockParseLog = vi.mocked(parseLog);
const mockPreFilterLogs = vi.mocked(preFilterLogs);
const mockFormatForLLM = vi.mocked(formatForLLM);

describe('preFilterIfLogHeavy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('detects log-heavy prompt with 5+ lines and 3+ indicators', () => {
    const logLines = [
      '2024-01-15T10:00:00Z ERROR nginx: upstream timeout',
      '2024-01-15T10:00:01Z WARN nginx: retry attempt 1',
      '2024-01-15T10:00:02Z ERROR nginx: upstream timeout again',
      '2024-01-15T10:00:03Z INFO nginx: reconnecting',
      '2024-01-15T10:00:04Z DEBUG nginx: health check',
    ];
    const prompt = logLines.join('\n');

    const mockEntries = logLines.map((line, i) => ({
      timestamp: `2024-01-15T10:00:0${i}Z`,
      level: ['error', 'warn', 'error', 'info', 'debug'][i],
      source: 'nginx',
      message: `msg ${i}`,
      raw: line,
    }));

    mockParseLog.mockReturnValue({
      format: 'syslog' as unknown as LogFormat,
      entries: mockEntries,
      unparseable: [],
    });
    mockPreFilterLogs.mockReturnValue({
      filtered: mockEntries,
      truncated: false,
    });
    mockFormatForLLM.mockReturnValue('formatted-log-output');

    const result = preFilterIfLogHeavy(prompt);

    expect(result.wasFiltered).toBe(true);
    expect(result.filtered).toContain('Pre-filtered logs:');
    expect(result.filtered).toContain('formatted-log-output');
    expect(mockParseLog).toHaveBeenCalled();
    expect(mockPreFilterLogs).toHaveBeenCalled();
    expect(mockFormatForLLM).toHaveBeenCalled();
  });

  it('does NOT detect prompt with fewer than 5 lines', () => {
    const prompt = '2024-01-15T10:00:00Z ERROR nginx: timeout\nPlease help';

    const result = preFilterIfLogHeavy(prompt);

    expect(result.wasFiltered).toBe(false);
    expect(result.filtered).toBe(prompt);
    expect(mockParseLog).not.toHaveBeenCalled();
  });

  it('does NOT detect prompt with lines but no log indicators', () => {
    const prompt = [
      'My server is broken',
      'It started yesterday',
      'Nothing seems to work',
      'I restarted it twice',
      'Still having problems',
    ].join('\n');

    const result = preFilterIfLogHeavy(prompt);

    expect(result.wasFiltered).toBe(false);
    expect(result.filtered).toBe(prompt);
    expect(mockParseLog).not.toHaveBeenCalled();
  });

  it('calls parseLog + preFilterLogs + formatForLLM on log-heavy prompt', () => {
    const logLines = [
      '2024-01-15T10:00:00Z ERROR svc: fail1',
      '2024-01-15T10:00:01Z WARN svc: fail2',
      '2024-01-15T10:00:02Z ERROR svc: fail3',
      '2024-01-15T10:00:03Z INFO svc: ok',
      '2024-01-15T10:00:04Z ERROR svc: fail4',
    ];
    const prompt = logLines.join('\n');

    const mockEntries = logLines.map((line, i) => ({
      timestamp: `2024-01-15T10:00:0${i}Z`,
      level: 'error',
      source: 'svc',
      message: `msg${i}`,
      raw: line,
    }));

    mockParseLog.mockReturnValue({
      format: 'syslog' as unknown as LogFormat,
      entries: mockEntries,
      unparseable: [],
    });
    mockPreFilterLogs.mockReturnValue({
      filtered: mockEntries.slice(0, 3),
      truncated: false,
    });
    mockFormatForLLM.mockReturnValue('filtered output');

    preFilterIfLogHeavy(prompt);

    expect(mockParseLog).toHaveBeenCalledOnce();
    expect(mockPreFilterLogs).toHaveBeenCalledWith({ entries: mockEntries });
    expect(mockFormatForLLM).toHaveBeenCalledWith(mockEntries.slice(0, 3));
  });

  it('falls back to raw prompt when unparseable > entries', () => {
    const logLines = [
      '2024-01-15T10:00:00Z ERROR svc: fail1',
      '2024-01-15T10:00:01Z WARN svc: fail2',
      '2024-01-15T10:00:02Z ERROR svc: fail3',
      '2024-01-15T10:00:03Z INFO svc: ok',
      '2024-01-15T10:00:04Z ERROR svc: fail4',
    ];
    const prompt = logLines.join('\n');

    // More unparseable than entries = heuristic failed
    mockParseLog.mockReturnValue({
      format: 'syslog' as unknown as LogFormat,
      entries: [{ timestamp: '', level: '', source: '', message: '', raw: '' }],
      unparseable: ['bad1', 'bad2', 'bad3'],
    });

    const result = preFilterIfLogHeavy(prompt);

    expect(result.wasFiltered).toBe(false);
    expect(result.filtered).toBe(prompt);
    expect(mockPreFilterLogs).not.toHaveBeenCalled();
  });

  it('non-log prompt passes through unchanged', () => {
    const prompt = 'How do I configure nginx reverse proxy for my app?';

    const result = preFilterIfLogHeavy(prompt);

    expect(result.wasFiltered).toBe(false);
    expect(result.filtered).toBe(prompt);
  });

  it('preserves context lines (non-log) alongside pre-filtered logs', () => {
    const contextLine = 'My nginx is failing with these errors:';
    const logLines = [
      '2024-01-15T10:00:00Z ERROR nginx: upstream timeout',
      '2024-01-15T10:00:01Z WARN nginx: retry',
      '2024-01-15T10:00:02Z ERROR nginx: fail',
      '2024-01-15T10:00:03Z INFO nginx: reconnect',
      '2024-01-15T10:00:04Z ERROR nginx: fail again',
    ];
    const prompt = [contextLine, ...logLines].join('\n');

    const mockEntries = logLines.map((line, i) => ({
      timestamp: `2024-01-15T10:00:0${i}Z`,
      level: 'error',
      source: 'nginx',
      message: `msg${i}`,
      raw: line,
    }));

    mockParseLog.mockReturnValue({
      format: 'syslog' as unknown as LogFormat,
      entries: mockEntries,
      unparseable: [],
    });
    mockPreFilterLogs.mockReturnValue({
      filtered: mockEntries,
      truncated: false,
    });
    mockFormatForLLM.mockReturnValue('formatted output');

    const result = preFilterIfLogHeavy(prompt);

    expect(result.wasFiltered).toBe(true);
    // Context lines should be preserved
    expect(result.filtered).toContain(contextLine);
    expect(result.filtered).toContain('formatted output');
  });
});
