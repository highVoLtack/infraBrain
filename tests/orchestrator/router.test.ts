import { describe, it, expect, vi, beforeEach } from 'vitest';
import { selectSkill, preFilterSkills } from '../../src/orchestrator/router.js';
import { buildMessages, buildRoutingPrompt, ROUTING_CONSTITUTION } from '../../src/orchestrator/context.js';
import { SkillRegistry } from '../../src/skills/registry.js';
import type { EnrichedSkillSummary } from '../../src/skills/registry.js';
import type { SkillFile } from '../../src/skills/types.js';
import type { LanguageModel } from 'ai';

vi.mock('ai', () => ({
  generateObject: vi.fn(),
}));

import { generateObject } from 'ai';
const mockGenerateObject = vi.mocked(generateObject);

interface MakeSkillOptions {
  triggers?: string[];
  negative_triggers?: string[];
  when_not_to_use?: string[];
  priority?: number;
}

function makeSkill(name: string, description: string, opts?: MakeSkillOptions): SkillFile {
  return {
    frontmatter: {
      name,
      description,
      triggers: opts?.triggers ?? [name],
      negative_triggers: opts?.negative_triggers ?? [],
      when_not_to_use: opts?.when_not_to_use ?? [],
      tools: [],
      priority: opts?.priority ?? 0,
    },
    sections: { systemPrompt: `You are the ${name} skill.` },
    rawContent: '',
    filePath: `skills/${name}.md`,
  };
}

function makeEnrichedSummary(name: string, description: string, opts?: MakeSkillOptions): EnrichedSkillSummary {
  return {
    name,
    description,
    triggers: opts?.triggers ?? [name],
    negative_triggers: opts?.negative_triggers ?? [],
    when_not_to_use: opts?.when_not_to_use ?? [],
    priority: opts?.priority ?? 0,
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

describe('preFilterSkills', () => {
  it('returns only linux-expert for "permission error on container" (not log-analysis)', () => {
    const linuxExpert = makeEnrichedSummary('linux-expert', 'Linux troubleshooting', {
      triggers: ['permission', 'crash', 'error', 'disk'],
      negative_triggers: [],
    });
    const logAnalysis = makeEnrichedSummary('log-analysis', 'Log analysis', {
      triggers: ['log', 'journal', 'syslog'],
      negative_triggers: ['permission', 'disk', 'OOM'],
    });
    const planning = makeEnrichedSummary('planning', 'Planning skill', {
      triggers: ['plan', 'fix'],
      negative_triggers: [],
    });

    const result = preFilterSkills([linuxExpert, logAnalysis, planning], 'permission error on container');

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('linux-expert');
  });

  it('excludes skills with matching negative_triggers even if positive triggers matched', () => {
    const skillA = makeEnrichedSummary('skill-a', 'Matches error', {
      triggers: ['error'],
      negative_triggers: ['permission'],
    });
    const skillB = makeEnrichedSummary('skill-b', 'Also matches error', {
      triggers: ['error'],
      negative_triggers: [],
    });

    const result = preFilterSkills([skillA, skillB], 'permission error in container');

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('skill-b');
  });

  it('returns ALL skills when no positive triggers match any skill (fallthrough)', () => {
    const skillA = makeEnrichedSummary('skill-a', 'A', { triggers: ['foo'] });
    const skillB = makeEnrichedSummary('skill-b', 'B', { triggers: ['bar'] });

    const result = preFilterSkills([skillA, skillB], 'completely unrelated query about networking');

    expect(result).toHaveLength(2);
    expect(result).toEqual([skillA, skillB]);
  });

  it('returns ALL skills when all positive matches are excluded by negative triggers', () => {
    const skillA = makeEnrichedSummary('skill-a', 'A', {
      triggers: ['error'],
      negative_triggers: ['permission'],
    });

    const allSkills = [
      skillA,
      makeEnrichedSummary('skill-b', 'B', { triggers: ['unrelated'] }),
    ];

    const result = preFilterSkills(allSkills, 'permission error');

    // skill-a matches 'error' but excluded by 'permission', skill-b doesn't match
    // afterNegative is empty, so ALL skills returned
    expect(result).toHaveLength(2);
  });
});

describe('selectSkill', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls generateObject with enriched prompt and returns the selected skill name + reasoning', async () => {
    const planning = makeSkill('planning', 'Decomposes infrastructure problems into fix plans');
    const logAnalysis = makeSkill('log-analysis', 'Analyzes log files for errors', {
      triggers: ['log-analysis'],
    });
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

  it('skips LLM call and returns directly when pre-filter yields exactly 1 candidate', async () => {
    const linuxExpert = makeSkill('linux-expert', 'Linux troubleshooting', {
      triggers: ['permission', 'crash'],
      negative_triggers: [],
    });
    const logAnalysis = makeSkill('log-analysis', 'Log analysis', {
      triggers: ['log', 'journal'],
      negative_triggers: ['permission'],
    });
    const registry = makeRegistry([linuxExpert, logAnalysis]);

    const result = await selectSkill({
      model: mockModel,
      userInput: 'permission error on container',
      registry,
    });

    expect(result.skill).toBe(linuxExpert);
    expect(result.reasoning).toBe('Single trigger match (pre-filter)');
    expect(mockGenerateObject).not.toHaveBeenCalled();
  });

  it('calls generateObject with enriched prompt when multiple candidates remain after pre-filter', async () => {
    const linuxExpert = makeSkill('linux-expert', 'Linux troubleshooting', {
      triggers: ['error', 'crash'],
      negative_triggers: [],
    });
    const networkExpert = makeSkill('network-expert', 'Network troubleshooting', {
      triggers: ['error', '502'],
      negative_triggers: [],
    });
    const registry = makeRegistry([linuxExpert, networkExpert]);

    mockGenerateObject.mockResolvedValue({
      object: { selectedSkill: 'network-expert', reasoning: 'HTTP error' },
    } as any);

    const result = await selectSkill({
      model: mockModel,
      userInput: 'error connecting to service',
      registry,
    });

    expect(result.skill).toBe(networkExpert);
    expect(result.reasoning).toBe('HTTP error');
    expect(mockGenerateObject).toHaveBeenCalledOnce();

    // Verify enriched prompt was used (system prompt should be ROUTING_CONSTITUTION)
    const callArgs = mockGenerateObject.mock.calls[0][0];
    expect(callArgs.system).toBe(ROUTING_CONSTITUTION);
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

    expect(result.system).toContain(skill.sections.systemPrompt);
    expect(result.system).toContain('MANDATORY EXECUTION PROTOCOL');
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0].role).toBe('assistant');
    expect(result.messages[0].content).toContain('Allowed: grep, journalctl');
    expect(result.messages[0].content).toContain('Example: nginx fix');
    expect(result.messages[1].role).toBe('user');
    expect(result.messages[1].content).toContain('nginx 502 error');
  });
});

describe('buildRoutingPrompt', () => {
  it('returns a formatted prompt listing all skill summaries with enriched data', () => {
    const skills: EnrichedSkillSummary[] = [
      makeEnrichedSummary('linux-expert', 'Linux troubleshooting', {
        triggers: ['permission', 'crash'],
        when_not_to_use: ['Pure log parsing without system symptoms'],
        priority: 10,
      }),
      makeEnrichedSummary('log-analysis', 'Analyze log files', {
        triggers: ['log', 'journal'],
        when_not_to_use: ['Permission errors', 'Disk issues'],
        priority: 9,
      }),
    ];

    const result = buildRoutingPrompt(skills, 'nginx 502');

    expect(result).toContain('nginx 502');
    expect(result).toContain('linux-expert');
    expect(result).toContain('Linux troubleshooting');
    expect(result).toContain('log-analysis');
    expect(result).toContain('Analyze log files');
    // Enriched data: triggers and when_not_to_use
    expect(result).toContain('permission');
    expect(result).toContain('crash');
    expect(result).toContain('Pure log parsing without system symptoms');
    expect(result).toContain('Permission errors');
    expect(result).toContain('Disk issues');
    // Priority included
    expect(result).toContain('10');
    expect(result).toContain('9');
  });
});
