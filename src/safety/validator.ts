import { RiskLevel, type ValidationResult, type SafetyConfig } from './types.js';
import { BLOCKED_PATTERNS } from './rules.js';
import { classifyCommand } from './classifier.js';

/**
 * Validate a command against safety rules.
 *
 * Validation order:
 * 1. Check hardcoded BLOCKED_PATTERNS (always blocked)
 * 2. Check config blocklist patterns (if provided)
 * 3. If config allowlist exists, command must match at least one pattern
 * 4. Classify via classifyCommand and return result
 */
export function validateCommand(
  command: string,
  config?: SafetyConfig,
): ValidationResult {
  // Step 1: Hardcoded blocked patterns (always enforced)
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(command)) {
      return {
        allowed: false,
        riskLevel: RiskLevel.BLOCKED,
        reason: 'Command blocked by hardcoded safety rule',
        command,
      };
    }
  }

  // Step 2: Config blocklist patterns
  if (config?.blocklist) {
    for (const patternStr of config.blocklist) {
      const pattern = new RegExp(patternStr);
      if (pattern.test(command)) {
        return {
          allowed: false,
          riskLevel: RiskLevel.BLOCKED,
          reason: `Command blocked by blocklist pattern: ${patternStr}`,
          command,
        };
      }
    }
  }

  // Step 3: Config allowlist -- command must match at least one pattern
  if (config?.allowlist && config.allowlist.length > 0) {
    const allowed = config.allowlist.some((patternStr) => {
      const pattern = new RegExp(patternStr);
      return pattern.test(command);
    });
    if (!allowed) {
      return {
        allowed: false,
        riskLevel: RiskLevel.BLOCKED,
        reason: 'Command not in allowlist',
        command,
      };
    }
  }

  // Step 4: Classify via classifyCommand
  const riskLevel = classifyCommand(command);

  return {
    allowed: true,
    riskLevel,
    command,
  };
}
