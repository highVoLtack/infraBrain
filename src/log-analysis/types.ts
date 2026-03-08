export enum LogFormat {
  SYSLOG = 'syslog',
  JSON = 'json',
  DOCKER = 'docker',
  JOURNALD = 'journald',
}

export interface LogEntry {
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Normalized level: error, warn, info, debug */
  level: string;
  /** Log message content */
  message: string;
  /** Source process/service name */
  source: string;
  /** Original raw log line */
  raw: string;
}

export interface ParsedLog {
  format: LogFormat;
  entries: LogEntry[];
  unparseable: string[];
}
