/**
 * Regex pre-processor + worker model fallback for unknown formats.
 * Runs on discovery output before context injection to remove noise.
 */

import type { LanguageModel } from 'ai';
import { generateObject } from 'ai';
import { z } from 'zod';

/** Hardcoded core noise patterns for common infrastructure noise. */
export const NOISE_PATTERNS: RegExp[] = [
  // Docker healthcheck spam
  /health_status:\s*(healthy|unhealthy)/i,
  /healthcheck.*passed|healthcheck.*failed/i,
  // systemd boilerplate
  /Started\s+.*\.service/,
  /Stopped\s+.*\.service/,
  /systemd\[\d+\]:\s+Starting\s+/,
  /systemd\[\d+\]:\s+Reached target\s+/,
  // Journal metadata noise
  /-- Logs begin at/,
  /-- No entries --/,
  /-- Journal has been rotated/,
  // Empty/whitespace lines in command output
  /^\s*$/,
];

/** Minimum unrecognized lines threshold before invoking worker model. */
const WORKER_MODEL_THRESHOLD = 10;

export interface FilterResult {
  filtered: Record<string, string>;
  removedCount: number;
  workerModelUsed: boolean;
}

/**
 * Filter noise from discovery output.
 *
 * @param discoveryRaw - Raw discovery output keyed by command label
 * @param skillPatterns - Additional noise patterns from skill frontmatter (compiled to RegExp)
 * @param workerModel - Optional worker model for relevance scoring of unknown formats
 */
export async function filterNoise(
  discoveryRaw: Record<string, string>,
  skillPatterns: string[] = [],
  workerModel?: LanguageModel,
): Promise<FilterResult> {
  // Compile skill patterns to RegExp at call time
  const compiledSkillPatterns = skillPatterns.map((p) => new RegExp(p));
  const allPatterns = [...NOISE_PATTERNS, ...compiledSkillPatterns];

  const filtered: Record<string, string> = {};
  let totalRemoved = 0;
  let workerModelUsed = false;

  for (const [key, value] of Object.entries(discoveryRaw)) {
    const lines = value.split('\n');
    const kept: string[] = [];
    const unrecognized: string[] = [];

    for (const line of lines) {
      const isNoise = allPatterns.some((pattern) => pattern.test(line));
      if (isNoise) {
        totalRemoved++;
      } else {
        unrecognized.push(line);
      }
    }

    // Decide whether to invoke worker model for unrecognized lines
    if (
      unrecognized.length >= WORKER_MODEL_THRESHOLD &&
      workerModel != null
    ) {
      workerModelUsed = true;
      try {
        const { object } = await generateObject({
          model: workerModel,
          schema: z.object({
            relevant: z.array(z.string()),
          }),
          prompt: `You are an infrastructure diagnosis assistant. Given these log/command output lines, return ONLY the lines relevant to diagnosing infrastructure problems. Discard noise, status messages, and irrelevant output.\n\nLines:\n${unrecognized.map((l, i) => `${i}: ${l}`).join('\n')}`,
        });

        const relevantSet = new Set(object.relevant);
        for (const line of unrecognized) {
          if (relevantSet.has(line)) {
            kept.push(line);
          } else {
            totalRemoved++;
          }
        }
      } catch {
        // If worker model fails, include all unrecognized lines
        kept.push(...unrecognized);
      }
    } else {
      // Below threshold or no worker model -- include all unrecognized lines
      kept.push(...unrecognized);
    }

    filtered[key] = kept.join('\n');
  }

  return { filtered, removedCount: totalRemoved, workerModelUsed };
}
