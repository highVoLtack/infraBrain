import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { LLMProvider } from '../../src/llm/types.js';
import type { AuditLogger } from '../../src/audit/logger.js';
import type { ValidationResult } from '../../src/safety/types.js';
import { RiskLevel } from '../../src/safety/types.js';
import type { SkillFile } from '../../src/skills/types.js';
import { SkillRegistry } from '../../src/skills/registry.js';

// We'll import these once they exist
import { createHealthRoute } from '../../src/api/routes/health.js';
import { createDebugRoute } from '../../src/api/routes/debug.js';
import { createServer } from '../../src/api/server.js';

// Mock orchestrator modules
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

describe('GET /health', () => {
  it('returns 200 with ollama: "connected" when Ollama is reachable', async () => {
    // Mock global fetch to simulate Ollama responding
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ models: [{ name: 'llama3.3:70b' }] }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const app = express();
    app.use('/health', createHealthRoute('http://localhost:11434'));

    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.ollama).toBe('connected');
    expect(res.body.models).toEqual([{ name: 'llama3.3:70b' }]);

    vi.unstubAllGlobals();
  });

  it('returns 200 with ollama: "disconnected" when Ollama is not reachable', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    vi.stubGlobal('fetch', mockFetch);

    const app = express();
    app.use('/health', createHealthRoute('http://localhost:11434'));

    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.ollama).toBe('disconnected');
    expect(res.body.error).toContain('Ollama not detected');

    vi.unstubAllGlobals();
  });
});

describe('POST /debug', () => {
  let mockProvider: LLMProvider;
  let mockAuditLogger: Partial<AuditLogger>;
  let mockValidator: (command: string) => ValidationResult;

  beforeEach(() => {
    mockProvider = {
      model: {} as any,
      async *streamDiagnosis() { yield 'test'; },
      async generateCommand() {
        return 'Diagnosis: port 80 is in use.\nCommand: lsof -i :80';
      },
    };

    mockAuditLogger = {
      logDecision: vi.fn(),
      logCommandValidation: vi.fn(),
    };

    mockValidator = (command: string) => ({
      allowed: true,
      riskLevel: RiskLevel.READ,
      command,
    });
  });

  it('returns 200 with response body when given a prompt', async () => {
    const app = express();
    app.use(express.json());
    app.use('/debug', createDebugRoute(
      mockProvider,
      mockAuditLogger as AuditLogger,
      mockValidator,
    ));

    const res = await request(app)
      .post('/debug')
      .send({ prompt: 'What processes are using port 80?' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('sessionId');
    expect(res.body).toHaveProperty('diagnosis');
    expect(res.body).toHaveProperty('commands');
  });

  it('returns 400 when prompt is missing', async () => {
    const app = express();
    app.use(express.json());
    app.use('/debug', createDebugRoute(
      mockProvider,
      mockAuditLogger as AuditLogger,
      mockValidator,
    ));

    const res = await request(app)
      .post('/debug')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('prompt is required');
  });

  it('generates fix plan when a non-planning skill is selected', async () => {
    // Import mocked modules
    const { selectSkill } = await import('../../src/orchestrator/router.js');
    const { generateFixPlan, generatePlanMarkdown, formatPlanTable } = await import('../../src/orchestrator/planner.js');

    const nginxSkill: SkillFile = {
      frontmatter: { name: 'nginx-troubleshoot', description: 'Nginx 502 diagnosis', triggers: ['nginx', '502'], tools: ['docker', 'curl'], priority: 10 },
      sections: { systemPrompt: 'You are a diagnostic specialist.' },
      rawContent: '',
      filePath: 'skills/nginx-troubleshoot.md',
    };

    const planningSkill: SkillFile = {
      frontmatter: { name: 'planning', description: 'Fix planning', triggers: ['plan'], tools: [], priority: 10 },
      sections: { systemPrompt: 'You are a planning specialist.' },
      rawContent: '',
      filePath: 'skills/planning.md',
    };

    const mockFixPlan = {
      target: 'demo-backend',
      steps: [{ command: 'docker network connect frontend demo-backend', description: 'Connect backend to frontend', rollback: 'docker network disconnect frontend demo-backend', risk: 'write' as const }],
    };

    vi.mocked(selectSkill).mockResolvedValue({ skill: nginxSkill, reasoning: 'Nginx 502 issue detected' });
    vi.mocked(generateFixPlan).mockResolvedValue(mockFixPlan);
    vi.mocked(generatePlanMarkdown).mockReturnValue('## Fix Plan\n1. Connect network');
    vi.mocked(formatPlanTable).mockReturnValue('| Step | Command |');

    // Create a registry with both skills
    const registry = new SkillRegistry();
    // Manually set skills via populate-like mechanism
    (registry as any).skills = new Map([
      ['nginx-troubleshoot', nginxSkill],
      ['planning', planningSkill],
    ]);

    const app = express();
    app.use(express.json());
    app.use('/debug', createDebugRoute(
      mockProvider,
      { ...mockAuditLogger, logSkillSelection: vi.fn(), logError: vi.fn(), logExecution: vi.fn() } as unknown as AuditLogger,
      mockValidator,
      registry,
    ));

    const res = await request(app)
      .post('/debug')
      .send({ prompt: 'Why is Nginx returning 502?' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('fixPlan');
    expect(res.body).toHaveProperty('planMarkdown');
    expect(res.body).toHaveProperty('planTable');
    expect(res.body.skillMessage).toContain('nginx-troubleshoot');
    // Verify generateFixPlan was called with the planning skill, not nginx skill
    expect(vi.mocked(generateFixPlan)).toHaveBeenCalledWith(
      expect.objectContaining({ skill: planningSkill }),
    );
  });

  it('validates commands in LLM response through safety validator', async () => {
    const validatorSpy = vi.fn((command: string) => ({
      allowed: false,
      riskLevel: RiskLevel.BLOCKED,
      reason: 'blocked by test',
      command,
    }));

    const app = express();
    app.use(express.json());
    app.use('/debug', createDebugRoute(
      mockProvider,
      mockAuditLogger as AuditLogger,
      validatorSpy,
    ));

    const res = await request(app)
      .post('/debug')
      .send({ prompt: 'test' });

    expect(res.status).toBe(200);
    expect(validatorSpy).toHaveBeenCalled();
    // The blocked command should appear in the response with allowed: false
    const blockedCmd = res.body.commands.find((c: any) => !c.allowed);
    expect(blockedCmd).toBeDefined();
    expect(blockedCmd.riskLevel).toBe(RiskLevel.BLOCKED);
  });
});

describe('Express error handler', () => {
  it('catches async errors and returns 500 with error message', async () => {
    const failingProvider: LLMProvider = {
      model: {} as any,
      async *streamDiagnosis() { yield 'test'; },
      async generateCommand() {
        throw new Error('LLM provider exploded');
      },
    };

    const mockAuditLogger = {
      logDecision: vi.fn(),
      logCommandValidation: vi.fn(),
      logError: vi.fn(),
    } as unknown as AuditLogger;

    const mockValidator = (command: string) => ({
      allowed: true,
      riskLevel: RiskLevel.READ,
      command,
    });

    const app = express();
    app.use(express.json());
    app.use('/debug', createDebugRoute(failingProvider, mockAuditLogger, mockValidator));
    // Error handler middleware
    app.use((err: any, _req: any, res: any, _next: any) => {
      res.status(500).json({ error: err.message });
    });

    const res = await request(app)
      .post('/debug')
      .send({ prompt: 'test' });

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('LLM provider exploded');
  });
});
