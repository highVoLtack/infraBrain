import type { LogEntry } from '../types.js';

/**
 * Parse journalctl output format.
 * Format: "Mon DD HH:MM:SS hostname unit.service[pid]: message"
 * Skips "-- Journal begins" header lines.
 */
export function parseJournaldLog(lines: string[]): LogEntry[] {
  // journald: Mon DD HH:MM:SS hostname unit[pid]: message
  const journaldPattern = /^(\w{3}\s+\d{2}\s+\d{2}:\d{2}:\d{2})\s+(\S+)\s+(\S+?)(?:\[(\d+)\])?:\s*(.*)$/;
  const headerPattern = /^-- Journal begins/;

  return lines
    .filter(line => !headerPattern.test(line))
    .map(line => {
      const match = journaldPattern.exec(line);
      if (!match) {
        return {
          timestamp: new Date().toISOString(),
          level: inferLevel(line),
          message: line,
          source: 'unknown',
          raw: line,
        };
      }

      const [, timestamp, _hostname, unit, _pid, message] = match;
      // Extract service name: strip .service suffix
      const source = unit.replace(/\.service$/, '');

      return {
        timestamp: normalizeJournaldTimestamp(timestamp),
        level: inferLevel(message),
        message,
        source,
        raw: line,
      };
    });
}

function normalizeJournaldTimestamp(ts: string): string {
  const year = new Date().getFullYear();
  const date = new Date(`${ts} ${year}`);
  if (isNaN(date.getTime())) return ts;
  return date.toISOString();
}

function inferLevel(message: string): string {
  const lower = message.toLowerCase();
  if (/\berror\b/.test(lower) || /\bfatal\b/.test(lower) || /\bsegfault\b/.test(lower) || /\bfailed\b/.test(lower) || /\bcrash(ed)?\b/.test(lower)) {
    return 'error';
  }
  if (/\bwarn(ing)?\b/.test(lower)) return 'warn';
  if (/\bdebug\b/.test(lower)) return 'debug';
  return 'info';
}
