import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock @ai-sdk/openai-compatible before importing module under test
const mockProvider = vi.fn((modelId: string) => ({
  modelId,
  specificationVersion: 'v3',
  provider: 'infrabrain',
}));

const mockCreateOpenAICompatible = vi.fn(() => mockProvider);

vi.mock('@ai-sdk/openai-compatible', () => ({
  createOpenAICompatible: mockCreateOpenAICompatible,
}));

import { createCompatModel, createModelRegistry } from '../../src/llm/openai-compat.js';

describe('createCompatModel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates model with default baseURL', () => {
    const model = createCompatModel('test-model');
    expect(model).toBeDefined();
    expect(mockCreateOpenAICompatible).toHaveBeenCalledWith(
      expect.objectContaining({
        baseURL: 'http://localhost:11434/v1',
      }),
    );
    expect(mockProvider).toHaveBeenCalledWith('test-model');
  });

  it('creates model with custom baseURL', () => {
    createCompatModel('test-model', 'http://custom:8000/v1');
    expect(mockCreateOpenAICompatible).toHaveBeenCalledWith(
      expect.objectContaining({
        baseURL: 'http://custom:8000/v1',
      }),
    );
  });

  it('sets supportsStructuredOutputs to true', () => {
    createCompatModel('test-model');
    expect(mockCreateOpenAICompatible).toHaveBeenCalledWith(
      expect.objectContaining({
        supportsStructuredOutputs: true,
      }),
    );
  });
});

describe('createModelRegistry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const allStringModelMap = {
    default: 'infrabrain',
    strategic: 'llama3.3:70b',
    forensic: 'deepseek-r1:32b',
    worker: 'qwen2.5-coder:7b',
    vision: 'llama3.2-vision',
    triage: 'infrabrain',
    embedding: 'bge-m3',
  };

  it('creates 7 role entries from all-string ModelMap', () => {
    const registry = createModelRegistry(allStringModelMap, 'http://localhost:11434/v1');
    const entries = registry.entries();
    expect(entries).toHaveLength(7);
    expect(entries.map(e => e.role)).toEqual(
      expect.arrayContaining(['default', 'strategic', 'forensic', 'worker', 'vision', 'triage', 'embedding']),
    );
  });

  it('string entry uses defaultBaseUrl', () => {
    createModelRegistry(allStringModelMap, 'http://localhost:11434/v1');
    expect(mockCreateOpenAICompatible).toHaveBeenCalledWith(
      expect.objectContaining({
        baseURL: 'http://localhost:11434/v1',
      }),
    );
  });

  it('object entry uses its own baseUrl', () => {
    const mixedMap = {
      ...allStringModelMap,
      triage: { model: 'qwen3.5:9b', baseUrl: 'http://vllm:8000/v1' },
    };
    createModelRegistry(mixedMap, 'http://localhost:11434/v1');
    // Should have created providers for both baseURLs
    const calls = mockCreateOpenAICompatible.mock.calls;
    const baseURLs = calls.map(c => c[0].baseURL);
    expect(baseURLs).toContain('http://localhost:11434/v1');
    expect(baseURLs).toContain('http://vllm:8000/v1');
  });

  it('per-role baseUrl routing uses correct model IDs', () => {
    const mixedMap = {
      ...allStringModelMap,
      triage: { model: 'qwen3.5:9b', baseUrl: 'http://vllm:8000/v1' },
    };
    const registry = createModelRegistry(mixedMap, 'http://localhost:11434/v1');
    const entries = registry.entries();
    const triageEntry = entries.find(e => e.role === 'triage');
    expect(triageEntry?.modelId).toBe('qwen3.5:9b');
  });

  it('provider cache reuses same baseURL', () => {
    // All 7 roles use defaultBaseUrl -> should create only 1 provider
    createModelRegistry(allStringModelMap, 'http://localhost:11434/v1');
    expect(mockCreateOpenAICompatible).toHaveBeenCalledTimes(1);
  });

  it('provider cache creates separate provider per unique baseURL', () => {
    const mixedMap = {
      ...allStringModelMap,
      triage: { model: 'qwen3.5:9b', baseUrl: 'http://vllm:8000/v1' },
      worker: { model: 'qwen3.5:9b', baseUrl: 'http://vllm:8000/v1' },
    };
    createModelRegistry(mixedMap, 'http://localhost:11434/v1');
    // 2 unique baseURLs -> 2 providers
    expect(mockCreateOpenAICompatible).toHaveBeenCalledTimes(2);
  });

  it('get() returns model for role', () => {
    const registry = createModelRegistry(allStringModelMap, 'http://localhost:11434/v1');
    const model = registry.get('default');
    expect(model).toBeDefined();
  });

  it('getDefault() returns the default role model', () => {
    const registry = createModelRegistry(allStringModelMap, 'http://localhost:11434/v1');
    const model = registry.getDefault();
    expect(model).toBeDefined();
  });

  it('get() throws for unknown role', () => {
    const registry = createModelRegistry(allStringModelMap, 'http://localhost:11434/v1');
    expect(() => registry.get('nonexistent' as any)).toThrow('No model configured for role');
  });
});
