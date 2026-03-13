import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { AuditLogger } from '../../src/audit/logger.js';
import type { LLMProvider } from '../../src/llm/types.js';
import type { InfraBrainConfig } from '../../src/config/types.js';
import { createExecuteRoute, type ExecuteRouteDeps } from '../../src/api/routes/execute.js';

// Mock executor to capture deps
const mockExecutePlan = vi.fn();
vi.mock('../../src/execution/executor.js', () => ({
  executePlan: (...args: unknown[]) => mockExecutePlan(...args),
}));

// Mock runner
vi.mock('../../src/execution/runner.js', () => ({
  runCommand: vi.fn(),
  parseCommand: vi.fn(),
}));

const validFixPlan = {
  summary: 'Test plan',
  steps: [
    { command: 'echo hello', description: 'Say hello', rollback: '', risk: 'read' as const },
    { command: 'echo world', description: 'Say world', rollback: '', risk: 'read' as const },
  ],
  complexity: 'moderate',
};

function makeMockAuditLogger(): AuditLogger {
  return {
    logExecution: vi.fn(),
    logDecision: vi.fn(),
    logCommandValidation: vi.fn(),
    logError: vi.fn(),
    logSkillSelection: vi.fn(),
  } as unknown as AuditLogger;
}

function makeMockProvider(): LLMProvider {
  return {
    model: {} as any,
    registry: {} as any,
    async *streamDiagnosis() { yield 'test'; },
    async generateCommand() { return 'test'; },
  };
}

function makeMockConfig(): InfraBrainConfig {
  return {
    ollamaHost: 'http://localhost:11434',
    approvalMode: 'auto',
    damageBudget: 10,
    resumeWindowMs: 86400000,
    maxRetries: 2,
    commandTimeoutMs: 30000,
    sessionDir: '/tmp/test-sessions',
    models: { default: 'test-model' },
  } as InfraBrainConfig;
}

describe('execute route rolling context', () => {
  let auditLogger: AuditLogger;
  let config: InfraBrainConfig;

  beforeEach(() => {
    vi.clearAllMocks();
    auditLogger = makeMockAuditLogger();
    config = makeMockConfig();
    mockExecutePlan.mockResolvedValue({
      status: 'completed',
      stepResults: [],
    });
  });

  it('passes onBeforeStep to executePlan when provider exists', async () => {
    const provider = makeMockProvider();
    const deps: ExecuteRouteDeps = {
      auditLogger,
      config,
      sessionId: 'test-session',
      sessionDir: '/tmp/test',
      provider,
    };

    const app = express();
    app.use(express.json());
    app.use('/execute', createExecuteRoute(deps));

    await request(app)
      .post('/execute')
      .send({ sessionId: 'test-session', fixPlan: validFixPlan, target: 'localhost', adminName: 'admin' });

    expect(mockExecutePlan).toHaveBeenCalledOnce();
    const executionDeps = mockExecutePlan.mock.calls[0][2];
    expect(executionDeps.onBeforeStep).toBeDefined();
    expect(typeof executionDeps.onBeforeStep).toBe('function');
  });

  it('onBeforeStep logs context_injection audit event with stepIndex and contextLength', async () => {
    const provider = makeMockProvider();
    const deps: ExecuteRouteDeps = {
      auditLogger,
      config,
      sessionId: 'test-session',
      sessionDir: '/tmp/test',
      provider,
    };

    // Make executePlan invoke the onBeforeStep callback
    mockExecutePlan.mockImplementation(async (_plan: unknown, _target: unknown, execDeps: any) => {
      if (execDeps.onBeforeStep) {
        await execDeps.onBeforeStep(1, 'Step 0: check disk\nOutput: 80% used');
      }
      return { status: 'completed', stepResults: [] };
    });

    const app = express();
    app.use(express.json());
    app.use('/execute', createExecuteRoute(deps));

    await request(app)
      .post('/execute')
      .send({ sessionId: 'test-session', fixPlan: validFixPlan, target: 'localhost', adminName: 'admin' });

    expect(auditLogger.logExecution).toHaveBeenCalledWith('context_injection', expect.objectContaining({
      stepIndex: 1,
      contextLength: 'Step 0: check disk\nOutput: 80% used'.length,
    }));
  });

  it('onBeforeStep includes contextPreview in the audit event', async () => {
    const provider = makeMockProvider();
    const deps: ExecuteRouteDeps = {
      auditLogger,
      config,
      sessionId: 'test-session',
      sessionDir: '/tmp/test',
      provider,
    };

    const contextString = 'Step 0: check disk\nOutput: 80% used';

    mockExecutePlan.mockImplementation(async (_plan: unknown, _target: unknown, execDeps: any) => {
      if (execDeps.onBeforeStep) {
        await execDeps.onBeforeStep(2, contextString);
      }
      return { status: 'completed', stepResults: [] };
    });

    const app = express();
    app.use(express.json());
    app.use('/execute', createExecuteRoute(deps));

    await request(app)
      .post('/execute')
      .send({ sessionId: 'test-session', fixPlan: validFixPlan, target: 'localhost', adminName: 'admin' });

    expect(auditLogger.logExecution).toHaveBeenCalledWith('context_injection', expect.objectContaining({
      contextPreview: contextString.substring(0, 200),
    }));
  });

  it('does not pass onBeforeStep when no provider (backwards compatible)', async () => {
    const deps: ExecuteRouteDeps = {
      auditLogger,
      config,
      sessionId: 'test-session',
      sessionDir: '/tmp/test',
      // No provider
    };

    const app = express();
    app.use(express.json());
    app.use('/execute', createExecuteRoute(deps));

    await request(app)
      .post('/execute')
      .send({ sessionId: 'test-session', fixPlan: validFixPlan, target: 'localhost', adminName: 'admin' });

    expect(mockExecutePlan).toHaveBeenCalledOnce();
    const executionDeps = mockExecutePlan.mock.calls[0][2];
    expect(executionDeps.onBeforeStep).toBeUndefined();
  });
});
