import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateFixPlan, generatePlanMarkdown, formatPlanTable } from '../../src/orchestrator/planner.js';
import type { SkillFile } from '../../src/skills/types.js';
import type { LanguageModel } from 'ai';
import type { FixPlan } from '../../src/orchestrator/types.js';

vi.mock('ai', () => ({
  generateObject: vi.fn(),
}));

import { generateObject } from 'ai';
const mockGenerateObject = vi.mocked(generateObject);

const mockModel = {} as LanguageModel;

const planningSkill: SkillFile = {
  frontmatter: {
    name: 'planning',
    description: 'Decomposes infrastructure problems into fix plans',
    triggers: ['plan', 'fix'],
    tools: [],
    priority: 10,
  },
  sections: {
    systemPrompt: 'You are an infrastructure planning specialist.',
    examples: 'Example fix plan...',
  },
  rawContent: '',
  filePath: 'skills/planning.md',
};

const samplePlan: FixPlan = {
  summary: 'Restart nginx with corrected config',
  steps: [
    { command: 'nginx -t', description: 'Verify config', rollback: 'N/A', risk: 'read' },
    { command: 'systemctl reload nginx', description: 'Apply config', rollback: 'systemctl restart nginx', risk: 'write' },
  ],
  complexity: 'simple',
};

describe('generateFixPlan', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls generateObject with FixPlanSchema and returns typed FixPlan', async () => {
    mockGenerateObject.mockResolvedValue({ object: samplePlan } as any);

    const result = await generateFixPlan({
      model: mockModel,
      skill: planningSkill,
      userInput: 'nginx 502 error',
      diagnosis: 'Config syntax error in upstream block',
    });

    expect(result).toEqual(samplePlan);
    expect(mockGenerateObject).toHaveBeenCalledOnce();
  });

  it('produces steps with command, description, rollback, risk fields', async () => {
    mockGenerateObject.mockResolvedValue({ object: samplePlan } as any);

    const result = await generateFixPlan({
      model: mockModel,
      skill: planningSkill,
      userInput: 'nginx 502',
      diagnosis: 'Config error',
    });

    for (const step of result.steps) {
      expect(step).toHaveProperty('command');
      expect(step).toHaveProperty('description');
      expect(step).toHaveProperty('rollback');
      expect(step).toHaveProperty('risk');
      expect(['read', 'write', 'destructive']).toContain(step.risk);
    }
  });
});

describe('generatePlanMarkdown', () => {
  it('produces Markdown table with # | Command | Risk | Rollback headers', () => {
    const md = generatePlanMarkdown(samplePlan);

    expect(md).toContain('# | Command | Risk | Rollback');
    expect(md).toContain('nginx -t');
    expect(md).toContain('systemctl reload nginx');
    expect(md).toContain('read');
    expect(md).toContain('write');
    expect(md).toContain(samplePlan.summary);
  });
});

describe('formatPlanTable', () => {
  it('produces CLI-friendly numbered table: # | Command | Risk | Status', () => {
    const table = formatPlanTable(samplePlan);

    // Should contain header-like structure and numbered rows
    expect(table).toContain('Command');
    expect(table).toContain('Risk');
    expect(table).toContain('Status');
    expect(table).toContain('nginx -t');
    expect(table).toContain('pending');
    expect(table).toContain('1');
    expect(table).toContain('2');
  });
});
