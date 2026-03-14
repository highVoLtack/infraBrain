import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync, cpSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadSkillFile, loadSkillDirectory } from '../../src/skills/loader.js';
import { SkillRegistry } from '../../src/skills/registry.js';
import { enforceSkillAllowlist } from '../../src/skills/allowlist.js';
import type { SkillFile } from '../../src/skills/types.js';

const FIXTURES_DIR = join(import.meta.dirname, '..', 'fixtures', 'skills');
const VALID_SKILL = join(FIXTURES_DIR, 'valid-skill.md');
const MALFORMED_NO_NAME = join(FIXTURES_DIR, 'malformed-no-name.md');
const MALFORMED_NO_PROMPT = join(FIXTURES_DIR, 'malformed-no-prompt.md');

describe('loadSkillFile', () => {
  it('parses a valid .md skill file and returns SkillFile with frontmatter and sections', () => {
    const skill = loadSkillFile(VALID_SKILL);

    expect(skill.frontmatter.name).toBe('test-skill');
    expect(skill.frontmatter.description).toBe('A valid test skill for unit testing the skill loader');
    expect(skill.frontmatter.triggers).toEqual(['test', 'demo']);
    expect(skill.frontmatter.tools).toEqual(['curl', 'grep', 'cat']);
    expect(skill.sections.systemPrompt).toContain('You are a test skill');
    expect(skill.sections.tools).toContain('curl');
    expect(skill.sections.examples).toContain('Basic test');
    expect(skill.filePath).toBe(VALID_SKILL);
    expect(skill.rawContent).toBeTruthy();
  });

  it('defaults preferred_model to undefined when not specified', () => {
    const skill = loadSkillFile(VALID_SKILL);
    expect(skill.frontmatter.preferred_model).toBeUndefined();
  });

  it('accepts preferred_model in frontmatter when specified', () => {
    const { writeFileSync, mkdtempSync } = require('node:fs');
    const { join: joinPath } = require('node:path');
    const { tmpdir } = require('node:os');
    const tmpDir = mkdtempSync(joinPath(tmpdir(), 'skill-model-'));
    const skillPath = joinPath(tmpDir, 'forensic-skill.md');
    writeFileSync(skillPath, `---
name: forensic-test
description: "A skill that uses the forensic model for deep analysis"
triggers:
  - deep-debug
preferred_model: forensic
---

## System Prompt

You are a forensic debugging specialist.
`);
    const skill = loadSkillFile(skillPath);
    expect(skill.frontmatter.preferred_model).toBe('forensic');
  });

  it('accepts worker and vision as valid preferred_model roles', () => {
    const { writeFileSync, mkdtempSync } = require('node:fs');
    const { join: joinPath } = require('node:path');
    const { tmpdir } = require('node:os');
    for (const role of ['worker', 'vision']) {
      const tmpDir = mkdtempSync(joinPath(tmpdir(), `skill-model-${role}-`));
      const skillPath = joinPath(tmpDir, `${role}-skill.md`);
      writeFileSync(skillPath, `---
name: ${role}-test
description: "A skill that uses the ${role} model"
triggers:
  - test-${role}
preferred_model: ${role}
---

## System Prompt

You are a ${role} specialist.
`);
      const skill = loadSkillFile(skillPath);
      expect(skill.frontmatter.preferred_model).toBe(role);
    }
  });

  it('rejects invalid preferred_model values', () => {
    const { writeFileSync, mkdtempSync } = require('node:fs');
    const { join: joinPath } = require('node:path');
    const { tmpdir } = require('node:os');
    const tmpDir = mkdtempSync(joinPath(tmpdir(), 'skill-model-bad-'));
    const skillPath = joinPath(tmpDir, 'bad-model-skill.md');
    writeFileSync(skillPath, `---
name: bad-model
description: "A skill with an invalid model role"
triggers:
  - test
preferred_model: nonexistent
---

## System Prompt

You are a test.
`);
    expect(() => loadSkillFile(skillPath)).toThrow();
  });

  it('loads a skill with map-format tools and returns tools as Record', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'skill-map-tools-'));
    const skillPath = join(tmpDir, 'map-tools-skill.md');
    writeFileSync(skillPath, `---
name: map-tools-test
description: "A skill using map-format tools"
triggers:
  - test
tools:
  ls:
    risk: read
  chown:
    risk: write
    user: "0"
  psql:
    risk: read
    wrapper: 'psql -U postgres -c "{cmd}"'
    strip_flags:
      - "-h"
---

## System Prompt

You are a test skill with map-format tools.
`);
    const skill = loadSkillFile(skillPath);
    expect(Array.isArray(skill.frontmatter.tools)).toBe(false);
    expect(typeof skill.frontmatter.tools).toBe('object');
    const tools = skill.frontmatter.tools as Record<string, any>;
    expect(tools['ls']).toBeDefined();
    expect(tools['ls'].risk).toBe('read');
    expect(tools['chown'].risk).toBe('write');
    expect(tools['chown'].user).toBe('0');
    expect(tools['psql'].wrapper).toBe('psql -U postgres -c "{cmd}"');
    expect(tools['psql'].strip_flags).toEqual(['-h']);
  });

  it('rejects a skill file missing required frontmatter field "name" with a clear error', () => {
    expect(() => loadSkillFile(MALFORMED_NO_NAME)).toThrow(/name/i);
  });

  it('rejects a skill file missing the required "## System Prompt" section', () => {
    expect(() => loadSkillFile(MALFORMED_NO_PROMPT)).toThrow(/System Prompt/i);
  });
});

describe('loadSkillDirectory', () => {
  it('loads all valid skills and skips malformed ones, returning both', () => {
    const result = loadSkillDirectory(FIXTURES_DIR);

    expect(result.skills.length).toBe(1);
    expect(result.skills[0].frontmatter.name).toBe('test-skill');
    expect(result.errors.length).toBe(2);
    expect(result.errors.some(e => e.file.includes('malformed-no-name'))).toBe(true);
    expect(result.errors.some(e => e.file.includes('malformed-no-prompt'))).toBe(true);
  });
});

describe('loadSkillDirectory (real skills)', () => {
  const SKILLS_DIR = join(import.meta.dirname, '..', '..', 'skills');

  it('loads all 6 universal expert skills from the real skills directory', () => {
    const result = loadSkillDirectory(SKILLS_DIR);

    expect(result.errors).toHaveLength(0);
    expect(result.skills).toHaveLength(6);

    const names = result.skills.map((s) => s.frontmatter.name).sort();
    expect(names).toEqual([
      'linux-expert',
      'log-analysis',
      'network-expert',
      'planning',
      'postgres-expert',
      'verification',
    ]);
  });
});

describe('SkillRegistry', () => {
  let registry: SkillRegistry;

  beforeAll(() => {
    // Create a temp dir with just the valid skill
    const tmpDir = mkdtempSync(join(tmpdir(), 'skill-registry-'));
    cpSync(VALID_SKILL, join(tmpDir, 'valid-skill.md'));
    registry = new SkillRegistry();
    registry.populate(tmpDir);
  });

  it('get(name) returns the correct skill after population', () => {
    const skill = registry.get('test-skill');
    expect(skill).toBeDefined();
    expect(skill!.frontmatter.name).toBe('test-skill');
  });

  it('list() returns all loaded skill summaries', () => {
    const summaries = registry.list();
    expect(summaries).toHaveLength(1);
    expect(summaries[0].name).toBe('test-skill');
    expect(summaries[0].description).toContain('test skill');
  });
});

describe('enforceSkillAllowlist', () => {
  let skill: SkillFile;

  beforeAll(() => {
    skill = loadSkillFile(VALID_SKILL);
  });

  it('returns true for commands matching skill tools array', () => {
    const result = enforceSkillAllowlist('curl -s http://localhost', skill);
    expect(result.allowed).toBe(true);
  });

  it('returns false for commands NOT in skill tools array', () => {
    const result = enforceSkillAllowlist('rm -rf /tmp', skill);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('rm');
  });

  it('splits on shell operators and checks each sub-command', () => {
    // curl is allowed, rm is not
    const result = enforceSkillAllowlist('curl http://localhost && rm -rf /tmp', skill);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('rm');
  });

  it('returns true when skill has empty tools array (no restriction)', () => {
    const unrestrictedSkill: SkillFile = {
      frontmatter: {
        name: 'unrestricted',
        description: 'A skill with no tool restrictions at all',
        triggers: ['test'],
        tools: [],
        priority: 0,
      },
      sections: {
        systemPrompt: 'You are unrestricted.',
      },
      rawContent: '',
      filePath: 'fake.md',
    };
    const result = enforceSkillAllowlist('rm -rf /', unrestrictedSkill);
    expect(result.allowed).toBe(true);
  });
});
