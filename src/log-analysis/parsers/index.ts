import { LogFormat } from '../types.js';
import type { ParsedLog } from '../types.js';
import { detectLogFormat } from '../detector.js';
import { parseSyslog } from './syslog.js';
import { parseJsonLog } from './json.js';
import { parseDockerLog } from './docker.js';
import { parseJournaldLog } from './journald.js';

/**
 * Parse raw log text by auto-detecting the format and dispatching
 * to the appropriate parser.
 */
export function parseLog(text: string): ParsedLog {
  const format = detectLogFormat(text);
  const lines = text.split('\n').filter(Boolean);

  const parserMap: Record<LogFormat, (lines: string[]) => import('../types.js').LogEntry[]> = {
    [LogFormat.SYSLOG]: parseSyslog,
    [LogFormat.JSON]: parseJsonLog,
    [LogFormat.DOCKER]: parseDockerLog,
    [LogFormat.JOURNALD]: parseJournaldLog,
  };

  const parser = parserMap[format];
  const entries = parser(lines);

  // Track unparseable lines (entries where source is 'unknown' and message equals raw)
  const unparseable = entries
    .filter(e => e.source === 'unknown' && e.message === e.raw)
    .map(e => e.raw);

  return { format, entries, unparseable };
}
