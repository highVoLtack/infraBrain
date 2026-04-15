import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from 'ink-testing-library';

// ---- StreamingText Tests ----
describe('StreamingText', () => {
  it('renders nothing visible with empty text', async () => {
    const { StreamingText } = await import('../../src/ui/components/StreamingText.js');
    const { lastFrame } = render(React.createElement(StreamingText, { text: '' }));
    const frame = lastFrame() ?? '';
    // Empty text should render nothing meaningful
    expect(frame.trim()).toBe('');
  });

  it('renders "hello world" with text="hello world"', async () => {
    const { StreamingText } = await import('../../src/ui/components/StreamingText.js');
    const { lastFrame } = render(React.createElement(StreamingText, { text: 'hello world' }));
    const frame = lastFrame() ?? '';
    expect(frame).toContain('hello world');
  });

  it('windows to last N lines when text exceeds maxLines', async () => {
    const { StreamingText } = await import('../../src/ui/components/StreamingText.js');
    // Generate 30 lines
    const lines = Array.from({ length: 30 }, (_, i) => `line-${i + 1}`).join('\n');
    const { lastFrame } = render(React.createElement(StreamingText, { text: lines, maxLines: 20 }));
    const frame = lastFrame() ?? '';
    // Should NOT contain line-1 through line-10
    expect(frame).not.toContain('line-1\n');
    // Should contain line-30 (last line)
    expect(frame).toContain('line-30');
    // Should contain line-11 (first visible in window)
    expect(frame).toContain('line-11');
  });
});

// ---- DPEVPhaseHeader Tests ----
describe('DPEVPhaseHeader', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows phase name uppercased and model name for active phase', async () => {
    const { DPEVPhaseHeader } = await import('../../src/ui/components/DPEVPhaseHeader.js');
    const now = Date.now();
    const phase = {
      name: 'discovery',
      model: 'Qwen3-32B',
      startedAt: now - 5000,
      status: 'active' as const,
      tokens: '',
    };
    const { lastFrame } = render(React.createElement(DPEVPhaseHeader, { phase }));
    const frame = lastFrame() ?? '';
    expect(frame).toContain('DISCOVERY');
    expect(frame).toContain('Qwen3-32B');
  });

  it('shows checkmark icon for complete phase', async () => {
    const { DPEVPhaseHeader } = await import('../../src/ui/components/DPEVPhaseHeader.js');
    const now = Date.now();
    const phase = {
      name: 'diagnosis',
      model: 'Qwen3-32B',
      startedAt: now - 10000,
      completedAt: now,
      status: 'complete' as const,
      tokens: '',
    };
    const { lastFrame } = render(React.createElement(DPEVPhaseHeader, { phase }));
    const frame = lastFrame() ?? '';
    // checkmark: \u2713
    expect(frame).toContain('\u2713');
  });
});

// ---- CacheHitBanner Tests ----
describe('CacheHitBanner', () => {
  it('renders confidence percentage and source session ID', async () => {
    const { CacheHitBanner } = await import('../../src/ui/components/CacheHitBanner.js');
    const onResponse = vi.fn();
    const { lastFrame } = render(
      React.createElement(CacheHitBanner, {
        confidence: 0.92,
        similarity: 0.88,
        sourceSessionId: 'abc12345-long-id',
        sourceDate: '2026-04-10',
        skillName: 'docker-postgres',
        provider: 'Docker',
        onResponse,
      })
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('92%');
    expect(frame).toContain('abc12345');
    expect(frame).toContain('docker-postgres');
    expect(frame).toContain('Docker');
  });

  it('calls onResponse(true) when Y is pressed', async () => {
    const { CacheHitBanner } = await import('../../src/ui/components/CacheHitBanner.js');
    const onResponse = vi.fn();
    const { stdin, lastFrame } = render(
      React.createElement(CacheHitBanner, {
        confidence: 0.92,
        similarity: 0.88,
        sourceSessionId: 'abc12345',
        sourceDate: '2026-04-10',
        skillName: 'docker-postgres',
        onResponse,
      })
    );
    stdin.write('y');
    expect(onResponse).toHaveBeenCalledWith(true);
  });
});

// ---- StepCard Tests ----
describe('StepCard', () => {
  it('shows step number, command, and checkmark for success status', async () => {
    const { StepCard } = await import('../../src/ui/components/StepCard.js');
    const step = {
      stepIndex: 0,
      total: 3,
      command: 'docker ps',
      risk: 'read',
      status: 'success' as const,
    };
    const { lastFrame } = render(React.createElement(StepCard, { step }));
    const frame = lastFrame() ?? '';
    expect(frame).toContain('1/3');
    expect(frame).toContain('docker ps');
    // checkmark: \u2713
    expect(frame).toContain('\u2713');
  });

  it('shows stderr when status is failed', async () => {
    const { StepCard } = await import('../../src/ui/components/StepCard.js');
    const step = {
      stepIndex: 1,
      total: 3,
      command: 'docker restart nginx',
      risk: 'write',
      status: 'failed' as const,
      stderr: 'Error: container not found',
    };
    const { lastFrame } = render(React.createElement(StepCard, { step }));
    const frame = lastFrame() ?? '';
    // cross: \u2717
    expect(frame).toContain('\u2717');
    expect(frame).toContain('Error: container not found');
  });

  it('shows risk badge with correct label', async () => {
    const { StepCard } = await import('../../src/ui/components/StepCard.js');
    const step = {
      stepIndex: 0,
      total: 1,
      command: 'rm -rf /tmp/test',
      risk: 'destructive',
      status: 'pending' as const,
    };
    const { lastFrame } = render(React.createElement(StepCard, { step }));
    const frame = lastFrame() ?? '';
    expect(frame).toContain('destructive');
  });

  it('shows provider and target when available', async () => {
    const { StepCard } = await import('../../src/ui/components/StepCard.js');
    const step = {
      stepIndex: 0,
      total: 1,
      command: 'docker restart web',
      risk: 'write',
      status: 'running' as const,
      provider: 'Docker',
      target: 'web-container',
    };
    const { lastFrame } = render(React.createElement(StepCard, { step }));
    const frame = lastFrame() ?? '';
    expect(frame).toContain('web-container');
  });
});

// ---- ApprovalWrite Tests ----
describe('ApprovalWrite', () => {
  it('renders command and Y/n prompt', async () => {
    const { ApprovalWrite } = await import('../../src/ui/components/ApprovalWrite.js');
    const onResponse = vi.fn();
    const { lastFrame } = render(
      React.createElement(ApprovalWrite, {
        command: 'docker restart nginx',
        riskLevel: 'write',
        onResponse,
      })
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('docker restart nginx');
    expect(frame).toContain('Y/n');
  });

  it('calls onResponse(true) when Y is pressed', async () => {
    const { ApprovalWrite } = await import('../../src/ui/components/ApprovalWrite.js');
    const onResponse = vi.fn();
    const { stdin } = render(
      React.createElement(ApprovalWrite, {
        command: 'docker restart nginx',
        riskLevel: 'write',
        onResponse,
      })
    );
    stdin.write('Y');
    expect(onResponse).toHaveBeenCalledWith(true);
  });

  it('calls onResponse(false) when N is pressed', async () => {
    const { ApprovalWrite } = await import('../../src/ui/components/ApprovalWrite.js');
    const onResponse = vi.fn();
    const { stdin } = render(
      React.createElement(ApprovalWrite, {
        command: 'docker restart nginx',
        riskLevel: 'write',
        onResponse,
      })
    );
    stdin.write('N');
    expect(onResponse).toHaveBeenCalledWith(false);
  });

  it('shows Approved after Y response', async () => {
    const { ApprovalWrite } = await import('../../src/ui/components/ApprovalWrite.js');
    const onResponse = vi.fn();
    const { stdin, lastFrame } = render(
      React.createElement(ApprovalWrite, {
        command: 'docker restart nginx',
        riskLevel: 'write',
        onResponse,
      })
    );
    stdin.write('y');
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Approved');
  });
});

// ---- ApprovalDestructive Tests ----
describe('ApprovalDestructive', () => {
  it('renders command and "Type target to confirm" prompt', async () => {
    const { ApprovalDestructive } = await import('../../src/ui/components/ApprovalDestructive.js');
    const onResponse = vi.fn();
    const { lastFrame } = render(
      React.createElement(ApprovalDestructive, {
        command: 'docker rm -f nginx',
        target: 'nginx',
        onResponse,
      })
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('docker rm -f nginx');
    expect(frame).toContain('nginx');
  });

  it('calls onResponse(true) when correct target is submitted', async () => {
    const { ApprovalDestructive } = await import('../../src/ui/components/ApprovalDestructive.js');
    const onResponse = vi.fn();
    const { stdin, lastFrame } = render(
      React.createElement(ApprovalDestructive, {
        command: 'docker rm -f nginx',
        target: 'nginx',
        onResponse,
      })
    );
    // Type the target name and submit
    stdin.write('nginx');
    stdin.write('\r');
    expect(onResponse).toHaveBeenCalledWith(true);
  });

  it('shows error when wrong target is submitted', async () => {
    const { ApprovalDestructive } = await import('../../src/ui/components/ApprovalDestructive.js');
    const onResponse = vi.fn();
    const { stdin, lastFrame } = render(
      React.createElement(ApprovalDestructive, {
        command: 'docker rm -f nginx',
        target: 'nginx',
        onResponse,
      })
    );
    // Type wrong target and submit
    stdin.write('wrong');
    stdin.write('\r');
    const frame = lastFrame() ?? '';
    expect(frame).toContain('mismatch');
    expect(onResponse).not.toHaveBeenCalled();
  });
});
