import type { LogEntry } from '../types.js';

/**
 * Parse Docker container log format.
 * Format: "TIMESTAMP STREAM_TYPE message"
 * where TIMESTAMP is ISO8601 with nanoseconds and Z,
 * and STREAM_TYPE is stdout or stderr.
 */
export function parseDockerLog(lines: string[]): LogEntry[] {
  // Docker log: 2024-03-07T14:23:01.123456789Z stdout|stderr message
  const dockerPattern = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z)\s+(stdout|stderr)\s+(.*)$/;

  return lines.map(line => {
    const match = dockerPattern.exec(line);
    if (!match) {
      return {
        timestamp: new Date().toISOString(),
        level: 'info',
        message: line,
        source: 'docker',
        raw: line,
      };
    }

    const [, timestamp, streamType, message] = match;
    // stderr implies error level, stdout implies info
    const level = streamType === 'stderr' ? 'error' : 'info';

    return {
      timestamp,
      level,
      message,
      source: 'docker',
      raw: line,
    };
  });
}
