import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { InfraBrainConfigSchema, type InfraBrainConfig } from './types.js';
import { DEFAULT_CONFIG } from './defaults.js';

/**
 * Load InfraBrain config from .infrabrain/config.json in the given base directory.
 * If the config file does not exist, returns defaults silently.
 */
export function loadConfig(baseDir: string): InfraBrainConfig {
  const configPath = join(baseDir, '.infrabrain', 'config.json');

  let raw: string;
  try {
    raw = readFileSync(configPath, 'utf-8');
  } catch {
    return { ...DEFAULT_CONFIG };
  }

  try {
    const parsed = JSON.parse(raw);
    return InfraBrainConfigSchema.parse(parsed);
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}
