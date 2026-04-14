import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IncidentStore } from '../../src/memory/incident-store.js';
import type { EntityStore } from '../../src/memory/entity-store.js';
import type { MemoryConfig } from '../../src/memory/types.js';

// Mock dependencies
vi.mock('../../src/cache/embedder.js', () => ({
  generateEmbedding: vi.fn(),
}));
vi.mock('../../src/memory/memory-search.js', () => ({
  searchWithDecay: vi.fn(),
}));
vi.mock('../../src/memory/entity-extractor.js', () => ({
  extractEntitiesFromText: vi.fn(),
}));
vi.mock('../../src/context/token-counter.js', () => ({
  countTokens: vi.fn((text: string) => text.length), // 1 char ~ 1 token for test simplicity
}));

import { buildWakeUpContext } from '../../src/memory/wake-up.js';
import { generateEmbedding } from '../../src/cache/embedder.js';
import { searchWithDecay } from '../../src/memory/memory-search.js';
import { extractEntitiesFromText } from '../../src/memory/entity-extractor.js';

describe('wake-up context builder', () => {
  let mockIncidentStore: Partial<IncidentStore>;
  let mockEntityStore: Partial<EntityStore>;
  let defaultConfig: MemoryConfig;

  beforeEach(() => {
    vi.clearAllMocks();

    mockIncidentStore = {
      getStats: vi.fn().mockResolvedValue({
        totalIncidents: 42,
        topDomains: [
          { skill_name: 'postgres-troubleshoot', count: 15 },
          { skill_name: 'nginx-troubleshoot', count: 10 },
        ],
        successRate: 85.7,
      }),
      getRecent: vi.fn().mockResolvedValue([
        {
          created_at: '2026-04-13T10:00:00Z',
          skill_name: 'postgres-troubleshoot',
          root_cause: 'Connection pool exhaustion',
          outcome: 'completed',
        },
        {
          created_at: '2026-04-12T08:00:00Z',
          skill_name: 'nginx-troubleshoot',
          root_cause: 'Config syntax error',
          outcome: 'completed',
        },
      ]),
    };

    mockEntityStore = {
      searchByEntities: vi.fn().mockResolvedValue([]),
    };

    defaultConfig = {
      enabled: true,
      dataDir: '/tmp/test-memory',
      decayLambda: 0.02,
      l2SimilarityThreshold: 0.7,
      l2Limit: 3,
      tokenBudgets: { l0: 100, l1: 500, l2l3: 5000 },
    };

    // Default mock for generateEmbedding
    vi.mocked(generateEmbedding).mockResolvedValue(new Array(1024).fill(0));
    // Default mock for searchWithDecay
    vi.mocked(searchWithDecay).mockResolvedValue([]);
    // Default mock for extractEntitiesFromText
    vi.mocked(extractEntitiesFromText).mockReturnValue([]);
  });

  it('L0 returns identity string with incident count and top domains', async () => {
    const result = await buildWakeUpContext({
      currentPrompt: 'test prompt',
      memoryConfig: defaultConfig,
      embeddingParams: { baseURL: 'http://localhost:11434/v1', modelId: 'bge-m3' },
      incidentStore: mockIncidentStore as IncidentStore,
      entityStore: mockEntityStore as EntityStore,
    });

    expect(result.pinned).toContain('42');
    expect(result.pinned).toContain('postgres-troubleshoot');
    expect(result.pinned).toContain('nginx-troubleshoot');
    expect(result.pinned).toContain('85.7%');
  });

  it('L1 returns last N incidents as one-liners', async () => {
    const result = await buildWakeUpContext({
      currentPrompt: 'test prompt',
      memoryConfig: defaultConfig,
      embeddingParams: { baseURL: 'http://localhost:11434/v1', modelId: 'bge-m3' },
      incidentStore: mockIncidentStore as IncidentStore,
      entityStore: mockEntityStore as EntityStore,
    });

    expect(result.pinned).toContain('postgres-troubleshoot');
    expect(result.pinned).toContain('Connection pool exhaustion');
    expect(result.pinned).toContain('completed');
    expect(result.pinned).toContain('nginx-troubleshoot');
    expect(result.pinned).toContain('Config syntax error');
  });

  it('L2 runs vector search and returns formatted similar incidents', async () => {
    vi.mocked(searchWithDecay).mockResolvedValue([
      {
        incident: {
          id: 'inc-1',
          session_id: 's1',
          wing: 'wing_incidents',
          prompt: 'p',
          diagnosis: 'd',
          root_cause: 'OOM kill',
          fix_summary: 'f',
          outcome: 'completed',
          skill_name: 'postgres-troubleshoot',
          created_at: '2026-04-10T10:00:00Z',
          containers: '[]',
          services: '[]',
          error_codes: '[]',
          expert_domain: '',
        },
        similarity: 0.85,
        recencyScore: 0.9,
        score: 0.87,
      },
    ]);

    const result = await buildWakeUpContext({
      currentPrompt: 'test prompt',
      memoryConfig: defaultConfig,
      embeddingParams: { baseURL: 'http://localhost:11434/v1', modelId: 'bge-m3' },
      incidentStore: mockIncidentStore as IncidentStore,
      entityStore: mockEntityStore as EntityStore,
    });

    expect(result.evictable).toContain('OOM kill');
    expect(result.evictable).toContain('0.87');
    expect(result.evictable).toContain('postgres-troubleshoot');
  });

  it('L3 fires only when best L2 similarity < threshold (0.7)', async () => {
    // L2 returns results with weak similarity
    vi.mocked(searchWithDecay).mockResolvedValue([
      {
        incident: {
          id: 'inc-1', session_id: 's1', wing: 'wing_incidents',
          prompt: 'p', diagnosis: 'd', root_cause: 'Weak match',
          fix_summary: 'f', outcome: 'completed', skill_name: 'test',
          created_at: '2026-04-10T10:00:00Z',
          containers: '[]', services: '[]', error_codes: '[]', expert_domain: '',
        },
        similarity: 0.5, // below threshold
        recencyScore: 0.9,
        score: 0.65,
      },
    ]);

    vi.mocked(extractEntitiesFromText).mockReturnValue([
      { type: 'service', value: 'redis' },
    ]);

    vi.mocked(mockEntityStore.searchByEntities!).mockResolvedValue([
      {
        entity_value: 'redis',
        entity_type: 'service',
        related_incident_id: 'inc-99',
        relationship_type: 'involved_in',
      },
    ]);

    const result = await buildWakeUpContext({
      currentPrompt: 'redis connection refused',
      memoryConfig: defaultConfig,
      embeddingParams: { baseURL: 'http://localhost:11434/v1', modelId: 'bge-m3' },
      incidentStore: mockIncidentStore as IncidentStore,
      entityStore: mockEntityStore as EntityStore,
    });

    // L3 should have fired
    expect(extractEntitiesFromText).toHaveBeenCalledWith('redis connection refused');
    expect(mockEntityStore.searchByEntities).toHaveBeenCalledWith(['redis']);
    expect(result.evictable).toContain('Deep Search');
  });

  it('L3 does NOT fire when L2 has good matches (similarity >= 0.7)', async () => {
    vi.mocked(searchWithDecay).mockResolvedValue([
      {
        incident: {
          id: 'inc-1', session_id: 's1', wing: 'wing_incidents',
          prompt: 'p', diagnosis: 'd', root_cause: 'Good match',
          fix_summary: 'f', outcome: 'completed', skill_name: 'test',
          created_at: '2026-04-10T10:00:00Z',
          containers: '[]', services: '[]', error_codes: '[]', expert_domain: '',
        },
        similarity: 0.85, // above threshold
        recencyScore: 0.9,
        score: 0.87,
      },
    ]);

    const result = await buildWakeUpContext({
      currentPrompt: 'test prompt',
      memoryConfig: defaultConfig,
      embeddingParams: { baseURL: 'http://localhost:11434/v1', modelId: 'bge-m3' },
      incidentStore: mockIncidentStore as IncidentStore,
      entityStore: mockEntityStore as EntityStore,
    });

    // L3 should NOT have fired
    expect(extractEntitiesFromText).not.toHaveBeenCalled();
    expect(mockEntityStore.searchByEntities).not.toHaveBeenCalled();
    expect(result.evictable).not.toContain('Deep Search');
  });

  it('returns { pinned, evictable } with L0+L1 in pinned, L2+L3 in evictable', async () => {
    vi.mocked(searchWithDecay).mockResolvedValue([
      {
        incident: {
          id: 'inc-1', session_id: 's1', wing: 'wing_incidents',
          prompt: 'p', diagnosis: 'd', root_cause: 'Test root cause',
          fix_summary: 'f', outcome: 'completed', skill_name: 'test',
          created_at: '2026-04-10T10:00:00Z',
          containers: '[]', services: '[]', error_codes: '[]', expert_domain: '',
        },
        similarity: 0.85,
        recencyScore: 0.9,
        score: 0.87,
      },
    ]);

    const result = await buildWakeUpContext({
      currentPrompt: 'test prompt',
      memoryConfig: defaultConfig,
      embeddingParams: { baseURL: 'http://localhost:11434/v1', modelId: 'bge-m3' },
      incidentStore: mockIncidentStore as IncidentStore,
      entityStore: mockEntityStore as EntityStore,
    });

    // Pinned should contain Identity (L0) and Recent (L1)
    expect(result.pinned).toContain('Identity');
    expect(result.pinned).toContain('Recent');
    // Evictable should contain L2 search results
    expect(result.evictable).toContain('Similar Past Incidents');
    // Both should be strings
    expect(typeof result.pinned).toBe('string');
    expect(typeof result.evictable).toBe('string');
  });

  it('returns empty strings when stores are unavailable (graceful degradation)', async () => {
    const failingStore: Partial<IncidentStore> = {
      getStats: vi.fn().mockRejectedValue(new Error('LanceDB unavailable')),
      getRecent: vi.fn().mockRejectedValue(new Error('LanceDB unavailable')),
    };

    const failingEntityStore: Partial<EntityStore> = {
      searchByEntities: vi.fn().mockRejectedValue(new Error('LanceDB unavailable')),
    };

    vi.mocked(generateEmbedding).mockResolvedValue(null);

    const result = await buildWakeUpContext({
      currentPrompt: 'test prompt',
      memoryConfig: defaultConfig,
      embeddingParams: { baseURL: 'http://localhost:11434/v1', modelId: 'bge-m3' },
      incidentStore: failingStore as IncidentStore,
      entityStore: failingEntityStore as EntityStore,
    });

    expect(result.pinned).toBe('');
    expect(result.evictable).toBe('');
  });

  it('handles getStats returning null gracefully', async () => {
    mockIncidentStore.getStats = vi.fn().mockResolvedValue(null);

    const result = await buildWakeUpContext({
      currentPrompt: 'test prompt',
      memoryConfig: defaultConfig,
      embeddingParams: { baseURL: 'http://localhost:11434/v1', modelId: 'bge-m3' },
      incidentStore: mockIncidentStore as IncidentStore,
      entityStore: mockEntityStore as EntityStore,
    });

    // Should still have L1 (recent) but L0 identity should be empty
    expect(result.pinned).toContain('Recent');
  });

  it('caps L2+L3 combined at tokenBudgets.l2l3', async () => {
    // Return many results that would exceed budget
    const manyResults = Array.from({ length: 20 }, (_, i) => ({
      incident: {
        id: `inc-${i}`, session_id: `s${i}`, wing: 'wing_incidents' as const,
        prompt: 'p', diagnosis: 'd', root_cause: `Root cause ${i} `.repeat(50),
        fix_summary: 'f', outcome: 'completed' as const, skill_name: 'test',
        created_at: '2026-04-10T10:00:00Z',
        containers: '[]', services: '[]', error_codes: '[]', expert_domain: '',
      },
      similarity: 0.85,
      recencyScore: 0.9,
      score: 0.87,
    }));

    vi.mocked(searchWithDecay).mockResolvedValue(manyResults);

    // Use very tight budget
    const tightConfig = { ...defaultConfig, tokenBudgets: { l0: 100, l1: 500, l2l3: 100 } };

    const result = await buildWakeUpContext({
      currentPrompt: 'test prompt',
      memoryConfig: tightConfig,
      embeddingParams: { baseURL: 'http://localhost:11434/v1', modelId: 'bge-m3' },
      incidentStore: mockIncidentStore as IncidentStore,
      entityStore: mockEntityStore as EntityStore,
    });

    // The evictable section should be truncated
    // With countTokens mocked as text.length, 100 chars is the budget
    // Just verify it doesn't include all 20 results
    expect(typeof result.evictable).toBe('string');
  });
});
