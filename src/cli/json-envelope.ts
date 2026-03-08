/**
 * JSON output envelope for CLI --json mode.
 * All CLI commands use this consistent shape for machine-parseable output.
 */
export interface JsonEnvelope<T> {
  ok: boolean;
  command: string;
  data: T;
  error: string | null;
}

/**
 * Wrap a successful command result in a JSON envelope.
 */
export function envelope<T>(command: string, data: T): JsonEnvelope<T> {
  return { ok: true, command, data, error: null };
}

/**
 * Wrap a command error in a JSON envelope.
 */
export function errorEnvelope(command: string, error: string): JsonEnvelope<null> {
  return { ok: false, command, data: null, error };
}
