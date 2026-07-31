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

  it('does NOT start setInterval in replay mode (status=active with completedAt defined)', async () => {
    const { DPEVPhaseHeader } = await import('../../src/ui/components/DPEVPhaseHeader.js');
    // Spy on setInterval to detect whether a timer was started
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    setIntervalSpy.mockClear();
    // Replay mode: phase is in 'active' status but has completedAt set (from replay rebuild)
    const started = 1_000_000;
    const completed = 1_005_000; // 5 seconds elapsed
    const phase = {
      name: 'discovery',
      model: 'Qwen3-32B',
      startedAt: started,
      completedAt: completed,
      status: 'active' as const,
      tokens: '',
    };
    const { lastFrame, unmount } = render(React.createElement(DPEVPhaseHeader, { phase }));
    const initialFrame = lastFrame() ?? '';
    // Should show fixed elapsed time (5s) from startedAt to completedAt
    expect(initialFrame).toContain('5s');
    // CORE BUG CHECK: setInterval must NOT have been called (no wasted timer in replay mode)
    expect(setIntervalSpy).not.toHaveBeenCalled();
    unmount();
    setIntervalSpy.mockRestore();
  });

  it('shows fixed elapsed time when completedAt is defined (complete phase)', async () => {
    const { DPEVPhaseHeader } = await import('../../src/ui/components/DPEVPhaseHeader.js');
    const started = 1_000_000;
    const completed = 1_012_000; // 12 seconds elapsed
    const phase = {
      name: 'discovery',
      model: 'Qwen3-32B',
      startedAt: started,
      completedAt: completed,
      status: 'complete' as const,
      tokens: '',
    };
    const { lastFrame } = render(React.createElement(DPEVPhaseHeader, { phase }));
    const frame = lastFrame() ?? '';
    expect(frame).toContain('12s');
  });

  it('starts timer ONLY when status=active AND completedAt is undefined', async () => {
    const { DPEVPhaseHeader } = await import('../../src/ui/components/DPEVPhaseHeader.js');
    // Live mode: active phase with no completedAt — timer should tick
    const baseTime = 2_000_000;
    vi.setSystemTime(baseTime);
    const phase = {
      name: 'diagnosis',
      model: 'Qwen3-32B',
      startedAt: baseTime - 2000, // started 2s ago
      status: 'active' as const,
      tokens: '',
    };
    const { lastFrame, rerender } = render(React.createElement(DPEVPhaseHeader, { phase }));
    const initialFrame = lastFrame() ?? '';
    // At start, elapsed is 2s
    expect(initialFrame).toContain('2s');
    // Advance timers by 3s — timer should tick once per second, so three setInterval callbacks fire
    vi.advanceTimersByTime(3000);
    rerender(React.createElement(DPEVPhaseHeader, { phase }));
    const afterTickFrame = lastFrame() ?? '';
    // Now elapsed should be 5s (2s initial + 3s ticked)
    expect(afterTickFrame).toContain('5s');
  });
});

// ---- PlanView Tests ----
describe('formatPlanSteps', () => {
  it('extracts steps with index, command, description, risk, rollback from valid fixPlan', async () => {
    const { formatPlanSteps } = await import('../../src/ui/components/PlanView.js');
    const fixPlan = {
      summary: 'Restart nginx',
      steps: [
        { command: 'docker exec nginx nginx -t', description: 'Test config', rollback: '', risk: 'read' },
        { command: 'docker restart nginx', description: 'Restart service', rollback: 'docker start nginx', risk: 'write' },
      ],
      complexity: 'simple',
    };
    const steps = formatPlanSteps(fixPlan);
    expect(steps).toHaveLength(2);
    expect(steps[0].index).toBe(0);
    expect(steps[0].command).toBe('docker exec nginx nginx -t');
    expect(steps[0].description).toBe('Test config');
    expect(steps[0].risk).toBe('read');
    expect(steps[0].rollback).toBe('');
    expect(steps[1].index).toBe(1);
    expect(steps[1].risk).toBe('write');
    expect(steps[1].rollback).toBe('docker start nginx');
  });

  it('returns empty array for undefined fixPlan', async () => {
    const { formatPlanSteps } = await import('../../src/ui/components/PlanView.js');
    expect(formatPlanSteps(undefined)).toEqual([]);
  });

  it('returns empty array for null fixPlan', async () => {
    const { formatPlanSteps } = await import('../../src/ui/components/PlanView.js');
    // @ts-expect-error testing runtime null handling
    expect(formatPlanSteps(null)).toEqual([]);
  });

  it('returns empty array when steps is not an array', async () => {
    const { formatPlanSteps } = await import('../../src/ui/components/PlanView.js');
    expect(formatPlanSteps({ steps: 'not an array' })).toEqual([]);
    expect(formatPlanSteps({})).toEqual([]);
  });

  it('fills missing fields with sensible defaults', async () => {
    const { formatPlanSteps } = await import('../../src/ui/components/PlanView.js');
    const fixPlan = {
      steps: [
        { command: 'ls' }, // missing description, risk, rollback
      ],
    };
    const steps = formatPlanSteps(fixPlan);
    expect(steps[0].command).toBe('ls');
    expect(steps[0].description).toBe('');
    expect(steps[0].risk).toBe('read'); // default
    expect(steps[0].rollback).toBe('');
  });
});

describe('PlanView', () => {
  it('renders numbered steps with risk badges', async () => {
    const { PlanView } = await import('../../src/ui/components/PlanView.js');
    const fixPlan = {
      summary: 'Restart nginx service',
      steps: [
        { command: 'docker exec nginx nginx -t', description: 'Test config', rollback: '', risk: 'read' },
        { command: 'docker restart nginx', description: 'Restart service', rollback: 'docker start nginx', risk: 'write' },
      ],
      complexity: 'simple',
    };
    const { lastFrame } = render(React.createElement(PlanView, { fixPlan }));
    const frame = lastFrame() ?? '';
    expect(frame).toContain('1.');
    expect(frame).toContain('2.');
    expect(frame).toContain('docker exec nginx nginx -t');
    expect(frame).toContain('docker restart nginx');
    expect(frame).toContain('[read]');
    expect(frame).toContain('[write]');
  });

  it('renders step descriptions', async () => {
    const { PlanView } = await import('../../src/ui/components/PlanView.js');
    const fixPlan = {
      summary: 'Restart nginx',
      steps: [
        { command: 'docker restart nginx', description: 'Restart the nginx service to apply config', rollback: '', risk: 'write' },
      ],
      complexity: 'simple',
    };
    const { lastFrame } = render(React.createElement(PlanView, { fixPlan }));
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Restart the nginx service to apply config');
  });

  it('renders plan summary and complexity badge', async () => {
    const { PlanView } = await import('../../src/ui/components/PlanView.js');
    const fixPlan = {
      summary: 'Fix nginx 502 error',
      steps: [
        { command: 'docker restart nginx', description: '', rollback: '', risk: 'write' },
      ],
      complexity: 'moderate',
    };
    const { lastFrame } = render(React.createElement(PlanView, { fixPlan }));
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Fix nginx 502 error');
    expect(frame).toContain('moderate');
  });

  it('renders empty state when no steps exist', async () => {
    const { PlanView } = await import('../../src/ui/components/PlanView.js');
    const { lastFrame } = render(React.createElement(PlanView, { fixPlan: undefined }));
    const frame = lastFrame() ?? '';
    expect(frame).toContain('No fix plan available');
  });

  it('renders empty state when fixPlan has no steps', async () => {
    const { PlanView } = await import('../../src/ui/components/PlanView.js');
    const fixPlan = { summary: 'Empty plan', steps: [], complexity: 'simple' };
    const { lastFrame } = render(React.createElement(PlanView, { fixPlan }));
    const frame = lastFrame() ?? '';
    expect(frame).toContain('No fix plan available');
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
    // Wait for React state flush
    await new Promise(resolve => setTimeout(resolve, 50));
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
    const { stdin } = render(
      React.createElement(ApprovalDestructive, {
        command: 'docker rm -f nginx',
        target: 'nginx',
        onResponse,
      })
    );
    // Type each character individually then submit
    for (const ch of 'nginx') {
      stdin.write(ch);
    }
    await new Promise(resolve => setTimeout(resolve, 50));
    stdin.write('\r');
    await new Promise(resolve => setTimeout(resolve, 50));
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
    // Type wrong target character-by-character and submit
    for (const ch of 'wrong') {
      stdin.write(ch);
    }
    await new Promise(resolve => setTimeout(resolve, 50));
    stdin.write('\r');
    await new Promise(resolve => setTimeout(resolve, 50));
    const frame = lastFrame() ?? '';
    expect(frame).toContain('mismatch');
    expect(onResponse).not.toHaveBeenCalled();
  });
});

// ---- MarkdownView Tests ----
describe('MarkdownView', () => {
  /** Render a Markdown string through the MarkdownView component and return the frame. */
  async function renderMd(source: string): Promise<string> {
    const { MarkdownView } = await import('../../src/ui/components/MarkdownView.js');
    const { lastFrame } = render(React.createElement(MarkdownView, { children: source }));
    return lastFrame() ?? '';
  }

  it('renders h1 heading visible without # token', async () => {
    const frame = await renderMd('# Root cause');
    expect(frame).toContain('Root cause');
    expect(frame).not.toContain('#');
  });

  it('renders h2 heading visible without ## token', async () => {
    const frame = await renderMd('## Recommended fix');
    expect(frame).toContain('Recommended fix');
    expect(frame).not.toContain('##');
    expect(frame).not.toContain('#');
  });

  it('renders deeper headings (h3..h6) without # tokens', async () => {
    const frame = await renderMd('### Level three\n\n###### Level six');
    expect(frame).toContain('Level three');
    expect(frame).toContain('Level six');
    expect(frame).not.toContain('#');
  });

  it('renders fenced code block without backtick fence markers', async () => {
    const frame = await renderMd('```typescript\nconst x = 1\n```');
    expect(frame).toContain('const x = 1');
    expect(frame).not.toContain('```');
    expect(frame).not.toContain('`');
  });

  it('renders inline code without single-backtick markers', async () => {
    const frame = await renderMd('use `prisma` here');
    expect(frame).toContain('prisma');
    expect(frame).not.toContain('`');
  });

  it('renders bold text without ** markers', async () => {
    const frame = await renderMd('**important**');
    expect(frame).toContain('important');
    expect(frame).not.toContain('**');
    expect(frame).not.toContain('*');
  });

  it('renders italic text without * markers', async () => {
    const frame = await renderMd('*subtle*');
    expect(frame).toContain('subtle');
    expect(frame).not.toContain('*');
  });

  it('renders unordered list with - bullet prefix', async () => {
    const frame = await renderMd('- one\n- two');
    expect(frame).toContain('one');
    expect(frame).toContain('two');
    expect(frame).toContain('-');
  });

  it('renders ordered list with numbered prefix', async () => {
    const frame = await renderMd('1. alpha\n2. beta');
    expect(frame).toContain('alpha');
    expect(frame).toContain('beta');
    expect(frame).toContain('1.');
    expect(frame).toContain('2.');
  });

  it('renders loose lists (paragraph-wrapped list items) too', async () => {
    const frame = await renderMd('- one\n\n- two');
    expect(frame).toContain('one');
    expect(frame).toContain('two');
  });

  it('passes plain text through unchanged', async () => {
    const frame = await renderMd('plain');
    expect(frame).toContain('plain');
  });

  it('renders empty string without crashing', async () => {
    const frame = await renderMd('');
    expect(frame.trim()).toBe('');
  });

  it('renders partial/incomplete markdown without crashing', async () => {
    const partialHeading = await renderMd('## Ro');
    expect(partialHeading).toContain('Ro');
    const partialFence = await renderMd('```partial');
    expect(partialFence).not.toContain('```');
  });

  it('renderMarkdown(undefined) returns an empty Box', async () => {
    const { renderMarkdown } = await import('../../src/ui/components/MarkdownView.js');
    const { lastFrame } = render(renderMarkdown(undefined));
    expect((lastFrame() ?? '').trim()).toBe('');
  });

  it('renderMarkdown produces the same visible output as MarkdownView', async () => {
    const { renderMarkdown, MarkdownView } = await import(
      '../../src/ui/components/MarkdownView.js'
    );
    const source = '# Title\n\nSome **bold** text';
    const pure = render(renderMarkdown(source)).lastFrame() ?? '';
    const component = render(React.createElement(MarkdownView, { children: source })).lastFrame() ?? '';
    expect(component).toBe(pure);
  });

  it('renders a mixed document with headings, code, and lists together', async () => {
    const frame = await renderMd(
      '# Diagnosis\n\nThe `nginx` upstream is down.\n\n```bash\ndocker restart nginx\n```\n\n- check logs\n- restart service'
    );
    expect(frame).toContain('Diagnosis');
    expect(frame).toContain('nginx');
    expect(frame).toContain('docker restart nginx');
    expect(frame).toContain('check logs');
    expect(frame).toContain('restart service');
    expect(frame).not.toContain('#');
    expect(frame).not.toContain('`');
  });
});
