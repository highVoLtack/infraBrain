import { verifyEffect } from './self-healer.js';
import type { SelfHealContext } from './types.js';

/**
 * Record of a config modification step detected during execution.
 * Tracked so we can re-verify persistence after container restarts.
 */
export interface ConfigModificationRecord {
  stepIndex: number;
  command: string;
  stepDescription: string;
}

/**
 * Result of verifying whether a config modification persisted after restart.
 */
export interface PersistenceVerificationResult {
  configMod: ConfigModificationRecord;
  verified: boolean;
  evidence?: string;
  reverted: boolean;
}

/**
 * Heuristic patterns that indicate a command modifies configuration.
 * Matches: sed, tee, echo/printf redirect, CONFIG SET, ALTER SYSTEM SET
 */
const CONFIG_MOD_PATTERNS = [
  /\bsed\b/i,                     // sed (with or without -i)
  /\btee\b/i,                     // tee to file
  /\becho\b.*>/i,                 // echo ... > file
  /\bprintf\b.*>/i,               // printf ... > file
  /\bconfig\s+set\b/i,            // Redis CONFIG SET
  /\balter\s+system\s+set\b/i,    // PostgreSQL ALTER SYSTEM SET
];

/**
 * Detect if a command modifies configuration files or settings.
 * Used to track config changes that need post-restart verification.
 */
export function isConfigModification(command: string): boolean {
  if (!command) return false;
  return CONFIG_MOD_PATTERNS.some(pattern => pattern.test(command));
}

/**
 * Heuristic patterns that indicate a container/service restart.
 * Matches: docker restart, docker compose restart, systemctl restart/reload
 */
const RESTART_PATTERNS = [
  /\bdocker\s+(?:compose\s+)?restart\b/i,
  /\bsystemctl\s+(?:restart|reload)\b/i,
  /\bservice\s+\S+\s+(?:restart|reload)\b/i,
];

/**
 * Detect if a command restarts or reloads a service/container.
 * When detected after config modifications, triggers persistence verification.
 */
export function isRestartStep(command: string): boolean {
  if (!command) return false;
  return RESTART_PATTERNS.some(pattern => pattern.test(command));
}

/**
 * Verify that config modifications persisted after a container restart.
 *
 * Waits `delayMs` for container stabilization, then calls verifyEffect
 * for each tracked config modification. If verification fails, marks
 * the change as reverted so the executor can retry with a persistent approach.
 *
 * Fail-open: if verifyEffect skips (can't generate verification command),
 * the config mod is treated as verified (not flagged for retry).
 */
export async function verifyPersistence(
  configMods: ConfigModificationRecord[],
  healContext: SelfHealContext,
  delayMs: number,
): Promise<PersistenceVerificationResult[]> {
  if (configMods.length === 0) return [];

  // Wait for container stabilization after restart
  if (delayMs > 0) {
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }

  const results: PersistenceVerificationResult[] = [];

  for (const configMod of configMods) {
    const verification = await verifyEffect(configMod.command, healContext);

    results.push({
      configMod,
      verified: verification.verified,
      evidence: verification.evidence,
      reverted: !verification.verified,
    });
  }

  return results;
}
