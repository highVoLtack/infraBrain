import type { FixStep } from '../orchestrator/types.js';
import type { RunResult, SelfHealResult, SelfHealContext } from './types.js';

/**
 * Build a correction prompt for the LLM given a failed command context.
 */
export function buildCorrectionPrompt(_ctx: {
  originalCommand: string;
  stderr: string;
  exitCode: number;
  stepDescription: string;
  availableTools: string;
  containerContext: string;
}): string {
  throw new Error('Not implemented');
}

/**
 * Build a prompt asking LLM for a read-only verification command.
 */
export function buildEffectVerificationPrompt(_ctx: {
  correctedCommand: string;
  stepDescription: string;
  containerContext: string;
}): string {
  throw new Error('Not implemented');
}

/**
 * Extract a clean command from LLM response text.
 * Strips markdown fences, prose prefixes, and whitespace.
 */
export function extractCommandFromLLMResponse(_text: string): string {
  throw new Error('Not implemented');
}

/**
 * Validate a corrected command through the full safety pipeline.
 */
export async function validateCorrectedCommand(
  _command: string,
  _context: SelfHealContext,
): Promise<{ allowed: boolean; command?: string; reason?: string }> {
  throw new Error('Not implemented');
}

/**
 * Verify the effect of a corrected command via a read-only check.
 */
export async function verifyEffect(
  _correctedCommand: string,
  _context: SelfHealContext,
): Promise<{ verified: boolean; evidence?: string; reason?: string; skipped?: boolean }> {
  throw new Error('Not implemented');
}

/**
 * Self-healing step: retry a failed command with LLM-corrected alternatives.
 */
export async function selfHealStep(
  _step: FixStep,
  _failedResult: RunResult,
  _context: SelfHealContext,
): Promise<SelfHealResult> {
  throw new Error('Not implemented');
}
