import { describe, it, expect } from 'vitest';
import { InfraBrainConfigSchema, ModelMapSchema, ModelMapEntrySchema } from '../../src/config/types.js';

describe('ModelMapEntrySchema', () => {
  it('accepts a string entry and returns it as-is', () => {
    const result = ModelMapEntrySchema.parse('qwen3.5:9b');
    expect(result).toBe('qwen3.5:9b');
  });

  it('accepts an object entry with model and baseUrl', () => {
    const entry = { model: 'qwen3.5:9b', baseUrl: 'http://localhost:8000/v1' };
    const result = ModelMapEntrySchema.parse(entry);
    expect(result).toEqual(entry);
  });
});

describe('ModelMapSchema', () => {
  it('parses string entries', () => {
    const result = ModelMapSchema.parse({ default: 'qwen3.5:9b' });
    expect(result.default).toBe('qwen3.5:9b');
  });

  it('parses object entries', () => {
    const result = ModelMapSchema.parse({
      default: { model: 'qwen3.5:9b', baseUrl: 'http://localhost:8000/v1' },
    });
    expect(result.default).toEqual({ model: 'qwen3.5:9b', baseUrl: 'http://localhost:8000/v1' });
  });

  it('parses mixed string and object entries', () => {
    const result = ModelMapSchema.parse({
      default: 'qwen3.5:9b',
      triage: { model: 'qwen3.5:9b', baseUrl: 'http://localhost:8000/v1' },
    });
    expect(result.default).toBe('qwen3.5:9b');
    expect(result.triage).toEqual({ model: 'qwen3.5:9b', baseUrl: 'http://localhost:8000/v1' });
  });

  it('provides default values for all 7 roles', () => {
    const result = ModelMapSchema.parse({});
    expect(result.default).toBe('infrabrain');
    expect(result.strategic).toBe('llama3.3:70b');
    expect(result.forensic).toBe('deepseek-r1:32b');
    expect(result.worker).toBe('qwen2.5-coder:7b');
    expect(result.vision).toBe('llama3.2-vision');
    expect(result.triage).toBe('infrabrain');
    expect(result.embedding).toBe('bge-m3');
  });
});

describe('InfraBrainConfigSchema', () => {
  it('has defaultBaseUrl field with /v1 suffix', () => {
    const result = InfraBrainConfigSchema.parse({});
    expect(result.defaultBaseUrl).toBe('http://localhost:11434/v1');
  });

  it('maps legacy ollamaBaseUrl to defaultBaseUrl', () => {
    const result = InfraBrainConfigSchema.parse({ ollamaBaseUrl: 'http://myhost:11434/v1' });
    expect(result.defaultBaseUrl).toBe('http://myhost:11434/v1');
  });

  it('does not have ollamaBaseUrl in parsed output', () => {
    const result = InfraBrainConfigSchema.parse({ ollamaBaseUrl: 'http://myhost:11434/v1' });
    expect(result).not.toHaveProperty('ollamaBaseUrl');
  });

  it('prefers defaultBaseUrl over ollamaBaseUrl when both provided', () => {
    const result = InfraBrainConfigSchema.parse({
      defaultBaseUrl: 'http://new:8000/v1',
      ollamaBaseUrl: 'http://old:11434/v1',
    });
    expect(result.defaultBaseUrl).toBe('http://new:8000/v1');
  });
});
