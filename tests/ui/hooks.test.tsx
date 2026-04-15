import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseSSEStream } from '../../src/ui/hooks/useSSE.js';
import { getLayoutMode } from '../../src/ui/hooks/useResponsive.js';
import { usePanel } from '../../src/ui/hooks/usePanel.js';
import { riskColor, statusIcon, providerBadge, theme } from '../../src/ui/theme.js';
import { SSE_EVENT_NAMES } from '../../src/ui/types.js';

// ---- parseSSEStream tests ----
describe('parseSSEStream', () => {
  it('yields event/data pairs from SSE text chunks', async () => {
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

// ---- useResponsive tests (testing pure breakpoint logic) ----
describe('useResponsive (getLayoutMode)', () => {
  it('returns "full" mode for columns >= 120', () => {
    expect(getLayoutMode(150)).toBe('full');
  });

  it('returns "compact" mode for columns 80-119', () => {
    expect(getLayoutMode(100)).toBe('compact');
  });

  it('returns "minimal" mode for columns < 80', () => {
    expect(getLayoutMode(60)).toBe('minimal');
  });

  it('returns "full" at exactly 120 columns', () => {
    expect(getLayoutMode(120)).toBe('full');
  });

  it('returns "compact" at exactly 80 columns', () => {
    expect(getLayoutMode(80)).toBe('compact');
  });

  it('returns "minimal" at 79 columns', () => {
    expect(getLayoutMode(79)).toBe('minimal');
  });

  it('returns "compact" at 119 columns', () => {
    expect(getLayoutMode(119)).toBe('compact');
  });
});

// ---- usePanel tests ----
describe('usePanel', () => {
  it('starts with "left" as active panel', () => {
    const result = usePanel();
    expect(result.activePanel).toBe('left');
  });

  it('cycles left -> center -> right -> left', () => {
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
    it('returns green for "read"', () => {
      expect(riskColor('read')).toBe('green');
    });

    it('returns yellow for "write"', () => {
      expect(riskColor('write')).toBe('yellow');
    });

    it('returns red for "destructive"', () => {
      expect(riskColor('destructive')).toBe('red');
    });

    it('returns gray for "blocked"', () => {
      expect(riskColor('blocked')).toBe('gray');
    });

    it('returns gray for unknown risk levels', () => {
      expect(riskColor('unknown')).toBe('gray');
    });
  });

  describe('statusIcon', () => {
    it('returns spinner char for "active"', () => {
      expect(statusIcon('active')).toBe('\u25CB');
    });

    it('returns checkmark for "complete"', () => {
      expect(statusIcon('complete')).toBe('\u2713');
    });

    it('returns cross for "error"', () => {
      expect(statusIcon('error')).toBe('\u2717');
    });

    it('returns dot for "pending"', () => {
      expect(statusIcon('pending')).toBe('\u00B7');
    });
  });

  describe('providerBadge', () => {
    it('returns blue badge for Docker', () => {
      const badge = providerBadge('Docker');
      expect(badge.label).toBe('Docker');
      expect(badge.color).toBe('blue');
    });

    it('returns cyan badge for Postgres', () => {
      const badge = providerBadge('Postgres');
      expect(badge.label).toBe('Postgres');
      expect(badge.color).toBe('cyan');
    });

    it('returns green badge for Nginx', () => {
      const badge = providerBadge('Nginx');
      expect(badge.label).toBe('Nginx');
      expect(badge.color).toBe('green');
    });

    it('returns white badge for unknown provider', () => {
      const badge = providerBadge('SomeService');
      expect(badge.label).toBe('SomeService');
      expect(badge.color).toBe('white');
    });
  });

  describe('theme object', () => {
    it('exports color palette constants', () => {
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
  it('covers all required event types', () => {
    const eventNames: Record<string, string> = SSE_EVENT_NAMES;

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
