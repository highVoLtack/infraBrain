import { describe, it, expect, beforeAll } from 'vitest';
import { loadSkillFile } from '../../src/skills/loader.js';
import { enforceSkillAllowlist } from '../../src/skills/allowlist.js';
import type { SkillFile } from '../../src/skills/types.js';
import { join } from 'node:path';

const SKILLS_DIR = join(import.meta.dirname, '..', '..', 'skills');

describe('verification skill', () => {
  let skill: SkillFile;

  beforeAll(() => {
    skill = loadSkillFile(join(SKILLS_DIR, 'verification.md'));
  });

  it('loads via loadSkillFile without errors', () => {
    expect(skill).toBeDefined();
    expect(skill.frontmatter.name).toBe('verification');
  });

  it('frontmatter.tools contains health-check-relevant commands', () => {
    const requiredTools = ['curl', 'wget', 'docker', 'systemctl', 'ss', 'nc', 'ping', 'dig', 'nslookup'];
    for (const tool of requiredTools) {
      expect(skill.frontmatter.tools).toContain(tool);
    }
  });

  it('system prompt contains instructions for generating health check commands that return exit code 0 on success', () => {
    expect(skill.sections.systemPrompt).toMatch(/exit code 0/i);
  });

  it('system prompt contains instructions that checks should fail before fix and pass after fix', () => {
    expect(skill.sections.systemPrompt).toMatch(/fail.*before/i);
    expect(skill.sections.systemPrompt).toMatch(/pass after/i);
  });

  it('enforceSkillAllowlist allows "curl -s http://localhost" for verification skill', () => {
    const result = enforceSkillAllowlist('curl -s http://localhost', skill);
    expect(result.allowed).toBe(true);
  });

  it('enforceSkillAllowlist rejects "rm -rf /tmp" for verification skill', () => {
    const result = enforceSkillAllowlist('rm -rf /tmp', skill);
    expect(result.allowed).toBe(false);
  });
});
