export enum RiskLevel {
  READ = 'read',
  WRITE = 'write',
  DESTRUCTIVE = 'destructive',
  BLOCKED = 'blocked',
}

export interface ClassificationRule {
  pattern: RegExp;
  level: RiskLevel;
}

export interface ValidationResult {
  allowed: boolean;
  riskLevel: RiskLevel;
  reason?: string;
  command: string;
}

export interface SafetyConfig {
  allowlist?: string[];
  blocklist?: string[];
  customRules?: Array<{ pattern: string; level: string }>;
}
