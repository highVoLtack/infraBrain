import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the embedder before importing modules that use it
vi.mock('../../src/cache/embedder.js', () => ({
  generateEmbedding: vi.fn().mockResolvedValue(new Array(1024).fill(0.1)),
}));

// Mock the memory-search module
vi.mock('../../src/memory/memory-search.js', () => ({
  searchWithDecay: vi.fn(),
}));

import { handleMemoryQuery } from '../../src/memory/memory-skill.js';
import { searchWithDecay } from '../../src/memory/memory-search.js';
import type { IntentResult } from '../../src/memory/intent-classifier.js';
import type { IncidentStore } from '../../src/memory/incident-store.js';
import type { EntityStore } from '../../src/memory/entity-store.js';
import type { MemoryConfig, MemorySearchResult, IncidentRecord } from '../../src/memory/types.js';

const mockSearchWithDecay = vi.mocked(searchWithDecay);

function makeIncidentRecord(overrides: Partial<IncidentRecord> = {}): IncidentRecord {
  return {
    id: 'inc-001',
    session_id: 'sess-001',
    wing: 'wing_incidents',
    prompt: 'nginx is returning 502',
    diagnosis: 'Backend container not connected to frontend network',
    root_cause: 'Network misconfiguration between frontend and backend containers',
    fix_summary: 'Connected backend container to frontend network via docker network connect',
    outcome: 'completed',
    skill_name: 'network-expert',
    created_at: '2026-04-10T14:30:00.000Z',
    containers: '["nginx-proxy", "demo-backend"]',
    services: '["nginx"]',
    error_codes: '[]',
    expert_domain: '',
    ...overrides,
  };
}

function makeSearchResult(overrides: Partial<MemorySearchResult> = {}): MemorySearchResult {
  return {
    incident: makeIncidentRecord(overrides.incident as Partial<IncidentRecord>),
    similarity: 0.85,
    recencyScore: 0.92,
    score: 0.88,
    ...overrides,
  };
}

const mockMemoryConfig: MemoryConfig = {
  enabled: true,
  dataDir: '/tmp/test-memory',
  decayLambda: 0.02,
  l2SimilarityThreshold: 0.7,
  l2Limit: 5,
  tokenBudgets: { l0: 100, l1: 500, l2l3: 2000 },
};

const mockIncidentStore = {
  search: vi.fn().mockResolvedValue([]),
  getRecent: vi.fn().mockResolvedValue([]),
  getStats: vi.fn().mockResolvedValue({ totalIncidents: 0, topDomains: [], successRate: 0 }),
  init: vi.fn().mockResolvedValue(undefined),
  add: vi.fn().mockResolvedValue('inc-001'),
} as unknown as IncidentStore;

const mockEntityStore = {
  searchByEntities: vi.fn().mockResolvedValue([]),
  searchByType: vi.fn().mockResolvedValue([]),
  init: vi.fn().mockResolvedValue(undefined),
  add: vi.fn().mockResolvedValue('ent-001'),
} as unknown as EntityStore;

const embeddingParams = {
  baseURL: 'http://localhost:11434/v1',
  modelId: 'bge-m3',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('handleMemoryQuery', () => {
  it('returns formatted incident list for list queries', async () => {
    const intent: IntentResult = {
      type: 'memory',
      search_query: 'recent fixes',
      format_hint: 'list',
    };

    const results: MemorySearchResult[] = [
      makeSearchResult({
        incident: makeIncidentRecord({
          id: 'inc-001',
          skill_name: 'network-expert',
          root_cause: 'Network misconfiguration',
          outcome: 'completed',
          created_at: '2026-04-10T14:30:00.000Z',
        }),
      }),
      makeSearchResult({
        incident: makeIncidentRecord({
          id: 'inc-002',
          skill_name: 'linux-expert',
          root_cause: 'Permission denied on /var/lib/data',
          outcome: 'completed',
          created_at: '2026-04-09T10:00:00.000Z',
        }),
      }),
    ];

    mockSearchWithDecay.mockResolvedValueOnce(results);

    const response = await handleMemoryQuery({
      intent,
      memoryConfig: mockMemoryConfig,
      incidentStore: mockIncidentStore,
      entityStore: mockEntityStore,
      embeddingParams,
    });

    // Should contain tabular/list formatting
    expect(response).toContain('network-expert');
    expect(response).toContain('linux-expert');
    expect(response).toContain('Network misconfiguration');
    expect(response).toContain('Permission denied');
  });

  it('returns narrative for analysis queries', async () => {
    const intent: IntentResult = {
      type: 'memory',
      search_query: 'infrastructure patterns',
      format_hint: 'narrative',
    };

    const results: MemorySearchResult[] = [
      makeSearchResult({
        incident: makeIncidentRecord({
          id: 'inc-001',
          skill_name: 'network-expert',
          root_cause: 'Network misconfiguration',
        }),
      }),
      makeSearchResult({
        incident: makeIncidentRecord({
          id: 'inc-002',
          skill_name: 'network-expert',
          root_cause: 'DNS resolution failure',
        }),
      }),
    ];

    mockSearchWithDecay.mockResolvedValueOnce(results);

    const response = await handleMemoryQuery({
      intent,
      memoryConfig: mockMemoryConfig,
      incidentStore: mockIncidentStore,
      entityStore: mockEntityStore,
      embeddingParams,
    });

    // Narrative format should be prose-like, not tabular
    expect(response).toContain('incident');
    expect(response).toContain('network-expert');
  });

  it('returns "no incidents found" message when memory is empty', async () => {
    const intent: IntentResult = {
      type: 'memory',
      search_query: 'anything',
      format_hint: 'list',
    };

    mockSearchWithDecay.mockResolvedValueOnce([]);

    const response = await handleMemoryQuery({
      intent,
      memoryConfig: mockMemoryConfig,
      incidentStore: mockIncidentStore,
      entityStore: mockEntityStore,
      embeddingParams,
    });

    expect(response).toMatch(/no.*incident/i);
  });

  it('filters by time_range when present', async () => {
    const intent: IntentResult = {
      type: 'memory',
      search_query: 'fixes from last week',
      time_range: {
        from: '2026-04-07T00:00:00.000Z',
        to: '2026-04-14T00:00:00.000Z',
      },
      format_hint: 'list',
    };

    const resultsWithTimeRange: MemorySearchResult[] = [
      makeSearchResult({
        incident: makeIncidentRecord({
          created_at: '2026-04-10T14:30:00.000Z', // within range
          root_cause: 'In-range incident',
        }),
      }),
      makeSearchResult({
        incident: makeIncidentRecord({
          created_at: '2026-03-01T10:00:00.000Z', // outside range
          root_cause: 'Out-of-range incident',
        }),
      }),
    ];

    mockSearchWithDecay.mockResolvedValueOnce(resultsWithTimeRange);

    const response = await handleMemoryQuery({
      intent,
      memoryConfig: mockMemoryConfig,
      incidentStore: mockIncidentStore,
      entityStore: mockEntityStore,
      embeddingParams,
    });

    // Should include in-range and exclude out-of-range
    expect(response).toContain('In-range incident');
    expect(response).not.toContain('Out-of-range incident');
  });

  it('returns combined format with both list and narrative', async () => {
    const intent: IntentResult = {
      type: 'combined',
      search_query: 'nginx issues',
      format_hint: 'combined',
    };

    const results: MemorySearchResult[] = [
      makeSearchResult({
        incident: makeIncidentRecord({
          root_cause: 'Nginx upstream timeout',
          skill_name: 'network-expert',
        }),
      }),
    ];

    mockSearchWithDecay.mockResolvedValueOnce(results);

    const response = await handleMemoryQuery({
      intent,
      memoryConfig: mockMemoryConfig,
      incidentStore: mockIncidentStore,
      entityStore: mockEntityStore,
      embeddingParams,
    });

    // Combined should have both structured and narrative elements
    expect(response).toContain('Nginx upstream timeout');
    expect(response).toContain('network-expert');
  });
});
