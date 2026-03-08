import type { LogEntry } from '../types.js';

/**
 * Parse BSD syslog format lines.
 * Format: "Mon DD HH:MM:SS hostname process[pid]: message"
 */
export function parseSyslog(lines: string[]): LogEntry[] {
  // BSD syslog: Mon DD HH:MM:SS hostname process[pid]: message
  const syslogPattern = /^(\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})\s+(\S+)\s+(\S+?)(?:\[(\d+)\])?:\s*(.*)$/;

  return lines.map(line => {
    const match = syslogPattern.exec(line);
    if (!match) {
      return {
        timestamp: new Date().toISOString(),
        level: inferLevelFromMessage(line),
        message: line,
        source: 'unknown',
        raw: line,
      };
    }

    const [, timestamp, _hostname, process, _pid, message] = match;
    // Strip trailing brackets from process name if present
    const source = process.replace(/\[.*$/, '').replace(/\/.*$/, '');

    return {
      timestamp: normalizeBsdTimestamp(timestamp),
      level: inferLevelFromMessage(message),
      message,
      source,
      raw: line,
    };
  });
}

function normalizeBsdTimestamp(bsdTs: string): string {
  // BSD syslog timestamps lack year; assume current year
  const year = new Date().getFullYear();
  const date = new Date(`${bsdTs} ${year}`);
  if (isNaN(date.getTime())) return bsdTs;
  return date.toISOString();
}

function inferLevelFromMessage(message: string): string {
  const lower = message.toLowerCase();
  if (/\berror\b/.test(lower) || /\bfatal\b/.test(lower) || /\bcrit(ical)?\b/.test(lower) || /\bfailed\b/.test(lower) || /\bsegfault\b/.test(lower)) {
    return 'error';
  }
  if (/\bwarn(ing)?\b/.test(lower)) return 'warn';
  if (/\bnotice\b/.test(lower)) return 'info';
  if (/\bdebug\b/.test(lower)) return 'debug';
  return 'info';
}
