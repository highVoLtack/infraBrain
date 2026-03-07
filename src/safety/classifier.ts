import { RiskLevel, type ClassificationRule } from './types.js';
import { BLOCKED_PATTERNS, DEFAULT_RULES } from './rules.js';

/**
 * Classify a command's risk level.
 *
 * Order of evaluation:
 * 1. BLOCKED_PATTERNS (hardcoded, never overridable)
 * 2. customRules if provided, else DEFAULT_RULES
 * 3. Unknown commands default to WRITE (safe default)
 */
export function classifyCommand(
  command: string,
  customRules?: ClassificationRule[],
): RiskLevel {
  // Always check blocked patterns first -- non-overridable
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(command)) return RiskLevel.BLOCKED;
  }

  // Check custom rules if provided, otherwise default rules
  const rules = customRules ?? DEFAULT_RULES;
  for (const rule of rules) {
    if (rule.pattern.test(command)) return rule.level;
  }

  // Unknown commands default to WRITE (safe default per user decision)
  return RiskLevel.WRITE;
}
