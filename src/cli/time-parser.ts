/**
 * Parse relative or absolute time input into ISO 8601 string.
 * Supports: '1h ago', '30m ago', '2d ago', '10s ago', and ISO 8601 strings.
 */
export function parseTimeInput(input: string): string {
  // Try parsing as ISO / Date-parseable string first
  const date = new Date(input);
  if (!isNaN(date.getTime())) {
    return date.toISOString();
  }

  // Try relative format: <number><unit> [ago]
  const match = input.match(/^(\d+)\s*(s|m|h|d)\s*(?:ago)?$/i);
  if (match) {
    const amount = parseInt(match[1], 10);
    const unit = match[2].toLowerCase();
    const multipliers: Record<string, number> = {
      s: 1000,
      m: 60000,
      h: 3600000,
      d: 86400000,
    };
    return new Date(Date.now() - amount * multipliers[unit]).toISOString();
  }

  throw new Error(
    `Invalid time input: "${input}". Use relative format (e.g., "1h ago", "30m ago") or ISO 8601 string.`
  );
}
