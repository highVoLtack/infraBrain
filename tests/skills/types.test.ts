import { describe, it, expect } from 'vitest';
import { SkillFrontmatterSchema, DiscoveryCommandSchema } from '../../src/skills/types.js';

const BASE_FRONTMATTER = {
  name: 'test-skill',
  description: 'A valid test skill for rewrite rule testing',
  triggers: ['test'],
};

describe('SkillFrontmatterSchema rewrite_rules', () => {
  it('accepts frontmatter without rewrite_rules (defaults to empty array)', () => {
    const result = SkillFrontmatterSchema.parse(BASE_FRONTMATTER);
    expect(result.rewrite_rules).toEqual([]);
  });

  it('accepts frontmatter with valid rewrite_rules array', () => {
    const input = {
      ...BASE_FRONTMATTER,
      rewrite_rules: [
        {
          match: '^SELECT\\b',
          container: 'auto',
          wrapper: 'psql -U postgres -c "{cmd}"',
          strip_flags: ['-h', '--host'],
          risk: 'read' as const,
        },
        {
          match: '^chown\\b',
          container: 'auto',
          user: '0',
          risk: 'write' as const,
        },
      ],
    };
    const result = SkillFrontmatterSchema.parse(input);
    expect(result.rewrite_rules).toHaveLength(2);
    expect(result.rewrite_rules[0].match).toBe('^SELECT\\b');
    expect(result.rewrite_rules[0].wrapper).toBe('psql -U postgres -c "{cmd}"');
    expect(result.rewrite_rules[1].user).toBe('0');
  });

  it('rejects rewrite_rules with missing match field', () => {
    const input = {
      ...BASE_FRONTMATTER,
      rewrite_rules: [
        { container: 'auto', risk: 'read' },
      ],
    };
    expect(() => SkillFrontmatterSchema.parse(input)).toThrow();
  });

  it('accepts rewrite_rules with only match field (other fields have defaults/optional)', () => {
    const input = {
      ...BASE_FRONTMATTER,
      rewrite_rules: [
        { match: '^df\\b' },
      ],
    };
    const result = SkillFrontmatterSchema.parse(input);
    expect(result.rewrite_rules).toHaveLength(1);
    expect(result.rewrite_rules[0].match).toBe('^df\\b');
    expect(result.rewrite_rules[0].container).toBe('auto');
    expect(result.rewrite_rules[0].user).toBeUndefined();
    expect(result.rewrite_rules[0].wrapper).toBeUndefined();
    expect(result.rewrite_rules[0].risk).toBeUndefined();
    expect(result.rewrite_rules[0].strip_flags).toBeUndefined();
  });
});

describe('SkillFrontmatterSchema discovery', () => {
  it('accepts frontmatter without discovery (defaults to empty array)', () => {
    const result = SkillFrontmatterSchema.parse(BASE_FRONTMATTER);
    expect(result.discovery).toEqual([]);
  });

  it('accepts frontmatter with valid discovery array (command + label)', () => {
    const input = {
      ...BASE_FRONTMATTER,
      discovery: [
        { command: 'docker ps --format "{{.Names}}"', label: 'Running containers' },
      ],
    };
    const result = SkillFrontmatterSchema.parse(input);
    expect(result.discovery).toHaveLength(1);
    expect(result.discovery[0].command).toBe('docker ps --format "{{.Names}}"');
    expect(result.discovery[0].label).toBe('Running containers');
  });

  it('rejects discovery with empty command string', () => {
    const input = {
      ...BASE_FRONTMATTER,
      discovery: [{ command: '', label: 'Some label' }],
    };
    expect(() => SkillFrontmatterSchema.parse(input)).toThrow();
  });

  it('rejects discovery with empty label string', () => {
    const input = {
      ...BASE_FRONTMATTER,
      discovery: [{ command: 'docker ps', label: '' }],
    };
    expect(() => SkillFrontmatterSchema.parse(input)).toThrow();
  });

  it('parses multiple discovery entries correctly', () => {
    const input = {
      ...BASE_FRONTMATTER,
      discovery: [
        { command: 'docker ps --format "{{.Names}}"', label: 'Running containers' },
        { command: 'docker network ls --format "{{.Name}}"', label: 'Docker networks' },
        { command: 'docker system df', label: 'Docker system storage overview' },
      ],
    };
    const result = SkillFrontmatterSchema.parse(input);
    expect(result.discovery).toHaveLength(3);
    expect(result.discovery[2].command).toBe('docker system df');
    expect(result.discovery[2].label).toBe('Docker system storage overview');
  });
});
