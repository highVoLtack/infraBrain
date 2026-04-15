import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- parseSSEStream tests ----
describe('parseSSEStream', () => {
  it('yields event/data pairs from SSE text chunks', async () => {
    const { parseSSEStream } = await import('../../src/ui/hooks/useSSE.js');

    // Mock a ReadableStream with SSE-formatted text
    const sseText =
      'event: dpev:phase\ndata: {"phase":"discovery","model":"qwen3-32b","status":"active"}\n\n' +
      'event: dpev:token\ndata: {"text":"analyzing","phase":"discovery"}\n\n';

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(sseText));
        controller.close();
      },
    });

    const mockResponse = { body: stream } as unknown as Response;
    const events: Array<{ event: string; data: string }> = [];
    for await (const ev of parseSSEStream(mockResponse)) {
      events.push(ev);
    }

    expect(events).toHaveLength(2);
    expect(events[0]!.event).toBe('dpev:phase');
    expect(JSON.parse(events[0]!.data)).toEqual({
      phase: 'discovery',
      model: 'qwen3-32b',
      status: 'active',
    });
    expect(events[1]!.event).toBe('dpev:token');
    expect(JSON.parse(events[1]!.data)).toEqual({
      text: 'analyzing',
      phase: 'discovery',
    });
  });

  it('handles chunks split across reads', async () => {
    const { parseSSEStream } = await import('../../src/ui/hooks/useSSE.js');

    const chunk1 = 'event: dpev:phase\nda';
    const chunk2 = 'ta: {"phase":"diagnosis"}\n\n';

    const encoder = new TextEncoder();
    let callCount = 0;
    const stream = new ReadableStream({
      pull(controller) {
        if (callCount === 0) {
          controller.enqueue(encoder.encode(chunk1));
          callCount++;
        } else if (callCount === 1) {
          controller.enqueue(encoder.encode(chunk2));
          callCount++;
        } else {
          controller.close();
        }
      },
    });

    const mockResponse = { body: stream } as unknown as Response;
    const events: Array<{ event: string; data: string }> = [];
    for await (const ev of parseSSEStream(mockResponse)) {
      events.push(ev);
    }

    expect(events).toHaveLength(1);
    expect(events[0]!.event).toBe('dpev:phase');
    expect(JSON.parse(events[0]!.data)).toEqual({ phase: 'diagnosis' });
  });
});

// ---- useResponsive tests ----
describe('useResponsive', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns "full" mode for columns >= 120', async () => {
    vi.doMock('ink', () => ({
      useWindowSize: () => ({ columns: 150, rows: 40 }),
    }));
    const { useResponsive } = await import('../../src/ui/hooks/useResponsive.js');
    const result = useResponsive();
    expect(result.mode).toBe('full');
    expect(result.columns).toBe(150);
    expect(result.rows).toBe(40);
    vi.doUnmock('ink');
  });

  it('returns "compact" mode for columns 80-119', async () => {
    vi.doMock('ink', () => ({
      useWindowSize: () => ({ columns: 100, rows: 30 }),
    }));
    const { useResponsive } = await import('../../src/ui/hooks/useResponsive.js');
    const result = useResponsive();
    expect(result.mode).toBe('compact');
    expect(result.columns).toBe(100);
    vi.doUnmock('ink');
  });

  it('returns "minimal" mode for columns < 80', async () => {
    vi.doMock('ink', () => ({
      useWindowSize: () => ({ columns: 60, rows: 20 }),
    }));
    const { useResponsive } = await import('../../src/ui/hooks/useResponsive.js');
    const result = useResponsive();
    expect(result.mode).toBe('minimal');
    expect(result.columns).toBe(60);
    vi.doUnmock('ink');
  });

  it('returns "full" at exactly 120 columns', async () => {
    vi.doMock('ink', () => ({
      useWindowSize: () => ({ columns: 120, rows: 35 }),
    }));
    const { useResponsive } = await import('../../src/ui/hooks/useResponsive.js');
    const result = useResponsive();
    expect(result.mode).toBe('full');
    vi.doUnmock('ink');
  });

  it('returns "compact" at exactly 80 columns', async () => {
    vi.doMock('ink', () => ({
      useWindowSize: () => ({ columns: 80, rows: 25 }),
    }));
    const { useResponsive } = await import('../../src/ui/hooks/useResponsive.js');
    const result = useResponsive();
    expect(result.mode).toBe('compact');
    vi.doUnmock('ink');
  });
});

// ---- usePanel tests ----
describe('usePanel', () => {
  it('starts with "left" as active panel', () => {
    // Inline implementation test -- usePanel is a plain state hook
    // We test the exported logic directly
    const { usePanel } = require('../../src/ui/hooks/usePanel.js');
    const result = usePanel();
    expect(result.activePanel).toBe('left');
  });

  it('cycles left -> center -> right -> left', () => {
    const { usePanel } = require('../../src/ui/hooks/usePanel.js');
    const panel = usePanel();

    expect(panel.activePanel).toBe('left');
    panel.cyclePanel();
    expect(panel.activePanel).toBe('center');
    panel.cyclePanel();
    expect(panel.activePanel).toBe('right');
    panel.cyclePanel();
    expect(panel.activePanel).toBe('left');
  });

  it('setPanel sets active panel directly', () => {
    const { usePanel } = require('../../src/ui/hooks/usePanel.js');
    const panel = usePanel();

    panel.setPanel('right');
    expect(panel.activePanel).toBe('right');
    panel.setPanel('center');
    expect(panel.activePanel).toBe('center');
  });
});

// ---- theme tests ----
describe('theme', () => {
  describe('riskColor', () => {
    it('returns green for "read"', async () => {
      const { riskColor } = await import('../../src/ui/theme.js');
      expect(riskColor('read')).toBe('green');
    });

    it('returns yellow for "write"', async () => {
      const { riskColor } = await import('../../src/ui/theme.js');
      expect(riskColor('write')).toBe('yellow');
    });

    it('returns red for "destructive"', async () => {
      const { riskColor } = await import('../../src/ui/theme.js');
      expect(riskColor('destructive')).toBe('red');
    });

    it('returns gray for "blocked"', async () => {
      const { riskColor } = await import('../../src/ui/theme.js');
      expect(riskColor('blocked')).toBe('gray');
    });

    it('returns gray for unknown risk levels', async () => {
      const { riskColor } = await import('../../src/ui/theme.js');
      expect(riskColor('unknown')).toBe('gray');
    });
  });

  describe('statusIcon', () => {
    it('returns spinner char for "active"', async () => {
      const { statusIcon } = await import('../../src/ui/theme.js');
      expect(statusIcon('active')).toBe('\u25CB'); // circle
    });

    it('returns checkmark for "complete"', async () => {
      const { statusIcon } = await import('../../src/ui/theme.js');
      expect(statusIcon('complete')).toBe('\u2713'); // checkmark
    });

    it('returns cross for "error"', async () => {
      const { statusIcon } = await import('../../src/ui/theme.js');
      expect(statusIcon('error')).toBe('\u2717'); // cross
    });

    it('returns dot for "pending"', async () => {
      const { statusIcon } = await import('../../src/ui/theme.js');
      expect(statusIcon('pending')).toBe('\u00B7'); // middle dot
    });
  });

  describe('providerBadge', () => {
    it('returns blue badge for Docker', async () => {
      const { providerBadge } = await import('../../src/ui/theme.js');
      const badge = providerBadge('Docker');
      expect(badge.label).toBe('Docker');
      expect(badge.color).toBe('blue');
    });

    it('returns cyan badge for Postgres', async () => {
      const { providerBadge } = await import('../../src/ui/theme.js');
      const badge = providerBadge('Postgres');
      expect(badge.label).toBe('Postgres');
      expect(badge.color).toBe('cyan');
    });

    it('returns green badge for Nginx', async () => {
      const { providerBadge } = await import('../../src/ui/theme.js');
      const badge = providerBadge('Nginx');
      expect(badge.label).toBe('Nginx');
      expect(badge.color).toBe('green');
    });

    it('returns white badge for unknown provider', async () => {
      const { providerBadge } = await import('../../src/ui/theme.js');
      const badge = providerBadge('SomeService');
      expect(badge.label).toBe('SomeService');
      expect(badge.color).toBe('white');
    });
  });

  describe('theme object', () => {
    it('exports color palette constants', async () => {
      const { theme } = await import('../../src/ui/theme.js');
      expect(theme.headerBg).toBeDefined();
      expect(theme.panelBorder).toBeDefined();
      expect(theme.panelBorderFocused).toBeDefined();
      expect(theme.activePhaseBg).toBeDefined();
      expect(theme.dimText).toBeDefined();
    });
  });
});

// ---- SSEEventMap type coverage ----
describe('SSEEventMap types', () => {
  it('covers all required event types', async () => {
    // Type-level test: verify SSEEventMap has all required keys
    // This test will fail to compile if any keys are missing
    const types = await import('../../src/ui/types.js');

    // Runtime check that the type file exports what we expect
    expect(types).toBeDefined();

    // We verify the type structure exists by checking we can reference it
    // The real test is that TypeScript compiles this file without error
    type EventKeys = keyof typeof types.SSE_EVENT_NAMES;
    const eventNames: Record<string, string> = types.SSE_EVENT_NAMES;

    expect(eventNames['PHASE']).toBe('dpev:phase');
    expect(eventNames['TOKEN']).toBe('dpev:token');
    expect(eventNames['DIAGNOSIS']).toBe('dpev:diagnosis');
    expect(eventNames['CACHE_HIT']).toBe('dpev:cache-hit');
    expect(eventNames['PLAN']).toBe('dpev:plan');
    expect(eventNames['STEP']).toBe('exec:step');
    expect(eventNames['APPROVAL']).toBe('exec:approval');
    expect(eventNames['COMPLETE']).toBe('dpev:complete');
    expect(eventNames['ERROR']).toBe('dpev:error');
  });
});
