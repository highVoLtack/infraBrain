import { RiskLevel, type ValidationResult, type SafetyConfig } from './types.js';
import { BLOCKED_PATTERNS } from './rules.js';
import { classifyCommand } from './classifier.js';

/**
 * Package manager commands that InfraBrain must never suggest.
 * InfraBrain is a surgeon, not a package manager.
 */
const PACKAGE_MANAGER_PATTERN = /\b(apt|apt-get|yum|dnf|apk|pacman|zypper|brew)\s+(install|update|upgrade|remove)\b/;

/**
 * Sanitize docker exec commands: strip -it/-t flags that cause TTY errors
 * when running non-interactively. Returns the sanitized command.
 */
export function sanitizeDockerExec(command: string): string {
  // Match docker exec with -it, -i -t, -ti, -t, or combinations with other flags
  if (/^docker\s+exec\b/.test(command)) {
    // Remove standalone -it, -ti flags
    let sanitized = command.replace(/\s+-it\b/, '');
    sanitized = sanitized.replace(/\s+-ti\b/, '');
    // Remove standalone -t flag (but not -t inside longer flags like --timeout)
    sanitized = sanitized.replace(/\s+-t\b(?!\w)/, '');
    // Remove -i flag if standalone
    sanitized = sanitized.replace(/\s+-i\b(?!\w)/, '');
    // Clean up any double spaces left behind
    sanitized = sanitized.replace(/\s{2,}/g, ' ').trim();
    return sanitized;
  }
  return command;
}

/**
 * Validate a command against safety rules.
 *
 * Validation order:
 * 1. Sanitize docker exec commands (strip TTY flags)
 * 2. Check hardcoded BLOCKED_PATTERNS (always blocked)
 * 3. Check package manager commands (always blocked)
 * 4. Check config blocklist patterns (if provided)
 * 5. If config allowlist exists, command must match at least one pattern
 * 6. Classify via classifyCommand and return result
 */
export function validateCommand(
  command: string,
  config?: SafetyConfig,
): ValidationResult {
  // Step 1: Sanitize docker exec commands (strip -it/-t flags)
  const sanitized = sanitizeDockerExec(command);

  // Step 2: Hardcoded blocked patterns (always enforced)
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(sanitized)) {
      return {
        allowed: false,
        riskLevel: RiskLevel.BLOCKED,
        reason: 'Command blocked by hardcoded safety rule',
        command: sanitized,
      };
    }
  }

  // Step 3: Block package manager commands
  if (PACKAGE_MANAGER_PATTERN.test(sanitized)) {
    return {
      allowed: false,
      riskLevel: RiskLevel.BLOCKED,
      reason: 'Package manager commands are forbidden. InfraBrain diagnoses and fixes, not installs.',
      command: sanitized,
    };
  }

  // Step 4: Config blocklist patterns
  if (config?.blocklist) {
    for (const patternStr of config.blocklist) {
      const pattern = new RegExp(patternStr);
      if (pattern.test(sanitized)) {
        return {
          allowed: false,
          riskLevel: RiskLevel.BLOCKED,
          reason: `Command blocked by blocklist pattern: ${patternStr}`,
          command: sanitized,
        };
      }
    }
  }

  // Step 5: Config allowlist -- command must match at least one pattern
  if (config?.allowlist && config.allowlist.length > 0) {
    const allowed = config.allowlist.some((patternStr) => {
      const pattern = new RegExp(patternStr);
      return pattern.test(sanitized);
    });
    if (!allowed) {
      return {
        allowed: false,
        riskLevel: RiskLevel.BLOCKED,
        reason: 'Command not in allowlist',
        command: sanitized,
      };
    }
  }

  // Step 6: Classify via classifyCommand
  let riskLevel = classifyCommand(sanitized);

  // Step 7: Risk level auto-override for known dangerous functions
  // pg_terminate_backend is always WRITE regardless of LLM classification
  if (/pg_terminate_backend/i.test(sanitized)) {
    riskLevel = RiskLevel.WRITE;
  }

  return {
    allowed: true,
    riskLevel,
    command: sanitized,
  };
}
