import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LanguageModel } from 'ai';

// Mock the 'ai' module
vi.mock('ai', () => ({
  streamText: vi.fn(),
  generateText: vi.fn(),
}));

import { createProvider } from '../../src/llm/provider.js';
import type { LLMProvider } from '../../src/llm/types.js';

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

describe('Ollama Model Factory', () => {
  it('createOllamaModel returns a LanguageModel-compatible object', async () => {
    // We mock ai-sdk-ollama since Ollama isn't running
    vi.mock('ai-sdk-ollama', () => ({
      ollama: vi.fn((modelName: string) => ({
        specificationVersion: 'v2',
        provider: 'ollama',
        modelId: modelName,
        doGenerate: vi.fn(),
        doStream: vi.fn(),
      })),
    }));

    const { createOllamaModel } = await import('../../src/llm/ollama.js');
    const model = createOllamaModel('llama3.3:70b');

    expect(model).toBeDefined();
    expect((model as any).provider).toBe('ollama');
    expect((model as any).modelId).toBe('llama3.3:70b');
  });

  it('createOllamaModel uses default model name when none provided', async () => {
    const { createOllamaModel } = await import('../../src/llm/ollama.js');
    const model = createOllamaModel();

    expect(model).toBeDefined();
    expect((model as any).modelId).toBe('llama3.3:70b');
  });
});
