import { describe, it, expect } from 'vitest';
import { SkillFrontmatterSchema, DiscoveryCommandSchema, ToolDeclarationSchema } from '../../src/skills/types.js';
import { SkillRegistry } from '../../src/skills/registry.js';
import type { EnrichedSkillSummary } from '../../src/skills/registry.js';

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

describe('ToolDeclarationSchema', () => {
  it('accepts declaration with only risk (required)', () => {
    const result = ToolDeclarationSchema.safeParse({ risk: 'read' });
    expect(result.success).toBe(true);
  });

  it('accepts declaration with risk and user', () => {
    const result = ToolDeclarationSchema.safeParse({ risk: 'write', user: '0' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.user).toBe('0');
    }
  });

  it('accepts declaration with risk, wrapper, and strip_flags', () => {
    const result = ToolDeclarationSchema.safeParse({
      risk: 'read',
      wrapper: 'psql -U postgres -c "{cmd}"',
      strip_flags: ['-h'],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.wrapper).toBe('psql -U postgres -c "{cmd}"');
      expect(result.data.strip_flags).toEqual(['-h']);
    }
  });

  it('defaults container to "auto"', () => {
    const result = ToolDeclarationSchema.safeParse({ risk: 'read' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.container).toBe('auto');
    }
  });

  it('rejects declaration without risk (required field)', () => {
    const result = ToolDeclarationSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects invalid risk value', () => {
    const result = ToolDeclarationSchema.safeParse({ risk: 'critical' });
    expect(result.success).toBe(false);
  });
});

describe('SkillFrontmatterSchema tools union', () => {
  it('accepts legacy string[] format', () => {
    const result = SkillFrontmatterSchema.parse({
      ...BASE_FRONTMATTER,
      tools: ['ls', 'chown'],
    });
    expect(result.tools).toEqual(['ls', 'chown']);
  });

  it('accepts new map format', () => {
    const result = SkillFrontmatterSchema.parse({
      ...BASE_FRONTMATTER,
      tools: {
        ls: { risk: 'read' },
        chown: { risk: 'write', user: '0' },
      },
    });
    expect(result.tools).toEqual({
      ls: { risk: 'read', container: 'auto' },
      chown: { risk: 'write', user: '0', container: 'auto' },
    });
  });

  it('defaults tools to empty map {} when not provided', () => {
    const result = SkillFrontmatterSchema.parse(BASE_FRONTMATTER);
    expect(result.tools).toEqual({});
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

describe('SkillFrontmatterSchema negative_triggers', () => {
  it('accepts frontmatter without negative_triggers (defaults to empty array)', () => {
    const result = SkillFrontmatterSchema.parse(BASE_FRONTMATTER);
    expect(result.negative_triggers).toEqual([]);
  });

  it('accepts frontmatter with negative_triggers array', () => {
    const input = {
      ...BASE_FRONTMATTER,
      negative_triggers: ['permission', 'disk', 'OOM'],
    };
    const result = SkillFrontmatterSchema.parse(input);
    expect(result.negative_triggers).toEqual(['permission', 'disk', 'OOM']);
  });
});

describe('SkillFrontmatterSchema when_not_to_use', () => {
  it('accepts frontmatter without when_not_to_use (defaults to empty array)', () => {
    const result = SkillFrontmatterSchema.parse(BASE_FRONTMATTER);
    expect(result.when_not_to_use).toEqual([]);
  });

  it('accepts frontmatter with when_not_to_use array', () => {
    const input = {
      ...BASE_FRONTMATTER,
      when_not_to_use: [
        'Filesystem permission errors -- use linux-expert',
        'Database connection issues -- use postgres-expert',
      ],
    };
    const result = SkillFrontmatterSchema.parse(input);
    expect(result.when_not_to_use).toHaveLength(2);
    expect(result.when_not_to_use[0]).toContain('linux-expert');
  });
});

describe('SkillRegistry.list() enriched output', () => {
  it('returns objects with name, description, triggers, negative_triggers, when_not_to_use, priority', () => {
    // Use populate with the real skills directory to test enriched list()
    const registry = new SkillRegistry();
    registry.populate('skills');

    const items = registry.list();
    expect(items.length).toBeGreaterThan(0);

    for (const item of items) {
      expect(item).toHaveProperty('name');
      expect(item).toHaveProperty('description');
      expect(item).toHaveProperty('triggers');
      expect(item).toHaveProperty('negative_triggers');
      expect(item).toHaveProperty('when_not_to_use');
      expect(item).toHaveProperty('priority');
      expect(Array.isArray(item.triggers)).toBe(true);
      expect(Array.isArray(item.negative_triggers)).toBe(true);
      expect(Array.isArray(item.when_not_to_use)).toBe(true);
      expect(typeof item.priority).toBe('number');
    }
  });

  it('satisfies EnrichedSkillSummary type', () => {
    const registry = new SkillRegistry();
    registry.populate('skills');

    // TypeScript compile-time check: list() returns EnrichedSkillSummary[]
    const items: EnrichedSkillSummary[] = registry.list();
    expect(items.length).toBeGreaterThan(0);
  });
});
