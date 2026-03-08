import { LogFormat } from './types.js';

/**
 * Auto-detect log format from a sample of log text.
 * Heuristics applied in order: JSON, Docker, journald, syslog (default).
 */
export function detectLogFormat(sample: string): LogFormat {
  const lines = sample.split('\n').filter(Boolean);
  if (lines.length === 0) return LogFormat.SYSLOG;

  // Sample first few non-empty lines for detection
  const sampleLines = lines.slice(0, 5);

  // JSON: first content line starts with {
  if (sampleLines.some(line => line.trimStart().startsWith('{'))) {
    return LogFormat.JSON;
  }

  // Docker: ISO8601 timestamp ending with Z followed by stdout/stderr
  const dockerPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z\s+(stdout|stderr)\s/;
  if (sampleLines.some(line => dockerPattern.test(line))) {
    return LogFormat.DOCKER;
  }

  // Journald: "-- Journal begins" header or systemd unit pattern (hostname unit.service[pid]:)
  const journaldHeader = /^-- Journal begins/;
  const journaldUnit = /^\w{3}\s+\d{2}\s+\d{2}:\d{2}:\d{2}\s+\S+\s+\S+\.service\[/;
  if (sampleLines.some(line => journaldHeader.test(line) || journaldUnit.test(line))) {
    return LogFormat.JOURNALD;
  }

  // Syslog: BSD-style "Mon DD HH:MM:SS hostname"
  const syslogPattern = /^\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\S+\s+\S+/;
  if (sampleLines.some(line => syslogPattern.test(line))) {
    return LogFormat.SYSLOG;
  }

  // Default to syslog for unrecognized formats
  return LogFormat.SYSLOG;
}
