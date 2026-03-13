import { expect } from 'vitest';
import type { AuditEntry, AuditEventType } from '../../../src/audit/types.js';

/**
 * DPEV phase mapping: maps audit event types to their DPEV phase letter.
 *
 * S = Skill selection (routing)
 * D = Decision (diagnosis + plan)
 * E = Execution (start, steps, complete)
 * V = Verification (post-execution verification)
 */
const DPEV_PHASE_MAP: Partial<Record<AuditEventType, string>> = {
  skill_selection: 'S',
  decision: 'D',
  execution_start: 'E',
  step_complete: 'E',
  execution_complete: 'E',
  verification: 'V',
};

/** Ordered DPEV phases. Index determines valid ordering. */
const PHASE_ORDER = ['S', 'D', 'E', 'V'];

/**
 * Validates that audit entries follow the DPEV phase ordering.
 *
 * 1. Sorts entries by timestamp ASC (queryAuditLog returns DESC order).
 * 2. Filters to DPEV-relevant event types only.
 * 3. Verifies monotonic phase ordering (same phase can repeat, never go backwards).
 * 4. Verifies all 4 phases (S, D, E, V) are present.
 */
export function assertDPEVSequence(entries: AuditEntry[]): void {
  // Sort by timestamp ascending (queryAuditLog returns DESC)
  const sorted = [...entries].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );

  // Filter to DPEV-relevant events and map to phase letters
  const phases = sorted
    .filter((e) => e.eventType in DPEV_PHASE_MAP)
    .map((e) => DPEV_PHASE_MAP[e.eventType]!);

  // Verify all 4 DPEV phases are present
  const uniquePhases = new Set(phases);
  for (const required of PHASE_ORDER) {
    expect(uniquePhases.has(required)).toBe(true);
  }

  // Verify monotonic ordering: phase index never decreases
  let maxIndex = -1;
  for (const phase of phases) {
    const idx = PHASE_ORDER.indexOf(phase);
    expect(idx).toBeGreaterThanOrEqual(maxIndex);
    maxIndex = idx;
  }
}
