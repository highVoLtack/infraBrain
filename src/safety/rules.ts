import { readFileSync } from 'node:fs';
import { RiskLevel, type ClassificationRule } from './types.js';

/**
 * Hardcoded blocked patterns -- non-overridable, belt-and-suspenders safety.
 * These are ALWAYS checked regardless of config or custom rules.
 */
export const BLOCKED_PATTERNS: RegExp[] = [
  /rm\s+-rf\s+\/(?:\s|$)/,          // rm -rf /
  /mkfs\./,                           // format filesystem
  /dd\s+if=.*of=\/dev\//,            // dd to device
  /:\(\)\s*\{\s*:\|:&\s*\}\s*;:/,    // fork bomb
  /chmod\s+-R\s+777\s+\//,           // chmod 777 /
];

/**
 * Default classification rules for command risk levels.
 * Can be overridden by custom rules from config.
 */
export const DEFAULT_RULES: ClassificationRule[] = [
  // Read-only
  { pattern: /^docker\s+ps/, level: RiskLevel.READ },
  { pattern: /^docker\s+logs\s+/, level: RiskLevel.READ },
  { pattern: /^docker\s+inspect\s+/, level: RiskLevel.READ },
  { pattern: /^cat\s+/, level: RiskLevel.READ },
  { pattern: /^ls\s+/, level: RiskLevel.READ },
  { pattern: /^systemctl\s+status\s+/, level: RiskLevel.READ },
  { pattern: /^head\s+/, level: RiskLevel.READ },
  { pattern: /^tail\s+/, level: RiskLevel.READ },
  { pattern: /^grep\s+/, level: RiskLevel.READ },
  { pattern: /^df\s*/, level: RiskLevel.READ },
  { pattern: /^free\s*/, level: RiskLevel.READ },
  { pattern: /^uptime/, level: RiskLevel.READ },
  { pattern: /^whoami/, level: RiskLevel.READ },
  { pattern: /^hostname/, level: RiskLevel.READ },
  { pattern: /^id\b/, level: RiskLevel.READ },
  { pattern: /^stat\s+/, level: RiskLevel.READ },
  // Write
  { pattern: /^docker\s+restart\s+/, level: RiskLevel.WRITE },
  { pattern: /^docker\s+start\s+/, level: RiskLevel.WRITE },
  { pattern: /^docker\s+stop\s+/, level: RiskLevel.WRITE },
  { pattern: /^systemctl\s+restart\s+/, level: RiskLevel.WRITE },
  { pattern: /^systemctl\s+start\s+/, level: RiskLevel.WRITE },
  { pattern: /^systemctl\s+stop\s+/, level: RiskLevel.WRITE },
  { pattern: /^systemctl\s+reload\s+/, level: RiskLevel.WRITE },
  { pattern: /^docker\s+exec\s+/, level: RiskLevel.WRITE },
  { pattern: /^chown\s+/, level: RiskLevel.WRITE },
  { pattern: /^chmod\s+/, level: RiskLevel.WRITE },
  // Destructive
  { pattern: /^docker\s+rm\s+/, level: RiskLevel.DESTRUCTIVE },
  { pattern: /^docker\s+rmi\s+/, level: RiskLevel.DESTRUCTIVE },
  { pattern: /^rm\s+/, level: RiskLevel.DESTRUCTIVE },
];

export interface CustomRulesResult {
  rules?: ClassificationRule[];
  blocklist?: RegExp[];
  allowlist?: RegExp[];
}

/**
 * Load custom safety rules from a config file.
 * Returns empty object if file does not exist (graceful fallback).
 */
export function loadCustomRules(configPath: string): CustomRulesResult {
  let raw: string;
  try {
    raw = readFileSync(configPath, 'utf-8');
  } catch {
    return {};
  }

  try {
    const config = JSON.parse(raw);
    const safety = config.safety;
    if (!safety) return {};

    const result: CustomRulesResult = {};

    if (Array.isArray(safety.customRules)) {
      result.rules = safety.customRules.map((r: { pattern: string; level: string }) => ({
        pattern: new RegExp(r.pattern),
        level: r.level as RiskLevel,
      }));
    }

    if (Array.isArray(safety.blocklist)) {
      result.blocklist = safety.blocklist.map((p: string) => new RegExp(p));
    }

    if (Array.isArray(safety.allowlist)) {
      result.allowlist = safety.allowlist.map((p: string) => new RegExp(p));
    }

    return result;
  } catch {
    return {};
  }
}
