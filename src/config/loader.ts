import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { InfraBrainConfigSchema, type InfraBrainConfig } from './types.js';
import { DEFAULT_CONFIG } from './defaults.js';

/** Load .env file into process.env (no dependency needed) */
function loadEnvFile(baseDir: string): void {
  try {
    const envPath = join(baseDir, '.env');
    const content = readFileSync(envPath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex === -1) continue;
      const key = trimmed.slice(0, eqIndex).trim();
      let value = trimmed.slice(eqIndex + 1).trim();
      // Strip surrounding quotes
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    // .env not found — fine, env vars may come from shell
  }
}

/** Replace ${ENV_VAR} placeholders in a JSON string with process.env values */
function resolveEnvVars(raw: string): string {
  return raw.replace(/\$\{(\w+)\}/g, (_match, varName) => {
    return process.env[varName] ?? '';
  });
}

/**
 * Load InfraBrain config from .infrabrain/config.json in the given base directory.
 * If the config file does not exist, returns defaults silently.
 * Supports ${ENV_VAR} placeholders in config values (resolved from .env + process.env).
 */
export function loadConfig(baseDir: string): InfraBrainConfig {
  loadEnvFile(baseDir);

  const configPath = join(baseDir, '.infrabrain', 'config.json');

  let raw: string;
  try {
    raw = readFileSync(configPath, 'utf-8');
  } catch {
    return { ...DEFAULT_CONFIG };
  }

  try {
    const resolved = resolveEnvVars(raw);
    const parsed = JSON.parse(resolved);
    return InfraBrainConfigSchema.parse(parsed);
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}
