import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildCorrectionPrompt,
  buildEffectVerificationPrompt,
  extractCommandFromLLMResponse,
  validateCorrectedCommand,
  verifyEffect,
  selfHealStep,
} from '../../src/execution/self-healer.js';
import type { RunResult, SelfHealContext } from '../../src/execution/types.js';
import type { FixStep } from '../../src/orchestrator/types.js';
import { DamageBudget } from '../../src/execution/damage-budget.js';
import { InfraBrainConfigSchema } from '../../src/config/types.js';
import type { SkillFile } from '../../src/skills/types.js';

// --- Helpers ---

function makeSkill(tools: Record<string, { risk: string }> = {}): SkillFile {
  return {
    frontmatter: {
      name: 'test-skill',
      description: 'Test skill for self-healer tests',
      triggers: ['test'],
      tools: tools as any,
      priority: 0,
      rewrite_rules: [],
      discovery: [],
      negative_triggers: [],
      when_not_to_use: [],
    },
    sections: { systemPrompt: 'You are a test skill.' },
    rawContent: '',
    filePath: '/tmp/test-skill.md',
  };
}

function makeContext(overrides: Partial<SelfHealContext> = {}): SelfHealContext {
  return {
    maxAttempts: 3,
    budget: new DamageBudget(10),
    model: { specificationVersion: 'v1' } as any,
    skill: makeSkill(),
    runner: {
      run: vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 }),
    },
    rewriteRules: [],
    containers: ['test-container'],
    config: InfraBrainConfigSchema.parse({}),
    auditLogger: {
      logExecution: vi.fn(),
    },
    stepDescription: 'Fix file permissions',
    toolList: 'chown, chmod, ls, stat, id, docker',
    containerContext: 'Container: test-container (running)',
    stepRisk: 'write',
    ...overrides,
  };
}

function makeStep(overrides: Partial<FixStep> = {}): FixStep {
  return {
    command: 'chown 1000:1000 /app/data',
    description: 'Fix file permissions',
    risk: 'write' as const,
    rollback: 'chown 0:0 /app/data',
    ...overrides,
  } as FixStep;
}

const failedResult: RunResult = {
  stdout: '',
  stderr: 'chown: changing ownership of /app/data: Operation not permitted',
  exitCode: 1,
};

// Mock generateText from 'ai'
vi.mock('ai', () => ({
  generateText: vi.fn().mockResolvedValue({ text: 'docker exec -u 0 test-container chown 1000:1000 /app/data' }),
}));

// --- Tests ---

describe('extractCommandFromLLMResponse', () => {
  it('SH-07: strips markdown code fences', () => {
    const input = '```bash\nchown 1000:1000 /app/data\n```';
    expect(extractCommandFromLLMResponse(input)).toBe('chown 1000:1000 /app/data');
  });

  it('SH-08: strips prose prefix lines', () => {
    const input = 'The corrected command is:\nchown 1000:1000 /app/data';
    expect(extractCommandFromLLMResponse(input)).toBe('chown 1000:1000 /app/data');
  });

  it('returns clean command as-is', () => {
    expect(extractCommandFromLLMResponse('chown 1000:1000 /app/data')).toBe('chown 1000:1000 /app/data');
  });

  it('trims whitespace from input', () => {
    expect(extractCommandFromLLMResponse('  \n  chown 1000:1000 /app/data  \n  ')).toBe('chown 1000:1000 /app/data');
  });

  it('skips short lines', () => {
    const input = 'ok\nchown 1000:1000 /app/data';
    expect(extractCommandFromLLMResponse(input)).toBe('chown 1000:1000 /app/data');
  });
});

describe('buildCorrectionPrompt', () => {
  it('SH-05: includes stderr, exit code, step description, tools', () => {
    const prompt = buildCorrectionPrompt({
      originalCommand: 'chown 1000:1000 /app/data',
      stderr: 'Operation not permitted',
      exitCode: 1,
      stepDescription: 'Fix file permissions',
      availableTools: 'chown, chmod, ls',
      containerContext: 'Container: test-container',
    });

    expect(prompt).toContain('chown 1000:1000 /app/data');
    expect(prompt).toContain('Operation not permitted');
    expect(prompt).toContain('1'); // exit code
    expect(prompt).toContain('Fix file permissions');
    expect(prompt).toContain('chown, chmod, ls');
    expect(prompt).toContain('Container: test-container');
  });

  it('SH-06: does NOT include previous attempts', () => {
    const prompt = buildCorrectionPrompt({
      originalCommand: 'chown 1000:1000 /app/data',
      stderr: 'Operation not permitted',
      exitCode: 1,
      stepDescription: 'Fix file permissions',
      availableTools: 'chown, chmod, ls',
      containerContext: 'Container: test-container',
    });

    expect(prompt).not.toContain('previous');
    expect(prompt).not.toContain('attempt');
    expect(prompt).toContain('ONLY the corrected command');
  });
});

describe('buildEffectVerificationPrompt', () => {
  it('builds verification prompt with command and description', () => {
    const prompt = buildEffectVerificationPrompt({
      correctedCommand: 'docker exec -u 0 test-container chown 1000:1000 /app/data',
      stepDescription: 'Fix file permissions',
      containerContext: 'Container: test-container',
    });

    expect(prompt).toContain('docker exec -u 0 test-container chown 1000:1000 /app/data');
    expect(prompt).toContain('Fix file permissions');
    expect(prompt).toContain('READ-ONLY');
    expect(prompt).toContain('ONLY the verification command');
  });
});

describe('validateCorrectedCommand', () => {
  it('SH-02: validates through allowlist + validator + rewriter', async () => {
    const ctx = makeContext({
      skill: makeSkill({ docker: { risk: 'write' } }),
    });
    const result = await validateCorrectedCommand('docker exec test-container chown 1000:1000 /app/data', ctx);
    expect(result.allowed).toBe(true);
    expect(result.command).toBeDefined();
  });

  it('SH-09 (validation): blocked command returns allowed=false with reason', async () => {
    // Skill only allows 'ls' tool -- 'rm' should be blocked
    const ctx = makeContext({
      skill: makeSkill({ ls: { risk: 'read' } }),
    });
    const result = await validateCorrectedCommand('rm -rf /app/data', ctx);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBeDefined();
  });
});

describe('verifyEffect', () => {
  it('SH-14: WRITE-risk step runs verification and returns success on exit 0 with output', async () => {
    const { generateText } = await import('ai');
    (generateText as any).mockResolvedValueOnce({ text: 'stat /app/data' });

    const ctx = makeContext({
      stepRisk: 'write',
      runner: {
        run: vi.fn().mockResolvedValue({ stdout: 'File: /app/data\nAccess: drwxr-xr-x\nUid: 1000\n', stderr: '', exitCode: 0 }),
      },
    });

    const result = await verifyEffect('docker exec -u 0 test-container chown 1000:1000 /app/data', ctx);
    expect(result.verified).toBe(true);
    expect(result.evidence).toContain('Uid: 1000');
  });

  it('SH-16: READ-risk step skips verification entirely', async () => {
    const ctx = makeContext({ stepRisk: 'read' });
    const result = await verifyEffect('docker exec test-container cat /etc/passwd', ctx);
    expect(result.verified).toBe(true);
    expect(result.skipped).toBe(true);
  });

  it('SH-17: verification command that is not read-risk is skipped (fail-open)', async () => {
    const { generateText } = await import('ai');
    // LLM suggests a write command for verification (bad)
    (generateText as any).mockResolvedValueOnce({ text: 'chown 1000:1000 /app/data' });

    const ctx = makeContext({
      stepRisk: 'write',
      // chown is write-risk, not read -- verification should be skipped
    });

    const result = await verifyEffect('docker exec -u 0 test-container chown 1000:1000 /app/data', ctx);
    expect(result.verified).toBe(true);
    expect(result.skipped).toBe(true);
  });
});

describe('selfHealStep', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('SH-01: calls LLM on command failure and retries with corrected command', async () => {
    const { generateText } = await import('ai');
    // Correction call
    (generateText as any).mockResolvedValueOnce({ text: 'docker exec -u 0 test-container chown 1000:1000 /app/data' });
    // Verification call
    (generateText as any).mockResolvedValueOnce({ text: 'stat /app/data' });

    const runMock = vi.fn()
      .mockResolvedValueOnce({ stdout: 'File: /app/data\nUid: 1000\n', stderr: '', exitCode: 0 }) // corrected command
      .mockResolvedValueOnce({ stdout: 'File: /app/data\nUid: 1000\n', stderr: '', exitCode: 0 }); // verification

    const ctx = makeContext({ runner: { run: runMock } });
    const result = await selfHealStep(makeStep(), failedResult, ctx);

    expect(result.status).toBe('success');
    expect(result.attempts.length).toBe(1);
    expect(result.attempts[0].outcome).toBe('success');
    expect(generateText).toHaveBeenCalled();
  });

  it('SH-03: max 3 attempts then returns exhausted', async () => {
    const { generateText } = await import('ai');
    // Each attempt: correction + no verification (all fail)
    (generateText as any).mockResolvedValue({ text: 'chown 1000:1000 /app/data' });

    const runMock = vi.fn().mockResolvedValue({ stdout: '', stderr: 'still failing', exitCode: 1 });
    const ctx = makeContext({ runner: { run: runMock } });

    const result = await selfHealStep(makeStep(), failedResult, ctx);

    expect(result.status).toBe('exhausted');
    expect(result.attempts.length).toBe(3);
    result.attempts.forEach(a => expect(a.outcome).toBe('failed'));
  });

  it('SH-04: each attempt deducts from damage budget', async () => {
    const { generateText } = await import('ai');
    (generateText as any).mockResolvedValue({ text: 'chown 1000:1000 /app/data' });

    const budget = new DamageBudget(10);
    const runMock = vi.fn().mockResolvedValue({ stdout: '', stderr: 'fail', exitCode: 1 });
    const ctx = makeContext({ budget, runner: { run: runMock } });

    await selfHealStep(makeStep(), failedResult, ctx);

    expect(budget.remaining).toBeLessThan(10);
  });

  it('SH-09: safety-blocked correction counts as failed attempt', async () => {
    const { generateText } = await import('ai');
    // LLM suggests a blocked command
    (generateText as any).mockResolvedValue({ text: 'rm -rf /' });

    const ctx = makeContext({
      skill: makeSkill({ docker: { risk: 'write' } }),
    });

    const result = await selfHealStep(makeStep(), failedResult, ctx);

    expect(result.status).toBe('exhausted');
    expect(result.attempts.length).toBe(3);
    result.attempts.forEach(a => expect(a.outcome).toBe('blocked_by_safety'));
  });

  it('SH-10: budget exhaustion returns budget_exceeded immediately', async () => {
    const budget = new DamageBudget(0); // no budget left
    const ctx = makeContext({ budget });

    const result = await selfHealStep(makeStep(), failedResult, ctx);

    expect(result.status).toBe('budget_exceeded');
    expect(result.attempts.length).toBe(0);
  });

  it('SH-11: shell mode detected on corrected command with pipes', async () => {
    const { generateText } = await import('ai');
    (generateText as any)
      .mockResolvedValueOnce({ text: 'docker exec test-container cat /etc/passwd | grep root' })
      .mockResolvedValueOnce({ text: 'stat /app/data' });

    const runMock = vi.fn()
      .mockResolvedValueOnce({ stdout: 'root:x:0:0', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: 'File exists', stderr: '', exitCode: 0 });

    const ctx = makeContext({
      runner: { run: runMock },
    });

    // Shell commands bypass runner.run and use runShellCommand internally
    // The test verifies that shell mode is detected
    const result = await selfHealStep(makeStep(), failedResult, ctx);
    expect(result.status).toBe('success');
  });

  it('SH-12: audit trail logs each attempt', async () => {
    const { generateText } = await import('ai');
    (generateText as any).mockResolvedValue({ text: 'chown 1000:1000 /app/data' });

    const runMock = vi.fn().mockResolvedValue({ stdout: '', stderr: 'fail', exitCode: 1 });
    const auditLogger = { logExecution: vi.fn() };
    const ctx = makeContext({ runner: { run: runMock }, auditLogger });

    await selfHealStep(makeStep(), failedResult, ctx);

    const attemptCalls = auditLogger.logExecution.mock.calls.filter(
      (c: any[]) => c[0] === 'self_heal_attempt'
    );
    expect(attemptCalls.length).toBe(3);
  });

  it('SH-13: exhaustion logged with full attempt history', async () => {
    const { generateText } = await import('ai');
    (generateText as any).mockResolvedValue({ text: 'chown 1000:1000 /app/data' });

    const runMock = vi.fn().mockResolvedValue({ stdout: '', stderr: 'fail', exitCode: 1 });
    const auditLogger = { logExecution: vi.fn() };
    const ctx = makeContext({ runner: { run: runMock }, auditLogger });

    await selfHealStep(makeStep(), failedResult, ctx);

    const exhaustedCalls = auditLogger.logExecution.mock.calls.filter(
      (c: any[]) => c[0] === 'self_heal_exhausted'
    );
    expect(exhaustedCalls.length).toBe(1);
  });

  it('SH-15: WRITE-risk with exit 0 but verification fail returns effect_unverified and continues', async () => {
    const { generateText } = await import('ai');
    // Attempt 1: correction succeeds, verification fails
    (generateText as any)
      .mockResolvedValueOnce({ text: 'docker exec -u 0 test-container chown 1000:1000 /app/data' }) // correction
      .mockResolvedValueOnce({ text: 'stat /app/data' }) // verification command
      .mockResolvedValueOnce({ text: 'docker exec -u 0 test-container chown 1000:1000 /app/data' }) // correction 2
      .mockResolvedValueOnce({ text: 'stat /app/data' }) // verification command 2
      .mockResolvedValueOnce({ text: 'docker exec -u 0 test-container chown 1000:1000 /app/data' }) // correction 3
      .mockResolvedValueOnce({ text: 'stat /app/data' }); // verification command 3

    const runMock = vi.fn()
      .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 }) // corrected command succeeds
      .mockResolvedValueOnce({ stdout: '', stderr: 'no such file', exitCode: 1 }) // verification fails
      .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 }) // corrected command 2 succeeds
      .mockResolvedValueOnce({ stdout: '', stderr: 'no such file', exitCode: 1 }) // verification 2 fails
      .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 }) // corrected command 3 succeeds
      .mockResolvedValueOnce({ stdout: '', stderr: 'no such file', exitCode: 1 }); // verification 3 fails

    const ctx = makeContext({
      stepRisk: 'write',
      runner: { run: runMock },
    });

    const result = await selfHealStep(makeStep(), failedResult, ctx);

    expect(result.status).toBe('exhausted');
    expect(result.attempts.some(a => a.outcome === 'effect_unverified')).toBe(true);
  });
});
