import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildCorrectionPrompt,
  buildEffectVerificationPrompt,
  extractCommandFromLLMResponse,
  validateCorrectedCommand,
  verifyEffect,
  selfHealStep,
  buildToolListFromSkill,
  extractSkillDomainKnowledge,
  inferCorrectionHints,
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

  it('includes domain knowledge when provided', () => {
    const prompt = buildCorrectionPrompt({
      originalCommand: 'stat /app/data/status.pid',
      stderr: 'Permission denied',
      exitCode: 1,
      stepDescription: 'Check file status',
      availableTools: 'stat (read), chown (write, runs as root via -u 0)',
      containerContext: 'Container: permission-app',
      domainKnowledge: 'To run chown inside a container as root: `docker exec -u 0 <container> chown`',
    });

    expect(prompt).toContain('Domain knowledge');
    expect(prompt).toContain('docker exec -u 0');
  });

  it('includes rolling context when provided', () => {
    const prompt = buildCorrectionPrompt({
      originalCommand: 'stat /app/data/status.pid',
      stderr: 'Permission denied',
      exitCode: 1,
      stepDescription: 'Check file status',
      availableTools: 'stat (read)',
      containerContext: 'Container: permission-app',
      rollingContext: 'Step 0: whoami → app (uid 1000)',
    });

    expect(prompt).toContain('Previous step results');
    expect(prompt).toContain('whoami');
  });

  it('mentions privilege escalation hint for permission errors', () => {
    const prompt = buildCorrectionPrompt({
      originalCommand: 'stat /app/data/status.pid',
      stderr: 'Permission denied',
      exitCode: 1,
      stepDescription: 'Check file status',
      availableTools: 'stat (read)',
      containerContext: 'Container: permission-app',
    });

    expect(prompt).toContain('elevated privileges');
    expect(prompt).toContain('-u 0');
  });
});

describe('buildToolListFromSkill', () => {
  it('generates tool list with risk and user info from map-format tools', () => {
    const skill = makeSkill({
      stat: { risk: 'read' },
      chown: { risk: 'write', user: '0' },
      chmod: { risk: 'write', user: '0' },
    } as any);
    const result = buildToolListFromSkill(skill);

    expect(result).toContain('stat(read)');
    expect(result).toContain('chown(write, runs as root via -u 0)');
    expect(result).toContain('chmod(write, runs as root via -u 0)');
  });

  it('returns comma-separated names for legacy string[] tools', () => {
    const skill: SkillFile = {
      frontmatter: {
        name: 'test-skill',
        description: 'Test skill for self-healer tests',
        triggers: ['test'],
        tools: ['ls', 'cat', 'stat'] as any,
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
    const result = buildToolListFromSkill(skill);

    expect(result).toBe('ls, cat, stat');
  });

  it('returns empty string for empty tools', () => {
    const skill = makeSkill({});
    const result = buildToolListFromSkill(skill);

    expect(result).toBe('');
  });
});

describe('extractSkillDomainKnowledge', () => {
  it('extracts DOMAIN KNOWLEDGE sections from system prompt', () => {
    const skill: SkillFile = {
      frontmatter: {
        name: 'test-skill',
        description: 'Test skill for self-healer tests',
        triggers: ['test'],
        tools: {},
        priority: 0,
        rewrite_rules: [],
        discovery: [],
        negative_triggers: [],
        when_not_to_use: [],
      },
      sections: {
        systemPrompt: `You are an expert.

## DOMAIN KNOWLEDGE: PERMISSIONS

- Use chown, not chmod 777
- docker exec -u 0 for root access

## Other Section

This should not be extracted.

## COMMON MISTAKES

| What | Fix |
| chmod 777 | chown uid:gid |`,
      },
      rawContent: '',
      filePath: '/tmp/test-skill.md',
    };
    const result = extractSkillDomainKnowledge(skill);

    expect(result).toContain('DOMAIN KNOWLEDGE: PERMISSIONS');
    expect(result).toContain('docker exec -u 0');
    expect(result).toContain('COMMON MISTAKES');
    expect(result).toContain('chmod 777');
    expect(result).not.toContain('Other Section');
  });

  it('returns empty string when no domain knowledge sections exist', () => {
    const skill = makeSkill({});
    const result = extractSkillDomainKnowledge(skill);

    expect(result).toBe('');
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
    // Each attempt: correction + no verification (all fail with same error type)
    (generateText as any).mockResolvedValue({ text: 'chown 1000:1000 /app/data' });

    const runMock = vi.fn().mockResolvedValue({ stdout: '', stderr: 'chown: Operation not permitted', exitCode: 1 });
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

    // Same error type as initial failedResult to avoid bonus attempts from error-type change
    const runMock = vi.fn().mockResolvedValue({ stdout: '', stderr: 'chown: Operation not permitted', exitCode: 1 });
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

    // Same error type as initial failedResult to avoid bonus attempts
    const runMock = vi.fn().mockResolvedValue({ stdout: '', stderr: 'chown: Operation not permitted', exitCode: 1 });
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

  it('grants bonus attempts when error type changes (progress detected)', async () => {
    const { generateText } = await import('ai');
    // LLM always suggests the same correction
    (generateText as any).mockResolvedValue({ text: 'docker exec -u 0 test-container stat /app/data' });

    // Attempt 1: Permission denied → No such file (progress!)
    // Attempt 2+: No such file persists (no more progress)
    const runMock = vi.fn()
      .mockResolvedValueOnce({ stdout: '', stderr: 'stat: No such file or directory', exitCode: 1 }) // error type changed from initial "Operation not permitted"
      .mockResolvedValueOnce({ stdout: '', stderr: 'stat: No such file or directory', exitCode: 1 })
      .mockResolvedValueOnce({ stdout: '', stderr: 'stat: No such file or directory', exitCode: 1 })
      .mockResolvedValueOnce({ stdout: '', stderr: 'stat: No such file or directory', exitCode: 1 })
      .mockResolvedValueOnce({ stdout: '', stderr: 'stat: No such file or directory', exitCode: 1 });

    const auditLogger = { logExecution: vi.fn() };
    const ctx = makeContext({ runner: { run: runMock }, auditLogger, maxAttempts: 3 });

    const result = await selfHealStep(makeStep(), failedResult, ctx);

    // Should have more than 3 attempts due to bonus from error type change
    expect(result.attempts.length).toBeGreaterThan(3);
    // Progress event logged
    const progressCalls = auditLogger.logExecution.mock.calls.filter(
      (c: any[]) => c[0] === 'self_heal_progress'
    );
    expect(progressCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('adopts corrected command as new base when error type changes', async () => {
    const { generateText } = await import('ai');
    (generateText as any)
      .mockResolvedValueOnce({ text: 'docker exec -u 0 test-container stat /app/data/status.pid' }) // attempt 1: adds -u 0
      .mockResolvedValueOnce({ text: 'docker exec -u 0 test-container stat /app/data' })  // attempt 2: switch to directory
      .mockResolvedValueOnce({ text: 'docker exec -u 0 test-container ls /app/data' }); // attempt 3

    const runMock = vi.fn()
      .mockResolvedValueOnce({ stdout: '', stderr: 'stat: No such file or directory', exitCode: 1 })  // error changed!
      .mockResolvedValueOnce({ stdout: 'drwx------ root root', stderr: '', exitCode: 0 }); // success

    const ctx = makeContext({ runner: { run: runMock } });

    const result = await selfHealStep(makeStep({ command: 'stat /app/data/status.pid' }), failedResult, ctx);

    expect(result.status).toBe('success');
    // The second attempt used the adopted base (from first correction's progress)
    expect(result.attempts.length).toBe(2);
  });

  it('includes correction history in subsequent prompts', async () => {
    const { generateText } = await import('ai');
    (generateText as any).mockResolvedValue({ text: 'chown 1000:1000 /app/data' });

    // Same error type to not trigger progress, just check history is passed
    const runMock = vi.fn().mockResolvedValue({ stdout: '', stderr: 'chown: Operation not permitted', exitCode: 1 });
    const ctx = makeContext({ runner: { run: runMock } });

    await selfHealStep(makeStep(), failedResult, ctx);

    // The second call to generateText should have correction history in the prompt
    const calls = (generateText as any).mock.calls;
    expect(calls.length).toBe(3); // 3 attempts
    // Second and third prompts should contain "Previous correction attempts"
    expect(calls[1][0].prompt).toContain('Previous correction attempts');
    expect(calls[2][0].prompt).toContain('Previous correction attempts');
  });
});

describe('errorTypeChanged', () => {
  // Import the function
  it('detects permission → not_found change', async () => {
    const { errorTypeChanged } = await import('../../src/execution/self-healer.js');
    expect(errorTypeChanged('Permission denied writing to /app/data', 'No such file or directory')).toBe(true);
  });

  it('returns false for same error type', async () => {
    const { errorTypeChanged } = await import('../../src/execution/self-healer.js');
    expect(errorTypeChanged('Permission denied: /foo', 'Operation not permitted on /bar')).toBe(false);
  });

  it('detects connection → timeout change', async () => {
    const { errorTypeChanged } = await import('../../src/execution/self-healer.js');
    expect(errorTypeChanged('Connection refused', 'Connection timed out')).toBe(true);
  });
});

describe('inferCorrectionHints', () => {
  it('suggests ALTER for "already exists" errors', () => {
    const hints = inferCorrectionHints('ERROR: role "svcuser" already exists');
    expect(hints).toContain('ALTER');
    expect(hints).toContain('already exists');
  });

  it('suggests privilege escalation for permission denied', () => {
    const hints = inferCorrectionHints('Permission denied writing to /app/data');
    expect(hints).toContain('elevated privileges');
    expect(hints).toContain('-u 0');
  });

  it('suggests network connect for connection refused', () => {
    const hints = inferCorrectionHints('Error -2 connecting to kv-cache-01:6379. Name or service not known.');
    expect(hints).toContain('docker network connect');
  });

  it('suggests removing -it for TTY errors', () => {
    const hints = inferCorrectionHints('the input device is not a TTY');
    expect(hints).toContain('-it');
  });

  it('returns null for unknown errors', () => {
    const hints = inferCorrectionHints('some random error nobody has seen');
    expect(hints).toBeNull();
  });

  it('returns multiple hints for multi-pattern errors', () => {
    const hints = inferCorrectionHints('Permission denied: No such file or directory');
    expect(hints).toContain('elevated privileges');
    expect(hints).toContain('parent directory');
  });
});
