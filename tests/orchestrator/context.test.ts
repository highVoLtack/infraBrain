import { describe, it, expect } from 'vitest';
import { buildMessages, buildRoutingPrompt } from '../../src/orchestrator/context.js';
import type { SkillFile } from '../../src/skills/types.js';

function makeSkill(name: string, description: string): SkillFile {
  return {
    frontmatter: {
      name,
      description,
      triggers: [name],
      tools: [],
      priority: 0,
    },
    sections: { systemPrompt: `You are the ${name} skill.` },
    rawContent: '',
    filePath: `skills/${name}.md`,
  };
}

describe('buildRoutingPrompt (TOON encoding)', () => {
  it('encodes skill list as TOON tabular format (no JSON braces)', () => {
    const skills = [
      { name: 'planning', description: 'Fix plan decomposition' },
      { name: 'log-analysis', description: 'Analyze log files' },
    ];

    const result = buildRoutingPrompt(skills, 'nginx 502');

    // Should contain skill data
    expect(result).toContain('planning');
    expect(result).toContain('Fix plan decomposition');
    expect(result).toContain('log-analysis');
    expect(result).toContain('Analyze log files');

    // TOON tabular format uses header + CSV-style rows, not JSON braces
    expect(result).not.toContain('{"name"');
    expect(result).not.toContain('["planning"');

    // Should have the Available skills label
    expect(result).toContain('Available skills:');
  });

  it('keeps user input as plain text', () => {
    const skills = [{ name: 'test', description: 'Test skill for something' }];
    const result = buildRoutingPrompt(skills, 'nginx 502 bad gateway');

    expect(result).toContain('User query: nginx 502 bad gateway');
  });
});

describe('buildMessages (TOON encoding)', () => {
  it('TOON-encodes tools section with label in assistant content', () => {
    const skill = makeSkill('planning', 'Fix plan decomposition');
    skill.sections.tools = 'Allowed: grep, journalctl';

    const result = buildMessages(skill, 'nginx 502 error');

    // Assistant message should contain the tools with label
    expect(result.messages[0].content).toContain('Tools:');
    expect(result.messages[0].content).toContain('Allowed: grep, journalctl');
  });

  it('TOON-encodes examples section with label in assistant content', () => {
    const skill = makeSkill('planning', 'Fix plan decomposition');
    skill.sections.examples = 'Example: nginx fix';

    const result = buildMessages(skill, 'nginx 502 error');

    expect(result.messages[0].content).toContain('Examples:');
    expect(result.messages[0].content).toContain('Example: nginx fix');
  });

  it('keeps user input as plain text (not TOON-encoded)', () => {
    const skill = makeSkill('planning', 'Fix plan decomposition');
    skill.sections.tools = 'some tools';

    const result = buildMessages(skill, 'nginx 502 error');

    expect(result.messages[1].role).toBe('user');
    expect(result.messages[1].content).toBe('nginx 502 error');
  });

  it('keeps system prompt as plain text (not TOON-encoded)', () => {
    const skill = makeSkill('planning', 'Fix plan decomposition');

    const result = buildMessages(skill, 'test');

    expect(result.system).toContain('You are the planning skill.');
    expect(result.system).toContain('MANDATORY EXECUTION PROTOCOL');
  });
});
