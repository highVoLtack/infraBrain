import { describe, it, expect, vi, beforeEach } from 'vitest';
import { selectSkill } from '../../src/orchestrator/router.js';
import { buildMessages, buildRoutingPrompt } from '../../src/orchestrator/context.js';
import { SkillRegistry } from '../../src/skills/registry.js';
import type { SkillFile } from '../../src/skills/types.js';
import type { LanguageModel } from 'ai';

vi.mock('ai', () => ({
  generateObject: vi.fn(),
}));

import { generateObject } from 'ai';
const mockGenerateObject = vi.mocked(generateObject);

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

function makeRegistry(skills: SkillFile[]): SkillRegistry {
  const reg = new SkillRegistry();
  // Manually inject skills via get/list by populating the internal map
  for (const s of skills) {
    (reg as any).skills.set(s.frontmatter.name, s);
  }
  return reg;
}

const mockModel = {} as LanguageModel;

describe('selectSkill', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls generateObject with skill summaries and returns the selected skill name + reasoning', async () => {
    const planning = makeSkill('planning', 'Decomposes infrastructure problems into fix plans');
    const logAnalysis = makeSkill('log-analysis', 'Analyzes log files for errors');
    const registry = makeRegistry([planning, logAnalysis]);

    mockGenerateObject.mockResolvedValue({
      object: { selectedSkill: 'planning', reasoning: 'User wants to fix an issue' },
    } as any);

    const result = await selectSkill({
      model: mockModel,
      userInput: 'nginx returning 502',
      registry,
    });

    expect(result.skill).toBe(planning);
    expect(result.reasoning).toBe('User wants to fix an issue');
    expect(mockGenerateObject).toHaveBeenCalledOnce();
  });

  it('returns the --skill override directly when provided (skips LLM call)', async () => {
    const planning = makeSkill('planning', 'Decomposes infrastructure problems into fix plans');
    const registry = makeRegistry([planning]);

    const result = await selectSkill({
      model: mockModel,
      userInput: 'fix nginx',
      registry,
      skillOverride: 'planning',
    });

    expect(result.skill).toBe(planning);
    expect(result.reasoning).toBe('Manual override');
    expect(mockGenerateObject).not.toHaveBeenCalled();
  });

  it('throws when --skill override names a skill not in registry', async () => {
    const registry = makeRegistry([]);

    await expect(
      selectSkill({
        model: mockModel,
        userInput: 'fix nginx',
        registry,
        skillOverride: 'nonexistent',
      }),
    ).rejects.toThrow('Skill "nonexistent" not found in registry');
  });
});

describe('buildMessages', () => {
  it('returns { system, messages } with skill systemPrompt as system, assistant message with skill context, user message with input', () => {
    const skill = makeSkill('planning', 'Fix plan decomposition');
    skill.sections.tools = 'Allowed: grep, journalctl';
    skill.sections.examples = 'Example: nginx fix';

    const result = buildMessages(skill, 'nginx 502 error');

    expect(result.system).toBe(skill.sections.systemPrompt);
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0].role).toBe('assistant');
    expect(result.messages[0].content).toContain('Allowed: grep, journalctl');
    expect(result.messages[0].content).toContain('Example: nginx fix');
    expect(result.messages[1].role).toBe('user');
    expect(result.messages[1].content).toContain('nginx 502 error');
  });
});

describe('buildRoutingPrompt', () => {
  it('returns a formatted prompt listing all skill summaries', () => {
    const skills = [
      { name: 'planning', description: 'Fix plan decomposition' },
      { name: 'log-analysis', description: 'Analyze log files' },
    ];

    const result = buildRoutingPrompt(skills, 'nginx 502');

    expect(result).toContain('nginx 502');
    expect(result).toContain('planning');
    expect(result).toContain('Fix plan decomposition');
    expect(result).toContain('log-analysis');
    expect(result).toContain('Analyze log files');
  });
});
