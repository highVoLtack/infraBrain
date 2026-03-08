import type { LogEntry } from '../types.js';

/**
 * Parse JSON structured log lines.
 * Handles common field name variations: level/severity, msg/message,
 * time/timestamp/@timestamp, service/source.
 */
export function parseJsonLog(lines: string[]): LogEntry[] {
  return lines.map(line => {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(line);
    } catch {
      // Invalid JSON -- return raw entry
      return {
        timestamp: new Date().toISOString(),
        level: 'info',
        message: line,
        source: 'unknown',
        raw: line,
      };
    }

    const timestamp = extractString(parsed, 'timestamp', 'time', '@timestamp') || new Date().toISOString();
    const level = normalizeLevel(extractString(parsed, 'level', 'severity') || 'info');
    const message = extractString(parsed, 'message', 'msg') || JSON.stringify(parsed);
    const source = extractString(parsed, 'service', 'source', 'logger') || 'unknown';

    return { timestamp, level, message, source, raw: line };
  });
}

function extractString(obj: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    if (key in obj && obj[key] != null) return String(obj[key]);
  }
  return undefined;
}

function normalizeLevel(level: string): string {
  const lower = level.toLowerCase();
  if (lower === 'error' || lower === 'err' || lower === 'fatal' || lower === 'critical') return 'error';
  if (lower === 'warn' || lower === 'warning') return 'warn';
  if (lower === 'debug' || lower === 'trace') return 'debug';
  return 'info';
}
