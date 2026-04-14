import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { LLMProvider } from '../../src/llm/types.js';
import type { AuditLogger } from '../../src/audit/logger.js';
import { RiskLevel } from '../../src/safety/types.js';
import type { SkillFile } from '../../src/skills/types.js';
import { SkillRegistry } from '../../src/skills/registry.js';
import { StructuredDiagnosisSchema } from '../../src/orchestrator/types.js';

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
  buildMessages: vi.fn(() => ({ system: 'You are a diagnostic specialist.', messages: [] })),
}));
vi.mock('../../src/cache/cache-lookup.js', () => ({
  checkCache: vi.fn().mockResolvedValue({ type: 'miss' }),
}));
vi.mock('../../src/cache/lance-store.js', () => ({
  getCacheStore: vi.fn(() => ({
    init: vi.fn().mockResolvedValue(undefined),
  })),
}));
// Mock memory modules to prevent real LanceDB init attempts
vi.mock('../../src/memory/incident-store.js', () => ({
  getIncidentStore: vi.fn(() => ({
    search: vi.fn().mockResolvedValue([]),
    getRecent: vi.fn().mockResolvedValue([]),
    getStats: vi.fn().mockResolvedValue({ totalIncidents: 0, topDomains: [], successRate: 0 }),
    init: vi.fn().mockResolvedValue(undefined),
  })),
}));
vi.mock('../../src/memory/entity-store.js', () => ({
  getEntityStore: vi.fn(() => ({
    searchByEntities: vi.fn().mockResolvedValue([]),
    searchByType: vi.fn().mockResolvedValue([]),
    init: vi.fn().mockResolvedValue(undefined),
  })),
}));
vi.mock('../../src/memory/wake-up.js', () => ({
  buildWakeUpContext: vi.fn().mockResolvedValue({ pinned: '', evictable: '' }),
}));

import { createDebugRoute } from '../../src/api/routes/debug.js';
import { selectSkill } from '../../src/orchestrator/router.js';
import { generateFixPlan } from '../../src/orchestrator/planner.js';

describe('Postgres Loop Guard (Regression)', () => {
  let mockAuditLogger: Partial<AuditLogger>;
  let postgresSkill: SkillFile;
  let planningSkill: SkillFile;

  beforeEach(() => {
    vi.clearAllMocks();

    mockAuditLogger = {
      logDecision: vi.fn(),
      logCommandValidation: vi.fn(),
      logSkillSelection: vi.fn(),
      logError: vi.fn(),
      logExecution: vi.fn(),
    };

    postgresSkill = {
      frontmatter: {
        name: 'postgres-troubleshoot',
        description: 'Postgres diagnosis',
        triggers: ['postgres'],
        tools: ['docker', 'psql'],
        preferred_model: 'forensic' as any,
        priority: 10,
      },
      sections: { systemPrompt: 'You are a surgical PostgreSQL infrastructure engineer.' },
      rawContent: '',
      filePath: 'skills/postgres-troubleshoot.md',
    };

    planningSkill = {
      frontmatter: { name: 'planning', description: 'Fix planning', triggers: ['plan'], tools: [], priority: 10 },
      sections: { systemPrompt: 'You are a planning specialist.' },
      rawContent: '',
      filePath: 'skills/planning.md',
    };
  });

  it('StructuredDiagnosisSchema enforces max 5 diagnostic steps', () => {
    const sixSteps = {
      steps: Array.from({ length: 6 }, (_, i) => ({
        step: i,
        label: `Step ${i}`,
        command: `docker exec pg psql -c "SELECT ${i}"`,
        output: `result ${i}`,
        finding: `Finding ${i}`,
      })),
      rootCause: 'Connection leak from app',
      correlation: 'app (172.20.0.3) holds 18 idle connections',
      fixPlan: [{ command: 'docker exec pg psql -c "SELECT 1"', risk: 'read' as const, expected: 'ok' }],
    };

    const result = StructuredDiagnosisSchema.safeParse(sixSteps);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some(i => i.message.includes('5') || i.code === 'too_big')).toBe(true);
    }
  });

  it('StructuredDiagnosisSchema accepts valid 5-step diagnosis', () => {
    const fiveSteps = {
      steps: Array.from({ length: 5 }, (_, i) => ({
        step: i,
        label: `Step ${i}`,
        command: `docker exec postgres-demo psql -c "SELECT ${i}"`,
        output: `result ${i}`,
        finding: `Finding ${i}`,
      })),
      rootCause: 'Connection leak from leaky-app',
      correlation: 'leaky-app (172.20.0.3) holds 18 idle connections',
      fixPlan: [
        { command: 'docker exec postgres-demo psql -U postgres -t -c "SELECT pid FROM pg_stat_activity WHERE state=\'idle\'"', risk: 'read' as const, expected: 'List of 18 PIDs' },
        { command: 'docker exec postgres-demo psql -U postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE state=\'idle\'"', risk: 'write' as const, expected: 'Terminate 18 connections' },
        { command: 'docker exec postgres-demo psql -U postgres -t -c "SELECT count(*) FROM pg_stat_activity"', risk: 'read' as const, expected: 'Count drops to 2' },
      ],
    };

    const result = StructuredDiagnosisSchema.safeParse(fiveSteps);
    expect(result.success).toBe(true);
  });

  it('StructuredDiagnosisSchema enforces max 5 fix plan steps', () => {
    const tooManyFixes = {
      steps: [{ step: 0, label: 'Discovery', command: 'docker ps', output: 'pg', finding: 'Found pg' }],
      rootCause: 'Leak',
      correlation: 'app leaks',
      fixPlan: Array.from({ length: 6 }, (_, i) => ({
        command: `step ${i}`,
        risk: 'read' as const,
        expected: `result ${i}`,
      })),
    };

    const result = StructuredDiagnosisSchema.safeParse(tooManyFixes);
    expect(result.success).toBe(false);
  });

  it('rejects LLM output with hallucinated placeholders via sanity checker', async () => {
    const hallucinatingProvider: LLMProvider = {
      model: {} as any,
      registry: { get: () => ({ modelId: 'forensic-mock' } as any), getDefault: () => ({ modelId: 'default-mock' } as any), entries: () => [] } as any,
      async *streamDiagnosis() { yield 'test'; },
      async generateCommand(): Promise<string> {
        // Simulate LLM that hallucinates placeholders on every attempt
        return 'Run: docker exec <postgres-container> psql -U postgres\nAssume the following: 20 connections active';
      },
    };

    vi.mocked(selectSkill).mockResolvedValue({
      skill: postgresSkill,
      reasoning: 'Postgres connection issue',
    });

    const registry = new SkillRegistry();
    (registry as any).skills = new Map([
      ['postgres-troubleshoot', postgresSkill],
      ['planning', planningSkill],
    ]);

    const app = express();
    app.use(express.json());
    app.use('/debug', createDebugRoute(
      hallucinatingProvider,
      mockAuditLogger as AuditLogger,
      (cmd) => ({ allowed: true, riskLevel: RiskLevel.READ, command: cmd }),
      registry,
    ));

    const res = await request(app)
      .post('/debug')
      .send({ prompt: 'Postgres too many connections' });

    // Sanity checker should reject with 422 after retry fails
    expect(res.status).toBe(422);
    expect(res.body.error).toContain('sanity check');
    expect(res.body.violations).toBeDefined();
    expect(res.body.violations.length).toBeGreaterThan(0);
  });

  it('passes when LLM returns clean diagnosis on retry', async () => {
    let callCount = 0;
    const retryableProvider: LLMProvider = {
      model: {} as any,
      registry: { get: () => ({ modelId: 'forensic-mock' } as any), getDefault: () => ({ modelId: 'default-mock' } as any), entries: () => [] } as any,
      async *streamDiagnosis() { yield 'test'; },
      async generateCommand(): Promise<string> {
        callCount++;
        if (callCount === 1) {
          // First call: hallucinate
          return 'Assume the following: postgres-demo has 20 connections';
        }
        // Retry: clean output
        return [
          'Step 0: Container Discovery',
          'Command: docker ps --format "{{.Names}}"',
          'Output: postgres-demo leaky-app',
          'Finding: Two containers running.',
          '',
          'Root Cause: leaky-app (172.20.0.3) holds 18 idle connections to postgres-demo.',
          'Fix Plan:',
          'Command: `docker exec postgres-demo psql -U postgres -t -c "SELECT pid FROM pg_stat_activity WHERE state=\'idle\'"` | Risk: read',
        ].join('\n');
      },
    };

    vi.mocked(selectSkill).mockResolvedValue({
      skill: postgresSkill,
      reasoning: 'Postgres connection issue',
    });

    vi.mocked(generateFixPlan).mockResolvedValue({
      summary: 'Terminate leaked connections',
      complexity: 'moderate',
      steps: [{ command: 'docker exec postgres-demo psql -c "SELECT 1"', description: 'test', risk: 'read', rollback: 'N/A' }],
    });

    const registry = new SkillRegistry();
    (registry as any).skills = new Map([
      ['postgres-troubleshoot', postgresSkill],
      ['planning', planningSkill],
    ]);

    const app = express();
    app.use(express.json());
    app.use('/debug', createDebugRoute(
      retryableProvider,
      mockAuditLogger as AuditLogger,
      (cmd) => ({ allowed: true, riskLevel: RiskLevel.READ, command: cmd }),
      registry,
    ));

    const res = await request(app)
      .post('/debug')
      .send({ prompt: 'Postgres too many connections' });

    // Should succeed on retry
    expect(res.status).toBe(200);
    expect(res.body.diagnosis).toContain('leaky-app');
    expect(callCount).toBe(2); // First call failed, retry succeeded
  });
});
