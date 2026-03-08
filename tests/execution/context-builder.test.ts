import { describe, it, expect } from 'vitest';
import { RollingContext } from '../../src/execution/context-builder.js';
import type { FixStep } from '../../src/orchestrator/types.js';
import type { RunResult } from '../../src/execution/types.js';

const makeStep = (description: string, command = 'echo test'): FixStep => ({
  command,
  description,
  rollback: '',
  risk: 'read',
});

const makeResult = (stdout: string, exitCode = 0): RunResult => ({
  stdout,
  stderr: '',
  exitCode,
});

describe('RollingContext', () => {
  it('addStepResult stores and getContext returns formatted output', () => {
    const ctx = new RollingContext(10000);
    ctx.addStepResult(0, makeStep('Check service status', 'systemctl status nginx'), makeResult('active (running)'));

    const output = ctx.getContext();
    expect(output).toContain('Step 0');
    expect(output).toContain('Check service status');
    expect(output).toContain('systemctl status nginx');
    expect(output).toContain('active (running)');
    expect(output).toContain('Exit code: 0');
  });

  it('includes multiple step results in order', () => {
    const ctx = new RollingContext(10000);
    ctx.addStepResult(0, makeStep('Step A'), makeResult('output A'));
    ctx.addStepResult(1, makeStep('Step B'), makeResult('output B'));
    ctx.addStepResult(2, makeStep('Step C'), makeResult('output C'));

    const output = ctx.getContext();
    expect(output.indexOf('Step 0')).toBeLessThan(output.indexOf('Step 1'));
    expect(output.indexOf('Step 1')).toBeLessThan(output.indexOf('Step 2'));
  });

  it('includes stderr when present', () => {
    const ctx = new RollingContext(10000);
    const result: RunResult = { stdout: 'out', stderr: 'some warning', exitCode: 0 };
    ctx.addStepResult(0, makeStep('Test'), result);

    const output = ctx.getContext();
    expect(output).toContain('Errors:');
    expect(output).toContain('some warning');
  });

  it('does not include Errors section when stderr is empty', () => {
    const ctx = new RollingContext(10000);
    ctx.addStepResult(0, makeStep('Test'), makeResult('ok'));

    const output = ctx.getContext();
    expect(output).not.toContain('Errors:');
  });

  it('compresses older entries when tokens exceed 80% of budget', () => {
    // Use a very small budget to force compression
    const ctx = new RollingContext(100);

    // Add several steps with large output
    for (let i = 0; i < 5; i++) {
      ctx.addStepResult(i, makeStep(`Step ${i} description`), makeResult('x'.repeat(200)));
    }

    const output = ctx.getContext();

    // Most recent 2 steps (3 and 4) should keep full output
    expect(output).toContain('## Step 3');
    expect(output).toContain('## Step 4');

    // Older steps (0, 1, 2) should be compressed to 1-line summaries
    // Compressed format doesn't use ## header
    const lines = output.split('\n');
    const step0Line = lines.find(l => l.includes('Step 0') && l.includes('OK'));
    expect(step0Line).toBeDefined();
  });

  it('keeps all entries full when within budget', () => {
    const ctx = new RollingContext(100000);

    ctx.addStepResult(0, makeStep('First'), makeResult('short'));
    ctx.addStepResult(1, makeStep('Second'), makeResult('short'));

    const output = ctx.getContext();
    expect(output).toContain('## Step 0');
    expect(output).toContain('## Step 1');
  });

  it('compressed format shows FAILED for non-zero exit', () => {
    const ctx = new RollingContext(50);

    for (let i = 0; i < 4; i++) {
      ctx.addStepResult(i, makeStep(`Step ${i}`), makeResult('x'.repeat(200), i === 0 ? 1 : 0));
    }

    const output = ctx.getContext();
    // Step 0 failed and should show FAILED in compressed format
    const lines = output.split('\n');
    const step0Line = lines.find(l => l.includes('Step 0') && l.includes('FAILED'));
    expect(step0Line).toBeDefined();
  });

  it('returns empty string when no steps added', () => {
    const ctx = new RollingContext(10000);
    expect(ctx.getContext()).toBe('');
  });
});
