import { describe, it, expect, vi } from 'vitest';
import { formatEmbeddingInput } from '../../src/cache/embedder.js';

// Mock the 'ai' module to avoid real API calls
vi.mock('ai', () => ({
  embed: vi.fn().mockResolvedValue({
    embedding: new Array(1024).fill(0.1),
  }),
}));

// Mock @ai-sdk/openai-compatible
vi.mock('@ai-sdk/openai-compatible', () => ({
  createOpenAICompatible: vi.fn().mockReturnValue({
    textEmbeddingModel: vi.fn().mockReturnValue({ modelId: 'bge-m3' }),
  }),
}));

describe('formatEmbeddingInput', () => {
  it('concatenates error prompt with discovery entries', () => {
    const result = formatEmbeddingInput('nginx 502 bad gateway', {
      containers: 'nginx: running',
      logs: 'upstream prematurely closed',
    });

    expect(result).toBe(
      'ERROR: nginx 502 bad gateway\n\nCONTEXT:\ncontainers: nginx: running\nlogs: upstream prematurely closed',
    );
  });

  it('handles empty discovery', () => {
    const result = formatEmbeddingInput('some error', {});
    expect(result).toBe('ERROR: some error\n\nCONTEXT:\n');
  });

  it('handles multiple discovery entries', () => {
    const result = formatEmbeddingInput('error', {
      a: '1',
      b: '2',
      c: '3',
    });

    expect(result).toContain('a: 1');
    expect(result).toContain('b: 2');
    expect(result).toContain('c: 3');
  });
});

describe('generateEmbedding', () => {
  it('returns 1024-dim array from mocked provider', async () => {
    // Import after mocks are set up
    const { generateEmbedding } = await import('../../src/cache/embedder.js');
    const result = await generateEmbedding(
      'test input',
      'http://localhost:11434/v1',
      'bge-m3',
    );

    expect(result).not.toBeNull();
    expect(result!.length).toBe(1024);
  });
});
