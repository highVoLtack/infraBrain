import { describe, it, expect } from 'vitest';
import { classifyCommand } from '../../src/safety/classifier.js';
import { RiskLevel, type ClassificationRule } from '../../src/safety/types.js';

describe('classifyCommand', () => {
  describe('read-only commands', () => {
    it('classifies "docker ps" as READ', () => {
      expect(classifyCommand('docker ps')).toBe(RiskLevel.READ);
    });

    it('classifies "docker logs nginx" as READ', () => {
      expect(classifyCommand('docker logs nginx')).toBe(RiskLevel.READ);
    });

    it('classifies "cat /etc/nginx/nginx.conf" as READ', () => {
      expect(classifyCommand('cat /etc/nginx/nginx.conf')).toBe(RiskLevel.READ);
    });

    it('classifies "systemctl status nginx" as READ', () => {
      expect(classifyCommand('systemctl status nginx')).toBe(RiskLevel.READ);
    });
  });

  describe('write commands', () => {
    it('classifies "docker restart nginx" as WRITE', () => {
      expect(classifyCommand('docker restart nginx')).toBe(RiskLevel.WRITE);
    });

    it('classifies "docker stop nginx" as WRITE', () => {
      expect(classifyCommand('docker stop nginx')).toBe(RiskLevel.WRITE);
    });

    it('classifies "systemctl restart nginx" as WRITE', () => {
      expect(classifyCommand('systemctl restart nginx')).toBe(RiskLevel.WRITE);
    });
  });

  describe('destructive commands', () => {
    it('classifies "docker rm -f nginx" as DESTRUCTIVE', () => {
      expect(classifyCommand('docker rm -f nginx')).toBe(RiskLevel.DESTRUCTIVE);
    });

    it('classifies "rm /tmp/somefile" as DESTRUCTIVE', () => {
      expect(classifyCommand('rm /tmp/somefile')).toBe(RiskLevel.DESTRUCTIVE);
    });
  });

  describe('blocked commands', () => {
    it('classifies "rm -rf /" as BLOCKED', () => {
      expect(classifyCommand('rm -rf /')).toBe(RiskLevel.BLOCKED);
    });

    it('classifies "mkfs.ext4 /dev/sda" as BLOCKED', () => {
      expect(classifyCommand('mkfs.ext4 /dev/sda')).toBe(RiskLevel.BLOCKED);
    });
  });

  describe('unknown commands', () => {
    it('defaults unknown commands to WRITE', () => {
      expect(classifyCommand('some-unknown-command --flag')).toBe(RiskLevel.WRITE);
    });
  });

  describe('custom rules', () => {
    it('uses custom rules when provided, but blocked patterns still apply', () => {
      const customRules: ClassificationRule[] = [
        { pattern: /^docker\s+ps/, level: RiskLevel.WRITE }, // override: ps is now WRITE
      ];

      // Custom rule applied
      expect(classifyCommand('docker ps', customRules)).toBe(RiskLevel.WRITE);

      // Blocked patterns still enforced even with custom rules
      expect(classifyCommand('rm -rf /', customRules)).toBe(RiskLevel.BLOCKED);
      expect(classifyCommand('mkfs.ext4 /dev/sda', customRules)).toBe(RiskLevel.BLOCKED);
    });
  });
});
