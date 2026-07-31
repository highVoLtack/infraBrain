import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';

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

// ---- SessionItem logic tests ----
import { formatSessionItem, type SessionItemData } from '../../src/ui/components/SessionItem.js';

describe('SessionItem formatSessionItem', () => {
  it('renders completed session with checkmark', () => {
    const item: SessionItemData = {
      sessionId: 'abc12345-6789-0000-0000-000000000000',
      status: 'completed',
      target: 'nginx-proxy',
      expertDomain: 'Docker',
      timestamp: new Date().toISOString(),
      isActive: false,
    };
    const formatted = formatSessionItem(item);
    expect(formatted.icon).toBe('\u2713');
    expect(formatted.shortId).toBe('abc12345');
    expect(formatted.domainBadge).toBe('[D]');
    expect(formatted.targetName).toBe('nginx-proxy');
  });

  it('renders failed session with cross', () => {
    const item: SessionItemData = {
      sessionId: 'def12345-0000-0000-0000-000000000000',
      status: 'failed',
      target: 'postgres-demo',
      expertDomain: 'Postgres',
      timestamp: new Date().toISOString(),
      isActive: false,
    };
    const formatted = formatSessionItem(item);
    expect(formatted.icon).toBe('\u2717');
    expect(formatted.domainBadge).toBe('[P]');
  });

  it('renders active session with hourglass', () => {
    const item: SessionItemData = {
      sessionId: 'ghi12345-0000-0000-0000-000000000000',
      status: 'active',
      target: 'redis-cache',
      expertDomain: '',
      timestamp: new Date().toISOString(),
      isActive: true,
    };
    const formatted = formatSessionItem(item);
    expect(formatted.icon).toBe('\u231B');
    expect(formatted.isActive).toBe(true);
    expect(formatted.domainBadge).toBe('[-]');
  });

  it('renders Nginx with [N] badge', () => {
    const item: SessionItemData = {
      sessionId: 'jkl12345-0000-0000-0000-000000000000',
      status: 'completed',
      target: 'nginx-reverse',
      expertDomain: 'Nginx',
      timestamp: new Date().toISOString(),
      isActive: false,
    };
    const formatted = formatSessionItem(item);
    expect(formatted.domainBadge).toBe('[N]');
  });

  it('truncates long prompt targets to 40 chars', () => {
    const longPrompt = 'my nginx container keeps crashing with exit code 137 and I dont know why';
    const item: SessionItemData = {
      sessionId: 'xyz12345-0000-0000-0000-000000000000',
      status: 'completed',
      target: longPrompt,
      timestamp: new Date().toISOString(),
      isActive: false,
    };
    const formatted = formatSessionItem(item);
    expect(formatted.targetName.length).toBeLessThanOrEqual(40);
    expect(formatted.targetName).toBe('my nginx container keeps crashing wit...');
  });

  it('does not truncate short targets', () => {
    const shortTarget = 'nginx-proxy';
    const item: SessionItemData = {
      sessionId: 'short123-0000-0000-0000-000000000000',
      status: 'completed',
      target: shortTarget,
      timestamp: new Date().toISOString(),
      isActive: false,
    };
    const formatted = formatSessionItem(item);
    expect(formatted.targetName).toBe('nginx-proxy');
  });
});

// ---- Session grouping tests ----
import { groupSessionsByDate, type DateGroupedSessions } from '../../src/ui/panels/SessionPanel.js';

describe('SessionPanel groupSessionsByDate', () => {
  const now = Date.now();

  it('groups sessions by date category', () => {
    const sessions = [
      { id: 'a', status: 'completed', target: 'nginx', updatedAt: new Date(now - 1000).toISOString(), eventCount: 3 },
      { id: 'b', status: 'failed', target: 'postgres', updatedAt: new Date(now - 30 * 3600 * 1000).toISOString(), eventCount: 5 },
      { id: 'c', status: 'completed', target: 'docker', updatedAt: new Date(now - 5 * 24 * 3600 * 1000).toISOString(), eventCount: 2 },
      { id: 'd', status: 'completed', target: 'redis', updatedAt: new Date(now - 14 * 24 * 3600 * 1000).toISOString(), eventCount: 1 },
    ];

    const grouped = groupSessionsByDate(sessions);
    expect(grouped.today).toHaveLength(1);
    expect(grouped.today[0]!.id).toBe('a');
    expect(grouped.yesterday).toHaveLength(1);
    expect(grouped.yesterday[0]!.id).toBe('b');
    expect(grouped.thisWeek).toHaveLength(1);
    expect(grouped.thisWeek[0]!.id).toBe('c');
    expect(grouped.older).toHaveLength(1);
    expect(grouped.older[0]!.id).toBe('d');
  });

  it('returns empty arrays when no sessions', () => {
    const grouped = groupSessionsByDate([]);
    expect(grouped.today).toHaveLength(0);
    expect(grouped.yesterday).toHaveLength(0);
    expect(grouped.thisWeek).toHaveLength(0);
    expect(grouped.older).toHaveLength(0);
  });
});

// ---- EntityTree logic tests ----
import { groupEntitiesByProvider, type EntityItem } from '../../src/ui/components/EntityTree.js';

describe('EntityTree groupEntitiesByProvider', () => {
  it('groups entities by provider', () => {
    const entities: EntityItem[] = [
      { id: '1', entity_type: 'container', entity_value: 'nginx-proxy', provider: 'Docker', isLive: true },
      { id: '2', entity_type: 'container', entity_value: 'postgres-demo', provider: 'Docker', isLive: true },
      { id: '3', entity_type: 'service', entity_value: 'idle_connections', provider: 'Postgres', isLive: false },
    ];

    const groups = groupEntitiesByProvider(entities);
    expect(groups).toHaveLength(2);
    const dockerGroup = groups.find(g => g.provider === 'Docker');
    expect(dockerGroup).toBeDefined();
    expect(dockerGroup!.entities).toHaveLength(2);
    const pgGroup = groups.find(g => g.provider === 'Postgres');
    expect(pgGroup).toBeDefined();
    expect(pgGroup!.entities).toHaveLength(1);
  });

  it('assigns "Unknown" provider when missing', () => {
    const entities: EntityItem[] = [
      { id: '1', entity_type: 'ip', entity_value: '192.168.1.1', isLive: false },
    ];

    const groups = groupEntitiesByProvider(entities);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.provider).toBe('Unknown');
  });

  it('marks live entities with filled indicator', () => {
    const entities: EntityItem[] = [
      { id: '1', entity_type: 'container', entity_value: 'nginx', provider: 'Docker', isLive: true },
      { id: '2', entity_type: 'container', entity_value: 'old-app', provider: 'Docker', isLive: false },
    ];

    const groups = groupEntitiesByProvider(entities);
    const docker = groups.find(g => g.provider === 'Docker')!;
    expect(docker.entities[0]!.isLive).toBe(true);
    expect(docker.entities[1]!.isLive).toBe(false);
  });
});

// ---- EntityDetail logic tests ----
import { formatEntityDetail, type EntityDetailData } from '../../src/ui/components/EntityDetail.js';

describe('EntityDetail formatEntityDetail', () => {
  it('formats entity with all fields', () => {
    const entity: EntityDetailData = {
      entity_type: 'container',
      entity_value: 'nginx-proxy',
      provider: 'Docker',
      resourceType: 'container',
      valid_from: '2026-04-10T08:00:00Z',
      valid_to: '',
      session_count: 5,
      incident_ids: ['inc-001', 'inc-002'],
    };

    const formatted = formatEntityDetail(entity);
    expect(formatted.type).toBe('container');
    expect(formatted.provider).toBe('Docker');
    expect(formatted.resourceType).toBe('container');
    expect(formatted.firstSeen).toContain('2026-04-10');
    expect(formatted.lastSeen).toBe('Active');
    expect(formatted.sessionCount).toBe(5);
    expect(formatted.incidentIds).toHaveLength(2);
  });

  it('shows "N/A" for missing provider', () => {
    const entity: EntityDetailData = {
      entity_type: 'ip',
      entity_value: '10.0.0.1',
      valid_from: '2026-04-01T00:00:00Z',
      valid_to: '2026-04-05T00:00:00Z',
    };

    const formatted = formatEntityDetail(entity);
    expect(formatted.provider).toBe('N/A');
    expect(formatted.resourceType).toBe('N/A');
    expect(formatted.lastSeen).toContain('2026-04-05');
  });
});

// ---- GET /entities endpoint tests ----
import { mountEntitiesRoute } from '../../src/api/routes/entities.js';

describe('GET /entities endpoint', () => {
  it('returns JSON array of active entities', async () => {
    const mockEntities = [
      { id: '1', entity_type: 'container', entity_value: 'nginx-proxy', valid_from: '2026-04-10T00:00:00Z', valid_to: '' },
      { id: '2', entity_type: 'service', entity_value: 'postgres', valid_from: '2026-04-09T00:00:00Z', valid_to: '' },
    ];

    const mockEntityStore = {
      getActive: vi.fn().mockResolvedValue(mockEntities),
    };

    const app = express();
    mountEntitiesRoute(app, mockEntityStore as any);

    const res = await request(app).get('/entities');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].entity_value).toBe('nginx-proxy');
  });

  it('returns empty array when store is empty', async () => {
    const mockEntityStore = {
      getActive: vi.fn().mockResolvedValue([]),
    };

    const app = express();
    mountEntitiesRoute(app, mockEntityStore as any);

    const res = await request(app).get('/entities');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns empty array when store throws', async () => {
    const mockEntityStore = {
      getActive: vi.fn().mockRejectedValue(new Error('DB error')),
    };

    const app = express();
    mountEntitiesRoute(app, mockEntityStore as any);

    const res = await request(app).get('/entities');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

// ---- SessionPanel filter tests ----
import { filterSessions } from '../../src/ui/panels/SessionPanel.js';

describe('SessionPanel filterSessions', () => {
  it('keeps sessions with real targets regardless of eventCount', () => {
    const sessions = [
      { id: 'a', status: 'active', target: 'debug nginx', updatedAt: new Date().toISOString(), eventCount: 0 },
      { id: 'b', status: 'completed', target: 'fix postgres', updatedAt: new Date().toISOString(), eventCount: 5 },
    ];

    const filtered = filterSessions(sessions, '');
    expect(filtered).toHaveLength(2);
  });

  it('filters out sessions with unknown target', () => {
    const sessions = [
      { id: 'a', status: 'completed', target: 'unknown', updatedAt: new Date().toISOString(), eventCount: 3 },
      { id: 'b', status: 'completed', target: 'nginx fix', updatedAt: new Date().toISOString(), eventCount: 5 },
    ];

    const filtered = filterSessions(sessions, '');
    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.id).toBe('b');
  });

  it('filters out sessions with empty target', () => {
    const sessions = [
      { id: 'a', status: 'completed', target: '', updatedAt: new Date().toISOString(), eventCount: 2 },
      { id: 'b', status: 'completed', target: 'nginx', updatedAt: new Date().toISOString(), eventCount: 1 },
    ];

    const filtered = filterSessions(sessions, '');
    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.id).toBe('b');
  });

  it('applies search query filter', () => {
    const sessions = [
      { id: 'a', status: 'completed', target: 'nginx proxy', updatedAt: new Date().toISOString(), eventCount: 3 },
      { id: 'b', status: 'completed', target: 'postgres fix', updatedAt: new Date().toISOString(), eventCount: 5 },
    ];

    const filtered = filterSessions(sessions, 'nginx');
    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.id).toBe('a');
  });
});

// ---- EntityPanel refreshKey tests ----
// EntityPanel refreshKey is tested by verifying the prop is accepted in the interface
// and the useEffect dependency triggers re-fetch. Since EntityPanel is a React component,
// we test the re-fetch behavior through a controlled fetch mock.

import React from 'react';
import { render } from 'ink-testing-library';
import { EntityPanel } from '../../src/ui/panels/EntityPanel.js';

describe('EntityPanel refreshKey', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('re-fetches entities when refreshKey changes', async () => {
    let fetchCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(() => {
      fetchCount++;
      return Promise.resolve({
        ok: true,
        json: async () => ([]),
      });
    });

    const { rerender } = render(
      React.createElement(EntityPanel, { apiBaseUrl: 'http://localhost:3000', refreshKey: 0 }),
    );

    await new Promise((resolve) => setTimeout(resolve, 100));
    const countAfterFirst = fetchCount;

    // Re-render with new refreshKey
    rerender(
      React.createElement(EntityPanel, { apiBaseUrl: 'http://localhost:3000', refreshKey: 1 }),
    );

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(fetchCount).toBeGreaterThan(countAfterFirst);
  });
});

// ---- StatusOverlay Phase 19.3 "Glass Box" cockpit (TERM-UX05) ----
// D-14 live poll, D-15 cumulative+session split, D-16 latest-call row,
// D-23 Intelligence Efficiency v2.0 placeholders.

import { StatusOverlay, parseOverlayData } from '../../src/ui/layout/StatusOverlay.js';

describe('StatusOverlay Phase 19.3 (TERM-UX05)', () => {
  let originalFetch: typeof globalThis.fetch;

  /** Route /health and /status to distinct bodies, mirroring the real endpoints. */
  function mockFetch(statusBody: unknown = {}, healthBody: unknown = {}) {
    const fetchMock = vi.fn().mockImplementation((url: unknown) =>
      Promise.resolve({
        ok: true,
        json: async () => (String(url).endsWith('/status') ? statusBody : healthBody),
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
    return fetchMock;
  }

  /** Let the mount-time fetch settle so the first setData lands. */
  const flush = () => new Promise((resolve) => setTimeout(resolve, 60));

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    mockFetch();
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.fetch = originalFetch;
  });

  // -- parseOverlayData: v2.0 memory placeholders (D-23) --

  it('parseOverlayData defaults the v2.0 memory fields to null when missing', () => {
    const result = parseOverlayData({}, { memory: { incidentCount: 3, entityCount: 4, walSize: '2 KB' } });
    expect(result.memoryStats.compressionRatio).toBeNull();
    expect(result.memoryStats.totalTokensSaved).toBeNull();
    expect(result.memoryStats.distilledEntriesCount).toBeNull();
    // Existing fields untouched.
    expect(result.memoryStats.incidentCount).toBe(3);
    expect(result.memoryStats.entityCount).toBe(4);
    expect(result.memoryStats.walSize).toBe('2 KB');
  });

  it('parseOverlayData surfaces the v2.0 memory fields when the backend provides them', () => {
    const result = parseOverlayData({}, {
      memory: {
        incidentCount: 1,
        entityCount: 2,
        walSize: '9 B',
        compressionRatio: 0.72,
        totalTokensSaved: 45000,
        distilledEntriesCount: 12,
      },
    });
    expect(result.memoryStats.compressionRatio).toBe(0.72);
    expect(result.memoryStats.totalTokensSaved).toBe(45000);
    expect(result.memoryStats.distilledEntriesCount).toBe(12);
  });

  // -- parseOverlayData: cumulative / this-session split (D-15) --

  it('parseOverlayData populates cacheBreakdown.cumulative from the response', () => {
    const result = parseOverlayData({}, {
      cache: { totalEntries: 47, hitRate: 0.23, avgConfidence: 0.81 },
    });
    expect(result.cacheBreakdown.cumulative.hitRate).toBe('23.0%');
    expect(result.cacheBreakdown.cumulative.totalEntries).toBe(47);
    expect(result.cacheBreakdown.cumulative.avgConfidence).toBe('81.0%');
    // Backward-compatible mirror kept for existing consumers.
    expect(result.cacheStats.hitRate).toBe('23.0%');
  });

  it('parseOverlayData returns cacheBreakdown.thisSession as zeros in v1.3', () => {
    const result = parseOverlayData({}, {
      cache: { totalEntries: 47, hitRate: 0.23, avgConfidence: 0.81 },
    });
    expect(result.cacheBreakdown.thisSession.hits).toBe(0);
    expect(result.cacheBreakdown.thisSession.llmCallsSaved).toBe(0);
  });

  // -- parseOverlayData: latest call (D-16) --

  it('parseOverlayData leaves latestCall undefined when the backend omits it', () => {
    const result = parseOverlayData({}, { cache: { totalEntries: 1 } });
    expect(result.latestCall).toBeUndefined();
  });

  it('parseOverlayData normalizes latestCall, preserving nullable output tokens and cost', () => {
    const result = parseOverlayData({}, {
      latestCall: { modelId: 'gemini-2.5-pro', inputTokens: 1200, outputTokens: null, latencyMs: 830, costUsd: null },
    });
    expect(result.latestCall).toBeDefined();
    expect(result.latestCall!.modelId).toBe('gemini-2.5-pro');
    expect(result.latestCall!.inputTokens).toBe(1200);
    expect(result.latestCall!.outputTokens).toBeNull();
    expect(result.latestCall!.latencyMs).toBe(830);
    expect(result.latestCall!.costUsd).toBeNull();
  });

  // -- Rendering --

  it('renders the Latest Call section with a fallback line when no call has happened', async () => {
    const { lastFrame, unmount } = render(
      React.createElement(StatusOverlay, { apiBaseUrl: 'http://localhost:3000', onDismiss: vi.fn() }),
    );
    await flush();
    const frame = lastFrame()!;
    expect(frame).toContain('Latest Call');
    expect(frame).toContain('No LLM calls yet');
    unmount();
  });

  it('renders the Latest Call detail row with model, tokens, latency and cost', async () => {
    mockFetch({
      latestCall: { modelId: 'qwen3-32b', inputTokens: 1200, outputTokens: 340, latencyMs: 850, costUsd: 0.0042 },
    });
    const { lastFrame, unmount } = render(
      React.createElement(StatusOverlay, { apiBaseUrl: 'http://localhost:3000', onDismiss: vi.fn() }),
    );
    await flush();
    const frame = lastFrame()!;
    expect(frame).toContain('qwen3-32b');
    expect(frame).toContain('in:1200');
    expect(frame).toContain('out:340');
    expect(frame).toContain('850ms');
    expect(frame).toContain('$0.0042');
    expect(frame).not.toContain('No LLM calls yet');
    unmount();
  });

  it('renders an em-dash for null output tokens and null cost in the Latest Call row', async () => {
    mockFetch({
      latestCall: { modelId: 'qwen3-32b', inputTokens: 900, outputTokens: null, latencyMs: 120, costUsd: null },
    });
    const { lastFrame, unmount } = render(
      React.createElement(StatusOverlay, { apiBaseUrl: 'http://localhost:3000', onDismiss: vi.fn() }),
    );
    await flush();
    const frame = lastFrame()!;
    expect(frame).toContain('out:—');
    expect(frame).toContain('$—');
    expect(frame).not.toContain('$0.0000');
    unmount();
  });

  it('renders Cache Stats with both a Cumulative and a This Session row', async () => {
    mockFetch({ cache: { totalEntries: 47, hitRate: 0.23, avgConfidence: 0.81 } });
    const { lastFrame, unmount } = render(
      React.createElement(StatusOverlay, { apiBaseUrl: 'http://localhost:3000', onDismiss: vi.fn() }),
    );
    await flush();
    const frame = lastFrame()!;
    expect(frame).toContain('Cache Stats');
    expect(frame).toContain('Cumulative:');
    expect(frame).toContain('23.0%');
    expect(frame).toContain('This Session:');
    expect(frame).toContain('0 hits');
    expect(frame).toContain('0 LLM calls saved');
    unmount();
  });

  it('renders the Intelligence Efficiency section with v2.0 em-dash placeholders', async () => {
    const { lastFrame, unmount } = render(
      React.createElement(StatusOverlay, { apiBaseUrl: 'http://localhost:3000', onDismiss: vi.fn() }),
    );
    await flush();
    const frame = lastFrame()!;
    expect(frame).toContain('Intelligence Efficiency');
    expect(frame).toContain('Memory Density: — (v2.0)');
    expect(frame).toContain('Tokens Saved: — (v2.0)');
    expect(frame).toContain('Distilled Entries: — (v2.0)');
    unmount();
  });

  it('preserves the existing Backends / Model Assignments / Memory / Context sections', async () => {
    mockFetch(
      { memory: { incidentCount: 42, entityCount: 88, walSize: '1.2 KB' }, context: { currentTokens: 0, maxTokens: 32768 } },
      {
        backends: [{ baseUrl: 'http://localhost:11434/v1', connected: true, responseTimeMs: 35 }],
        modelRegistry: [{ role: 'worker', model: 'qwen3-0.6b' }],
        inferenceMode: 'sequential',
      },
    );
    const { lastFrame, unmount } = render(
      React.createElement(StatusOverlay, { apiBaseUrl: 'http://localhost:3000', onDismiss: vi.fn() }),
    );
    await flush();
    const frame = lastFrame()!;
    expect(frame).toContain('STATUS DASHBOARD');
    expect(frame).toContain('Press Esc to dismiss');
    expect(frame).toContain('Backends');
    expect(frame).toContain('localhost:11434');
    expect(frame).toContain('Model Assignments');
    expect(frame).toContain('worker: qwen3-0.6b');
    expect(frame).toContain('Memory Stats');
    expect(frame).toContain('Incidents: 42');
    expect(frame).toContain('Context Window');
    expect(frame).toContain('32768 tokens');
    unmount();
  });

  it('never renders the literal text undefined, null or NaN on a malformed payload', async () => {
    mockFetch({ cache: 'nope', memory: null, context: [], latestCall: 42, models: 'x' });
    const { lastFrame, unmount } = render(
      React.createElement(StatusOverlay, { apiBaseUrl: 'http://localhost:3000', onDismiss: vi.fn() }),
    );
    await flush();
    const frame = lastFrame()!;
    expect(frame).not.toContain('undefined');
    expect(frame).not.toContain('null');
    expect(frame).not.toContain('NaN');
    unmount();
  });

  it('reflects the live session token count when the sessionTokens prop is supplied', async () => {
    const { lastFrame, unmount } = render(
      React.createElement(StatusOverlay, {
        apiBaseUrl: 'http://localhost:3000',
        onDismiss: vi.fn(),
        sessionTokens: 8192,
      }),
    );
    await flush();
    const frame = lastFrame()!;
    expect(frame).toContain('8192 / 32768 tokens');
    expect(frame).toContain('25%');
    unmount();
  });

  it('dismisses on Esc', async () => {
    const onDismiss = vi.fn();
    const { stdin, unmount } = render(
      React.createElement(StatusOverlay, { apiBaseUrl: 'http://localhost:3000', onDismiss }),
    );
    stdin.write('\x1B');
    await flush();
    expect(onDismiss).toHaveBeenCalled();
    unmount();
  });

  // -- Poll lifecycle (D-14) --

  it('polls /health and /status every 2.5 seconds while mounted', async () => {
    vi.useFakeTimers();
    const fetchMock = mockFetch();
    const { unmount } = render(
      React.createElement(StatusOverlay, { apiBaseUrl: 'http://localhost:3000', onDismiss: vi.fn() }),
    );

    await vi.advanceTimersByTimeAsync(10);
    const afterMount = fetchMock.mock.calls.length;
    expect(afterMount).toBeGreaterThanOrEqual(2); // /health + /status

    await vi.advanceTimersByTimeAsync(5500); // two more poll ticks
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(afterMount + 4);

    unmount();
  });

  it('stops polling once unmounted', async () => {
    vi.useFakeTimers();
    const fetchMock = mockFetch();
    const { unmount } = render(
      React.createElement(StatusOverlay, { apiBaseUrl: 'http://localhost:3000', onDismiss: vi.fn() }),
    );

    await vi.advanceTimersByTimeAsync(10);
    unmount();
    const afterUnmount = fetchMock.mock.calls.length;

    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchMock.mock.calls.length).toBe(afterUnmount);
  });
});
