import { describe, it, expect, vi, beforeEach } from 'vitest';
import { selfHealStep } from '../../src/execution/self-healer.js';
import type { RunResult, SelfHealContext } from '../../src/execution/types.js';
import type { FixStep } from '../../src/orchestrator/types.js';
import { DamageBudget } from '../../src/execution/damage-budget.js';
import { InfraBrainConfigSchema } from '../../src/config/types.js';
import type { SkillFile } from '../../src/skills/types.js';
import type { RewriteRule } from '../../src/execution/dynamic-rewriter.js';

// Mock generateText from 'ai' -- responses controlled per test via mockImplementation
const mockGenerateText = vi.fn();
vi.mock('ai', () => ({
  generateText: (...args: unknown[]) => mockGenerateText(...args),
}));

// --- Helpers ---

/**
 * Create a realistic skill with chown/chmod/ls/stat/id tools
 * matching the linux-expert universal skill pattern.
 */
function makeLinuxSkill(): SkillFile {
  return {
    frontmatter: {
      name: 'linux-expert',
      description: 'Linux filesystem troubleshooting',
      triggers: ['permission', 'denied', 'chown', 'chmod'],
      tools: {
        chown: { risk: 'write', user: '0' },
        chmod: { risk: 'write', user: '0' },
        ls: { risk: 'read' },
        stat: { risk: 'read' },
        id: { risk: 'read' },
        docker: { risk: 'write' },
      } as any,
      priority: 0,
      rewrite_rules: [],
      discovery: [],
      negative_triggers: [],
      when_not_to_use: [],
    },
    sections: { systemPrompt: 'You are a Linux filesystem troubleshooting expert.' },
    rawContent: '',
    filePath: '/tmp/linux-expert.md',
  };
}

/**
 * Create rewrite rules matching the linux-expert tool declarations.
 * These are the same rules toolsToRewriteRules() would generate.
 */
function makeRewriteRules(): RewriteRule[] {
  return [
    { match: '^chown\\b', container: 'auto', user: '0', risk: 'write' },
    { match: '^chmod\\b', container: 'auto', user: '0', risk: 'write' },
    { match: '^ls\\b', container: 'auto', risk: 'read' },
    { match: '^stat\\b', container: 'auto', risk: 'read' },
    { match: '^id\\b', container: 'auto', risk: 'read' },
    { match: '^docker\\b', container: 'auto', risk: 'write' },
  ];
}

function makeContext(overrides: Partial<SelfHealContext> = {}): SelfHealContext {
  return {
    maxAttempts: 3,
    budget: new DamageBudget(10),
    model: { specificationVersion: 'v2' } as any,
    modelId: 'test-model',
    skill: makeLinuxSkill(),
    runner: {
      run: vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 }),
    },
    rewriteRules: makeRewriteRules(),
    containers: ['permission-trap-app-1'],
    config: InfraBrainConfigSchema.parse({}),
    auditLogger: {
      logExecution: vi.fn(),
    },
    stepDescription: 'Fix file permissions on /app/data',
    toolList: 'chown, chmod, ls, stat, id, docker',
    containerContext: 'Container: permission-trap-app-1 (running)',
    stepRisk: 'write',
    ...overrides,
  };
}

function makeStep(overrides: Partial<FixStep> = {}): FixStep {
  return {
    command: 'docker exec -u 0 permission-trap-app-1 chown -u 0 1000:1000 /app/data',
    description: 'Fix file permissions',
    risk: 'write',
    rollback: '',
    ...overrides,
  };
}

// --- Integration Tests ---

describe('Self-Healer Integration', () => {
  beforeEach(() => {
    mockGenerateText.mockReset();
  });

  it('Scenario 1: bad chown flag -> LLM corrects -> safety validates -> rewriter wraps -> success', async () => {
    // Setup: command fails with "invalid option -- 'u'" because chown doesn't have a -u flag
    const failedResult: RunResult = {
      stdout: '',
      stderr: "chown: invalid option -- 'u'\nTry 'chown --help' for more information.",
      exitCode: 1,
    };

    const step = makeStep({
      command: 'docker exec -u 0 permission-trap-app-1 chown -u 0 1000:1000 /app/data',
      description: 'Fix ownership of /app/data directory',
      risk: 'write',
    });

    // LLM returns the corrected bare command (without docker exec wrapper)
    // The safety pipeline + dynamic rewriter will wrap it back
    // First call: correction prompt -> corrected command
    // Second call: effect verification prompt -> verification command
    mockGenerateText
      .mockResolvedValueOnce({ text: 'chown 1000:1000 /app/data' })
      .mockResolvedValueOnce({ text: 'stat -c "%U:%G" /app/data' });

    // Runner succeeds on the corrected command and verification
    const mockRunner = {
      run: vi.fn()
        .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 })  // corrected command succeeds
        .mockResolvedValueOnce({ stdout: '1000:1000', stderr: '', exitCode: 0 }),  // verification succeeds
    };

    const ctx = makeContext({
      runner: mockRunner,
      stepRisk: 'write',
    });

    const result = await selfHealStep(step, failedResult, ctx);

    expect(result.status).toBe('success');
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0].outcome).toBe('success');
    // The corrected command should have been through the dynamic rewriter
    // (wrapping bare chown into docker exec -u 0 container chown ...)
    expect(result.commandUsed).toContain('chown');
    expect(result.commandUsed).toContain('1000:1000');
    expect(result.commandUsed).toContain('/app/data');
    // Should be wrapped in docker exec by the rewriter
    expect(result.commandUsed).toContain('docker exec');
    expect(result.commandUsed).toContain('permission-trap-app-1');

    // Audit logger should have been called
    expect(ctx.auditLogger.logExecution).toHaveBeenCalledWith(
      'self_heal_attempt',
      expect.objectContaining({
        attempt: 1,
        outcome: 'success',
      }),
    );
  });

  it('Scenario 2: LLM returns blocked command first, then corrects on retry', async () => {
    const failedResult: RunResult = {
      stdout: '',
      stderr: 'Permission denied',
      exitCode: 1,
    };

    const step = makeStep({
      command: 'docker exec permission-trap-app-1 chown 1000:1000 /app/data',
      description: 'Fix ownership',
      risk: 'write',
    });

    // First response: rm is not in the skill's tool allowlist -> blocked by safety
    // Second response: valid chown command -> allowed
    // Third response: effect verification command
    mockGenerateText
      .mockResolvedValueOnce({ text: 'rm -rf /app/data' })
      .mockResolvedValueOnce({ text: 'chown 1000:1000 /app/data' })
      .mockResolvedValueOnce({ text: 'ls -la /app/data' });

    const mockRunner = {
      run: vi.fn()
        .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 })  // corrected command succeeds
        .mockResolvedValueOnce({ stdout: 'drwxr-xr-x 2 1000 1000', stderr: '', exitCode: 0 }),  // verification
    };

    const ctx = makeContext({
      runner: mockRunner,
    });

    const result = await selfHealStep(step, failedResult, ctx);

    expect(result.status).toBe('success');
    expect(result.attempts).toHaveLength(2);
    // First attempt blocked by safety
    expect(result.attempts[0].outcome).toBe('blocked_by_safety');
    // Second attempt succeeded
    expect(result.attempts[1].outcome).toBe('success');

    // Both attempts should be audited
    expect(ctx.auditLogger.logExecution).toHaveBeenCalledWith(
      'self_heal_attempt',
      expect.objectContaining({ attempt: 1, outcome: 'blocked_by_safety' }),
    );
    expect(ctx.auditLogger.logExecution).toHaveBeenCalledWith(
      'self_heal_attempt',
      expect.objectContaining({ attempt: 2, outcome: 'success' }),
    );
  });

  it('Scenario 3: all 3 attempts fail -> returns exhausted', async () => {
    const failedResult: RunResult = {
      stdout: '',
      stderr: 'Operation not permitted',
      exitCode: 1,
    };

    const step = makeStep({
      command: 'chown 1000:1000 /app/data',
      description: 'Fix ownership',
      risk: 'write',
    });

    // All 3 LLM corrections return valid commands but they all fail on execution
    mockGenerateText
      .mockResolvedValueOnce({ text: 'chown -R 1000:1000 /app/data' })
      .mockResolvedValueOnce({ text: 'chown 1000 /app/data' })
      .mockResolvedValueOnce({ text: 'chown 1000:1000 /app' });

    // All 3 corrected commands fail
    const mockRunner = {
      run: vi.fn()
        .mockResolvedValue({ stdout: '', stderr: 'Operation not permitted', exitCode: 1 }),
    };

    const ctx = makeContext({
      runner: mockRunner,
      // No containers -- commands pass through without docker exec wrapping
      containers: [],
      rewriteRules: [],
    });

    const result = await selfHealStep(step, failedResult, ctx);

    expect(result.status).toBe('exhausted');
    expect(result.attempts).toHaveLength(3);
    expect(result.attempts.every(a => a.outcome === 'failed')).toBe(true);

    // Exhaustion event should be audited
    expect(ctx.auditLogger.logExecution).toHaveBeenCalledWith(
      'self_heal_exhausted',
      expect.objectContaining({
        originalCommand: step.command,
        attempts: 3,
      }),
    );
  });

  it('context shape from ExecutionDeps matches SelfHealContext requirements', async () => {
    // This test verifies the context shape matches what the executor builds
    // when correctionModel + skill are present in ExecutionDeps
    const skill = makeLinuxSkill();
    const rewriteRules = makeRewriteRules();
    const containers = ['permission-trap-app-1'];
    const config = InfraBrainConfigSchema.parse({});

    // Verify the context can be constructed from ExecutionDeps fields
    const healContext: SelfHealContext = {
      maxAttempts: config.selfHealing?.maxAttempts ?? 5,
      budget: new DamageBudget(config.damageBudget.maxPoints),
      model: { specificationVersion: 'v2' } as any,
      modelId: 'test-model',
      skill,
      runner: { run: vi.fn().mockResolvedValue({ stdout: 'ok', stderr: '', exitCode: 0 }) },
      rewriteRules,
      containers,
      config,
      auditLogger: { logExecution: vi.fn() },
      stepDescription: 'Fix permissions',
      toolList: 'chown, chmod, ls, stat, id, docker',
      containerContext: `Containers: ${containers.join(', ')}`,
      stepRisk: 'write',
    };

    // Validate the context shape matches what selfHealStep expects
    expect(healContext.maxAttempts).toBe(5);
    expect(healContext.skill.frontmatter.name).toBe('linux-expert');
    expect(healContext.rewriteRules).toHaveLength(6);
    expect(healContext.containers).toEqual(['permission-trap-app-1']);
    expect(healContext.containerContext).toContain('permission-trap-app-1');

    // Run a quick self-heal to prove the context works end-to-end
    // Correction prompt -> corrected command, then verification prompt -> read-only check
    mockGenerateText
      .mockResolvedValueOnce({ text: 'chown 1000:1000 /app/data' })
      .mockResolvedValueOnce({ text: 'stat /app/data' })
      .mockResolvedValueOnce({ text: 'chown 1000:1000 /app/data' })
      .mockResolvedValueOnce({ text: 'stat /app/data' })
      .mockResolvedValueOnce({ text: 'chown 1000:1000 /app/data' })
      .mockResolvedValueOnce({ text: 'stat /app/data' });

    const step = makeStep({ command: 'chown -u 0 1000:1000 /app/data' });
    const failedResult: RunResult = {
      stdout: '',
      stderr: "invalid option -- 'u'",
      exitCode: 1,
    };

    const result = await selfHealStep(step, failedResult, healContext);
    // Should succeed on first correction attempt
    expect(result.status).toBe('success');
  });
});
