import { describe, it, expect } from 'vitest';
import { SkillFrontmatterSchema } from '../../src/skills/types.js';

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
