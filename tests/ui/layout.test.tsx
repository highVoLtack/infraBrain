import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---- PanelLayout logic tests ----
// We test the pure layout logic without React rendering since Ink components
// are difficult to unit test outside a real terminal. The key testable behaviors
// are: breakpoint-based panel count, header data fetching, and panel focus borders.

import { getLayoutMode } from '../../src/ui/hooks/useResponsive.js';

describe('PanelLayout breakpoint logic', () => {
  it('full mode (>=120 cols) should specify 3 panels', () => {
    const mode = getLayoutMode(150);
    expect(mode).toBe('full');
    // In full mode, layout renders 3 panels: left (20%), center (55%), right (25%)
  });

  it('compact mode (80-119 cols) should specify 2 panels', () => {
    const mode = getLayoutMode(100);
    expect(mode).toBe('compact');
    // In compact mode, layout renders 2 panels: session (25%), center (75%)
  });

  it('minimal mode (<80 cols) should specify 1 panel', () => {
    const mode = getLayoutMode(60);
    expect(mode).toBe('minimal');
    // In minimal mode, layout renders center panel only
  });

  it('boundary: exactly 120 cols is full mode', () => {
    expect(getLayoutMode(120)).toBe('full');
  });

  it('boundary: exactly 80 cols is compact mode', () => {
    expect(getLayoutMode(80)).toBe('compact');
  });

  it('boundary: 79 cols is minimal mode', () => {
    expect(getLayoutMode(79)).toBe('minimal');
  });
});

// ---- PanelLayout panel config tests ----
import { getPanelConfig, type PanelConfig } from '../../src/ui/layout/PanelLayout.js';

describe('PanelLayout getPanelConfig', () => {
  it('returns 3-panel config in full mode', () => {
    const config = getPanelConfig('full');
    expect(config.panels).toHaveLength(3);
    expect(config.panels[0]!.id).toBe('left');
    expect(config.panels[0]!.flexBasis).toBe('20%');
    expect(config.panels[1]!.id).toBe('center');
    expect(config.panels[1]!.flexBasis).toBe('55%');
    expect(config.panels[2]!.id).toBe('right');
    expect(config.panels[2]!.flexBasis).toBe('25%');
  });

  it('returns 2-panel config in compact mode', () => {
    const config = getPanelConfig('compact');
    expect(config.panels).toHaveLength(2);
    expect(config.panels[0]!.id).toBe('left');
    expect(config.panels[0]!.flexBasis).toBe('25%');
    expect(config.panels[1]!.id).toBe('center');
    expect(config.panels[1]!.flexBasis).toBe('75%');
  });

  it('returns 1-panel config in minimal mode', () => {
    const config = getPanelConfig('minimal');
    expect(config.panels).toHaveLength(1);
    expect(config.panels[0]!.id).toBe('center');
    expect(config.panels[0]!.flexBasis).toBe('100%');
  });

  it('marks focused panel correctly', () => {
    const config = getPanelConfig('full', 'center');
    const centerPanel = config.panels.find(p => p.id === 'center');
    const leftPanel = config.panels.find(p => p.id === 'left');
    expect(centerPanel!.focused).toBe(true);
    expect(leftPanel!.focused).toBe(false);
  });

  it('defaults focus to left panel', () => {
    const config = getPanelConfig('full');
    expect(config.panels[0]!.focused).toBe(true);
  });
});

// ---- HeaderBar data parsing tests ----
import { parseHealthData, type HeaderData } from '../../src/ui/layout/HeaderBar.js';

describe('HeaderBar parseHealthData', () => {
  it('parses health API response into header data', () => {
    const apiResponse = {
      status: 'ok',
      backends: [
        { baseUrl: 'http://localhost:8000/v1', connected: true, models: ['qwen3-32b'], responseTimeMs: 50 },
        { baseUrl: 'http://gpu2:8000/v1', connected: false, error: 'timeout' },
      ],
      summary: 'partial',
      inferenceMode: 'sequential',
    };

    const data = parseHealthData(apiResponse);
    expect(data.inferenceMode).toBe('sequential');
    expect(data.backends).toHaveLength(2);
    expect(data.backends[0]!.connected).toBe(true);
    expect(data.backends[0]!.abbreviatedUrl).toBe('localhost:8000');
    expect(data.backends[1]!.connected).toBe(false);
    expect(data.activeModel).toBe('qwen3-32b');
  });

  it('handles all backends connected', () => {
    const apiResponse = {
      status: 'ok',
      backends: [
        { baseUrl: 'http://localhost:8000/v1', connected: true, models: ['qwen3-32b', 'qwen3-1.7b'] },
      ],
      summary: 'all_connected',
      inferenceMode: 'sequential',
    };

    const data = parseHealthData(apiResponse);
    expect(data.activeModel).toBe('qwen3-32b');
    expect(data.backends).toHaveLength(1);
  });

  it('handles no backends connected', () => {
    const apiResponse = {
      status: 'ok',
      backends: [
        { baseUrl: 'http://localhost:8000/v1', connected: false, error: 'timeout' },
      ],
      summary: 'all_disconnected',
      inferenceMode: 'sequential',
    };

    const data = parseHealthData(apiResponse);
    expect(data.activeModel).toBe('?');
    expect(data.backends[0]!.connected).toBe(false);
  });

  it('handles empty backends array', () => {
    const apiResponse = {
      status: 'ok',
      backends: [],
      summary: 'all_disconnected',
      inferenceMode: 'sequential',
    };

    const data = parseHealthData(apiResponse);
    expect(data.activeModel).toBe('?');
    expect(data.backends).toHaveLength(0);
  });

  it('returns "InfraBrain" as title', () => {
    const apiResponse = {
      status: 'ok',
      backends: [],
      summary: 'all_disconnected',
      inferenceMode: 'parallel',
    };

    const data = parseHealthData(apiResponse);
    expect(data.title).toBe('InfraBrain v1.3');
    expect(data.inferenceMode).toBe('parallel');
  });
});
