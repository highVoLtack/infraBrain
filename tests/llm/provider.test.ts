import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LanguageModel } from 'ai';

// Mock the 'ai' module
vi.mock('ai', () => ({
  streamText: vi.fn(),
  generateText: vi.fn(),
}));

// Mock the token-budget module
vi.mock('../../src/llm/token-budget.js', () => ({
  checkBudget: vi.fn(),
}));

import { createProvider } from '../../src/llm/provider.js';
import { checkBudget } from '../../src/llm/token-budget.js';
import type { LLMProvider } from '../../src/llm/types.js';
import type { BudgetCheck } from '../../src/llm/token-budget.js';

// Create a minimal mock LanguageModel (LanguageModelV3-compatible shape)
function createMockModel(): LanguageModel {
  return {
    specificationVersion: 'v2',
    provider: 'mock',
    modelId: 'mock-model',
    defaultObjectGenerationMode: 'json',
    doGenerate: vi.fn(),
    doStream: vi.fn(),
  } as unknown as LanguageModel;
}

describe('LLM Provider', () => {
  let mockModel: LanguageModel;

  beforeEach(() => {
    vi.clearAllMocks();
    mockModel = createMockModel();
    // Default: budget check allows all calls (existing tests don't test budget)
    vi.mocked(checkBudget).mockReturnValue({
      allowed: true,
      estimatedTokens: 50,
      budgetTokens: 4096,
    });
  });

  it('createProvider returns object with streamDiagnosis and generateCommand methods', () => {
    const provider = createProvider(mockModel);

    expect(provider).toBeDefined();
    expect(typeof provider.streamDiagnosis).toBe('function');
    expect(typeof provider.generateCommand).toBe('function');
    expect(provider.model).toBe(mockModel);
  });

  it('streamDiagnosis yields string chunks from the model stream', async () => {
    const { streamText } = await import('ai');
    const mockedStreamText = vi.mocked(streamText);

    // Mock streamText to return an object with textStream async iterable
    const chunks = ['Hello', ' ', 'world'];
    mockedStreamText.mockReturnValue({
      textStream: (async function* () {
        for (const chunk of chunks) {
          yield chunk;
        }
      })(),
      usage: Promise.resolve({ promptTokens: 10, completionTokens: 5, totalTokens: 15 }),
    } as any);

    const provider = createProvider(mockModel);
    const result: string[] = [];

    for await (const chunk of provider.streamDiagnosis('test prompt', 'system prompt')) {
      result.push(chunk);
    }

    expect(result).toEqual(['Hello', ' ', 'world']);
    expect(mockedStreamText).toHaveBeenCalledWith(
      expect.objectContaining({
        model: mockModel,
        prompt: 'test prompt',
        system: 'system prompt',
      }),
    );
  });

  it('generateCommand returns a string response from the model', async () => {
    const { generateText } = await import('ai');
    const mockedGenerateText = vi.mocked(generateText);

    mockedGenerateText.mockResolvedValue({
      text: 'docker restart nginx',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    } as any);

    const provider = createProvider(mockModel);
    const result = await provider.generateCommand('fix nginx', 'system prompt');

    expect(result).toBe('docker restart nginx');
    expect(mockedGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({
        model: mockModel,
        prompt: 'fix nginx',
        system: 'system prompt',
      }),
    );
  });

  it('generateCommand throws error when token budget is exceeded', async () => {
    vi.mocked(checkBudget).mockReturnValue({
      allowed: false,
      estimatedTokens: 5000,
      budgetTokens: 2048,
      overflow: 2952,
    });

    const provider = createProvider(mockModel);

    await expect(
      provider.generateCommand('very long prompt', 'system prompt'),
    ).rejects.toThrow('Token budget exceeded');
  });

  it('streamDiagnosis throws error when token budget is exceeded', async () => {
    vi.mocked(checkBudget).mockReturnValue({
      allowed: false,
      estimatedTokens: 8000,
      budgetTokens: 4096,
      overflow: 3904,
    });

    const provider = createProvider(mockModel);

    await expect(async () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _chunk of provider.streamDiagnosis('very long prompt', 'system prompt')) {
        // should not reach here
      }
    }).rejects.toThrow('Token budget exceeded');
  });

  it('generateCommand proceeds normally when budget check passes', async () => {
    const { generateText } = await import('ai');
    const mockedGenerateText = vi.mocked(generateText);

    vi.mocked(checkBudget).mockReturnValue({
      allowed: true,
      estimatedTokens: 100,
      budgetTokens: 2048,
    });

    mockedGenerateText.mockResolvedValue({
      text: 'systemctl restart nginx',
      usage: { promptTokens: 100, completionTokens: 10, totalTokens: 110 },
    } as any);

    const provider = createProvider(mockModel);
    const result = await provider.generateCommand('restart nginx', 'system');

    expect(result).toBe('systemctl restart nginx');
    expect(checkBudget).toHaveBeenCalledWith('restart nginx', 'system', {
      maxTokens: 2048,
      taskType: 'command',
    });
  });

  it('streamDiagnosis proceeds normally when budget check passes', async () => {
    const { streamText } = await import('ai');
    const mockedStreamText = vi.mocked(streamText);

    vi.mocked(checkBudget).mockReturnValue({
      allowed: true,
      estimatedTokens: 200,
      budgetTokens: 4096,
    });

    mockedStreamText.mockReturnValue({
      textStream: (async function* () {
        yield 'diagnosis';
      })(),
      usage: Promise.resolve({ promptTokens: 200, completionTokens: 50, totalTokens: 250 }),
    } as any);

    const provider = createProvider(mockModel);
    const chunks: string[] = [];
    for await (const chunk of provider.streamDiagnosis('check disk', 'system')) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(['diagnosis']);
    expect(checkBudget).toHaveBeenCalledWith('check disk', 'system', {
      maxTokens: 4096,
      taskType: 'diagnosis',
    });
  });

  it('generateCommand uses role-specific model from registry when role is provided', async () => {
    const { generateText } = await import('ai');
    const mockedGenerateText = vi.mocked(generateText);

    mockedGenerateText.mockResolvedValue({
      text: 'deep analysis result',
      usage: { promptTokens: 50, completionTokens: 20, totalTokens: 70 },
    } as any);

    const forensicModel = createMockModel();
    const mockRegistry = {
      get: vi.fn((role: string) => role === 'forensic' ? forensicModel : mockModel),
      getDefault: () => mockModel,
      entries: () => [
        { role: 'default' as const, modelId: 'infrabrain' },
        { role: 'forensic' as const, modelId: 'deepseek-r1:32b' },
      ],
    };

    const provider = createProvider(mockModel, mockRegistry);
    const result = await provider.generateCommand('complex debug', 'system', 'forensic' as any);

    expect(result).toBe('deep analysis result');
    expect(mockRegistry.get).toHaveBeenCalledWith('forensic');
    expect(mockedGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({ model: forensicModel }),
    );
  });

  it('generateCommand uses 4096 maxOutputTokens for forensic role', async () => {
    const { generateText } = await import('ai');
    const mockedGenerateText = vi.mocked(generateText);

    mockedGenerateText.mockResolvedValue({
      text: 'deep analysis with chain of thought',
      usage: { promptTokens: 50, completionTokens: 3500, totalTokens: 3550 },
    } as any);

    const forensicModel = createMockModel();
    const mockRegistry = {
      get: vi.fn((role: string) => role === 'forensic' ? forensicModel : mockModel),
      getDefault: () => mockModel,
      entries: () => [
        { role: 'default' as const, modelId: 'infrabrain' },
        { role: 'forensic' as const, modelId: 'deepseek-r1:32b' },
      ],
    };

    // Budget check must be called with 4096 for forensic, not 2048
    vi.mocked(checkBudget).mockReturnValue({
      allowed: true,
      estimatedTokens: 100,
      budgetTokens: 4096,
    });

    const provider = createProvider(mockModel, mockRegistry);
    await provider.generateCommand('complex debug', 'system', 'forensic' as any);

    // Verify budget check used forensic limit (4096)
    expect(checkBudget).toHaveBeenCalledWith('complex debug', 'system', {
      maxTokens: 4096,
      taskType: 'command',
    });

    // Verify generateText used forensic limit (4096)
    expect(mockedGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({ maxOutputTokens: 4096 }),
    );
  });

  it('generateCommand uses 2048 maxOutputTokens for default role', async () => {
    const { generateText } = await import('ai');
    const mockedGenerateText = vi.mocked(generateText);

    mockedGenerateText.mockResolvedValue({
      text: 'simple result',
      usage: { promptTokens: 50, completionTokens: 20, totalTokens: 70 },
    } as any);

    const provider = createProvider(mockModel);
    await provider.generateCommand('simple task', 'system');

    // No role → default 2048 limit
    expect(checkBudget).toHaveBeenCalledWith('simple task', 'system', {
      maxTokens: 2048,
      taskType: 'command',
    });
    expect(mockedGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({ maxOutputTokens: 2048 }),
    );
  });

  it('generateCommand uses default model when no role is provided', async () => {
    const { generateText } = await import('ai');
    const mockedGenerateText = vi.mocked(generateText);

    mockedGenerateText.mockResolvedValue({
      text: 'default result',
      usage: { promptTokens: 50, completionTokens: 20, totalTokens: 70 },
    } as any);

    const provider = createProvider(mockModel);
    await provider.generateCommand('simple task', 'system');

    expect(mockedGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({ model: mockModel }),
    );
  });

  it('provider exposes registry with entries()', () => {
    const mockRegistry = {
      get: vi.fn(() => mockModel),
      getDefault: () => mockModel,
      entries: () => [
        { role: 'default' as const, modelId: 'infrabrain' },
        { role: 'strategic' as const, modelId: 'llama3.3:70b' },
        { role: 'forensic' as const, modelId: 'deepseek-r1:32b' },
        { role: 'worker' as const, modelId: 'qwen2.5-coder:7b' },
        { role: 'vision' as const, modelId: 'llama3.2-vision' },
        { role: 'triage' as const, modelId: 'qwen2.5-coder:7b' },
        { role: 'embedding' as const, modelId: 'bge-m3' },
      ],
    };

    const provider = createProvider(mockModel, mockRegistry);
    const entries = provider.registry.entries();

    expect(entries).toHaveLength(7);
    expect(entries.map(e => e.role)).toEqual(['default', 'strategic', 'forensic', 'worker', 'vision', 'triage', 'embedding']);
  });

  it('provider abstraction does not import ollama directly', async () => {
    // Read the provider source file and verify it doesn't import from ai-sdk-ollama
    const fs = await import('node:fs');
    const providerSource = fs.readFileSync(
      new URL('../../src/llm/provider.ts', import.meta.url),
      'utf-8',
    );

    expect(providerSource).not.toContain("from 'ai-sdk-ollama'");
    expect(providerSource).not.toContain('from "ai-sdk-ollama"');
  });
});

describe('OpenAI-Compatible Model Factory', () => {
  it('createCompatModel returns a LanguageModel-compatible object', async () => {
    const { createCompatModel } = await import('../../src/llm/openai-compat.js');
    const model = createCompatModel('llama3.3:70b', 'http://localhost:11434/v1');

    expect(model).toBeDefined();
    expect((model as any).modelId).toBe('llama3.3:70b');
  });

  it('createCompatModel uses default baseURL when none provided', async () => {
    const { createCompatModel } = await import('../../src/llm/openai-compat.js');
    const model = createCompatModel('infrabrain');

    expect(model).toBeDefined();
    expect((model as any).modelId).toBe('infrabrain');
  });

  it('createModelRegistry creates models for all seven roles', async () => {
    const { createModelRegistry } = await import('../../src/llm/openai-compat.js');
    const registry = createModelRegistry(
      { default: 'infrabrain', strategic: 'llama3.3:70b', forensic: 'deepseek-r1:32b', worker: 'qwen2.5-coder:7b', vision: 'llama3.2-vision', triage: 'qwen2.5-coder:7b', embedding: 'bge-m3' },
      'http://localhost:11434/v1',
    );

    expect(registry).toBeDefined();
    expect(registry.getDefault()).toBeDefined();
    expect((registry.getDefault() as any).modelId).toBe('infrabrain');

    const entries = registry.entries();
    expect(entries).toHaveLength(7);
    expect(entries.find(e => e.role === 'default')?.modelId).toBe('infrabrain');
    expect(entries.find(e => e.role === 'strategic')?.modelId).toBe('llama3.3:70b');
    expect(entries.find(e => e.role === 'forensic')?.modelId).toBe('deepseek-r1:32b');
    expect(entries.find(e => e.role === 'worker')?.modelId).toBe('qwen2.5-coder:7b');
    expect(entries.find(e => e.role === 'vision')?.modelId).toBe('llama3.2-vision');
    expect(entries.find(e => e.role === 'triage')?.modelId).toBe('qwen2.5-coder:7b');
    expect(entries.find(e => e.role === 'embedding')?.modelId).toBe('bge-m3');
  });

  it('createModelRegistry.get returns correct model per role', async () => {
    const { createModelRegistry } = await import('../../src/llm/openai-compat.js');
    const registry = createModelRegistry(
      { default: 'infrabrain', strategic: 'llama3.3:70b', forensic: 'deepseek-r1:32b', worker: 'qwen2.5-coder:7b', vision: 'llama3.2-vision', triage: 'qwen2.5-coder:7b', embedding: 'bge-m3' },
      'http://localhost:11434/v1',
    );

    expect((registry.get('default') as any).modelId).toBe('infrabrain');
    expect((registry.get('strategic') as any).modelId).toBe('llama3.3:70b');
    expect((registry.get('forensic') as any).modelId).toBe('deepseek-r1:32b');
    expect((registry.get('worker') as any).modelId).toBe('qwen2.5-coder:7b');
    expect((registry.get('vision') as any).modelId).toBe('llama3.2-vision');
    expect((registry.get('triage') as any).modelId).toBe('qwen2.5-coder:7b');
    expect((registry.get('embedding') as any).modelId).toBe('bge-m3');
  });
});
