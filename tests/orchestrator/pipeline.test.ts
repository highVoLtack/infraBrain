import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LLMProvider } from '../../src/llm/types.js';
import type { AuditLogger } from '../../src/audit/logger.js';
import type { ValidationResult } from '../../src/safety/types.js';
import { RiskLevel } from '../../src/safety/types.js';
import type { SkillFile } from '../../src/skills/types.js';
import { SkillRegistry } from '../../src/skills/registry.js';

// Mock all pipeline dependencies
vi.mock('../../src/orchestrator/router.js', () => ({
  selectSkill: vi.fn(),
}));
vi.mock('../../src/orchestrator/planner.js', () => ({
  generateFixPlan: vi.fn(),
  generatePlanMarkdown: vi.fn(),
  formatPlanTable: vi.fn(),
}));
vi.mock('../../src/orchestrator/context.js', () => ({
  buildMessages: vi.fn(() => ({ system: 'mock system prompt', messages: [] })),
}));
vi.mock('../../src/orchestrator/discovery.js', () => ({
  runParallelDiscovery: vi.fn(),
}));
vi.mock('../../src/orchestrator/diagnosis.js', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    runDiagnosis: vi.fn(),
  };
});
// Mock cache modules to prevent real LanceDB/embedding calls in pipeline tests
vi.mock('../../src/cache/cache-lookup.js', () => ({
  checkCache: vi.fn().mockResolvedValue({ type: 'miss' }),
}));
vi.mock('../../src/cache/lance-store.js', () => ({
  getCacheStore: vi.fn(() => ({
    init: vi.fn().mockResolvedValue(undefined),
    search: vi.fn().mockResolvedValue([]),
  })),
}));

import { runDPEV } from '../../src/orchestrator/pipeline.js';
import { selectSkill } from '../../src/orchestrator/router.js';
import { generateFixPlan, generatePlanMarkdown, formatPlanTable } from '../../src/orchestrator/planner.js';
import { runParallelDiscovery } from '../../src/orchestrator/discovery.js';
import { runDiagnosis } from '../../src/orchestrator/diagnosis.js';

describe('runDPEV pipeline', () => {
  let mockProvider: LLMProvider;
  let mockAuditLogger: AuditLogger;
  let mockValidator: (command: string) => ValidationResult;
  let registry: SkillRegistry;
  let nginxSkill: SkillFile;
  let planningSkill: SkillFile;

  beforeEach(() => {
    vi.clearAllMocks();

    mockProvider = {
      model: {} as any,
      registry: {
        get: vi.fn(() => ({} as any)),
        getDefault: vi.fn(() => ({} as any)),
        entries: vi.fn(() => []),
      },
      async *streamDiagnosis() { yield 'test'; },
      async generateCommand() { return 'Command: docker ps'; },
    };

    mockAuditLogger = {
      logDecision: vi.fn(),
      logCommandValidation: vi.fn(),
      logSkillSelection: vi.fn(),
      logError: vi.fn(),
      logExecution: vi.fn(),
      logApproval: vi.fn(),
      logStateDiff: vi.fn(),
    } as unknown as AuditLogger;

    mockValidator = (command: string) => ({
      allowed: true,
      riskLevel: RiskLevel.READ,
      command,
    });

    nginxSkill = {
      frontmatter: {
        name: 'nginx-troubleshoot',
        description: 'Nginx diagnosis',
        triggers: ['nginx'],
        tools: ['docker'],
        priority: 10,
        discovery: [{ command: 'docker ps --format "{{.Names}}"', label: 'Running containers' }],
      },
      sections: { systemPrompt: 'You are a diagnostic specialist.' },
      rawContent: '',
      filePath: 'skills/nginx-troubleshoot.md',
    };

    planningSkill = {
      frontmatter: {
        name: 'planning',
        description: 'Fix planning',
        triggers: ['plan'],
        tools: [],
        priority: 10,
      },
      sections: { systemPrompt: 'You are a planning specialist.' },
      rawContent: '',
      filePath: 'skills/planning.md',
    };

    registry = new SkillRegistry();
    (registry as any).skills = new Map([
      ['nginx-troubleshoot', nginxSkill],
      ['planning', planningSkill],
    ]);
  });

  it('calls pipeline stages in correct DPEV order', async () => {
    const callOrder: string[] = [];

    vi.mocked(selectSkill).mockImplementation(async () => {
      callOrder.push('select');
      return { skill: nginxSkill, reasoning: 'matched' };
    });

    vi.mocked(runParallelDiscovery).mockImplementation(async () => {
      callOrder.push('discovery');
      return { context: 'discovered context', raw: { 'Running containers': 'nginx-demo' } };
    });

    vi.mocked(runDiagnosis).mockImplementation(async () => {
      callOrder.push('diagnosis');
      return { diagnosis: 'Command: docker restart nginx-demo' };
    });

    vi.mocked(generateFixPlan).mockImplementation(async () => {
      callOrder.push('planning');
      return {
        summary: 'Restart nginx',
        steps: [{ command: 'docker restart nginx-demo', description: 'Restart', rollback: 'n/a', risk: 'write' as const }],
        complexity: 'simple' as const,
      };
    });
    vi.mocked(generatePlanMarkdown).mockReturnValue('## Plan');
    vi.mocked(formatPlanTable).mockReturnValue('| Step |');

    const result = await runDPEV({
      prompt: 'Nginx is down',
      provider: mockProvider,
      registry,
      auditLogger: mockAuditLogger,
      validator: mockValidator,
      sessionId: 'test-session',
    });

    expect(callOrder).toEqual(['select', 'discovery', 'diagnosis', 'planning']);
    expect(result.skillName).toBe('nginx-troubleshoot');
    expect(result.diagnosis).toBe('Command: docker restart nginx-demo');
    expect(result.fixPlan).toBeDefined();
  });

  it('propagates hallucinationError from runDiagnosis', async () => {
    vi.mocked(selectSkill).mockResolvedValue({ skill: nginxSkill, reasoning: 'matched' });
    vi.mocked(runParallelDiscovery).mockResolvedValue({ context: 'ctx', raw: {} });
    vi.mocked(runDiagnosis).mockResolvedValue({
      diagnosis: 'bad output',
      hallucinationError: {
        violations: ['Found hallucination pattern: "<my-app>"'],
        hint: 'placeholder detected',
      },
    });

    const result = await runDPEV({
      prompt: 'test',
      provider: mockProvider,
      registry,
      auditLogger: mockAuditLogger,
      validator: mockValidator,
      sessionId: 'test-session',
    });

    expect(result.hallucinationError).toBeDefined();
    expect(result.hallucinationError!.violations).toHaveLength(1);
    expect(result.commands).toEqual([]);
  });

  it('returns DPEVResult with all expected fields', async () => {
    vi.mocked(selectSkill).mockResolvedValue({ skill: nginxSkill, reasoning: 'matched' });
    vi.mocked(runParallelDiscovery).mockResolvedValue({
      context: 'discovered context',
      raw: { 'Running containers': 'nginx-demo' },
    });
    vi.mocked(runDiagnosis).mockResolvedValue({
      diagnosis: 'Command: docker logs nginx-demo',
    });
    vi.mocked(generateFixPlan).mockResolvedValue({
      summary: 'Check logs',
      steps: [{ command: 'docker logs nginx-demo', description: 'Check', rollback: 'n/a', risk: 'read' as const }],
      complexity: 'simple' as const,
    });
    vi.mocked(generatePlanMarkdown).mockReturnValue('## Plan');
    vi.mocked(formatPlanTable).mockReturnValue('| Step |');

    const result = await runDPEV({
      prompt: 'test',
      provider: mockProvider,
      registry,
      auditLogger: mockAuditLogger,
      validator: mockValidator,
      sessionId: 'test-session',
    });

    expect(result.sessionId).toBe('test-session');
    expect(result.skillMessage).toContain('nginx-troubleshoot');
    expect(result.diagnosis).toBeDefined();
    expect(result.commands).toBeDefined();
    expect(result.discovery).toBeDefined();
    expect(result.fixPlan).toBeDefined();
    expect(result.planMarkdown).toBeDefined();
    expect(result.planTable).toBeDefined();
    expect(result.skillName).toBe('nginx-troubleshoot');
    expect(result.containers).toBeDefined();
  });

  it('handles missing planning skill gracefully', async () => {
    const noPlanRegistry = new SkillRegistry();
    (noPlanRegistry as any).skills = new Map([
      ['nginx-troubleshoot', nginxSkill],
    ]);

    vi.mocked(selectSkill).mockResolvedValue({ skill: nginxSkill, reasoning: 'matched' });
    vi.mocked(runParallelDiscovery).mockResolvedValue({ context: '', raw: {} });
    vi.mocked(runDiagnosis).mockResolvedValue({
      diagnosis: 'Command: docker ps',
    });

    const result = await runDPEV({
      prompt: 'test',
      provider: mockProvider,
      registry: noPlanRegistry,
      auditLogger: mockAuditLogger,
      validator: mockValidator,
      sessionId: 'test-session',
    });

    expect(result.fixPlan).toBeUndefined();
    expect(vi.mocked(generateFixPlan)).not.toHaveBeenCalled();
  });
});
