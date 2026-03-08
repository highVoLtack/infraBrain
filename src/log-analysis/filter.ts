import type { LogEntry } from './types.js';

export interface PreFilterOptions {
  entries: LogEntry[];
  /** Maximum number of lines to return. Default: 200 (~4K token budget) */
  maxLines?: number;
  /** Filter by log level (case-insensitive) */
  levelFilter?: string;
}

export interface PreFilterResult {
  filtered: LogEntry[];
  truncated: boolean;
  message?: string;
}

/**
 * Pre-filter log entries for LLM consumption within token budget.
 * Supports level filtering and truncation to maxLines (keeping most recent entries).
 */
export function preFilterLogs(options: PreFilterOptions): PreFilterResult {
  const { entries, maxLines = 200, levelFilter } = options;

  // Apply level filter if provided
  let filtered = entries;
  if (levelFilter) {
    const normalizedFilter = levelFilter.toLowerCase();
    filtered = entries.filter(e => e.level.toLowerCase() === normalizedFilter);
  }

  // Zero matches
  if (filtered.length === 0) {
    return { filtered: [], truncated: false, message: 'No matching log entries found' };
  }

  // Truncate to maxLines, keeping most recent (last) entries
  if (filtered.length > maxLines) {
    const truncated = filtered.slice(filtered.length - maxLines);
    return {
      filtered: truncated,
      truncated: true,
      message: `Showing ${maxLines} of ${filtered.length} matches`,
    };
  }

  return { filtered, truncated: false };
}

/**
 * Format log entries as plain text suitable for LLM prompt injection.
 * Format: "TIMESTAMP [LEVEL] SOURCE: MESSAGE" one per line.
 */
export function formatForLLM(entries: LogEntry[]): string {
  return entries
    .map(e => `${e.timestamp} [${e.level}] ${e.source}: ${e.message}`)
    .join('\n');
}
