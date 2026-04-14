import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('ai', () => ({
  generateObject: vi.fn(),
}));

import { generateObject } from 'ai';
import { classifyIntent, type IntentResult } from '../../src/memory/intent-classifier.js';
import type { LanguageModel } from 'ai';

const mockGenerateObject = vi.mocked(generateObject);
const mockModel = {} as LanguageModel;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('classifyIntent', () => {
  it('returns type "memory" for "what did we fix last week?"', async () => {
    const expectedResult: IntentResult = {
      type: 'memory',
      search_query: 'fixes from last week',
      time_range: {
        from: '2026-04-07T00:00:00.000Z',
        to: '2026-04-14T00:00:00.000Z',
      },
      format_hint: 'list',
    };

    mockGenerateObject.mockResolvedValueOnce({
      object: expectedResult,
      finishReason: 'stop',
      usage: { promptTokens: 0, completionTokens: 0 },
      warnings: [],
      request: {} as any,
      response: {} as any,
      rawResponse: undefined,
      toJsonResponse: (() => new Response()) as any,
      providerMetadata: undefined,
    } as any);

    const result = await classifyIntent('what did we fix last week?', mockModel);

    expect(result.type).toBe('memory');
    expect(result.search_query).toBe('fixes from last week');
    expect(result.time_range).toBeDefined();
    expect(result.time_range!.from).toBeDefined();
    expect(result.time_range!.to).toBeDefined();
    expect(result.format_hint).toBe('list');
  });

  it('returns type "action" for "redis is down"', async () => {
    const expectedResult: IntentResult = {
      type: 'action',
      search_query: 'redis is down',
      format_hint: 'combined',
    };

    mockGenerateObject.mockResolvedValueOnce({
      object: expectedResult,
      finishReason: 'stop',
      usage: { promptTokens: 0, completionTokens: 0 },
      warnings: [],
      request: {} as any,
      response: {} as any,
      rawResponse: undefined,
      toJsonResponse: (() => new Response()) as any,
      providerMetadata: undefined,
    } as any);

    const result = await classifyIntent('redis is down', mockModel);

    expect(result.type).toBe('action');
    expect(result.search_query).toBe('redis is down');
    expect(result.format_hint).toBe('combined');
  });

  it('returns type "combined" for "we had this before, fix it the same way"', async () => {
    const expectedResult: IntentResult = {
      type: 'combined',
      search_query: 'previous similar incident and fix',
      format_hint: 'combined',
    };

    mockGenerateObject.mockResolvedValueOnce({
      object: expectedResult,
      finishReason: 'stop',
      usage: { promptTokens: 0, completionTokens: 0 },
      warnings: [],
      request: {} as any,
      response: {} as any,
      rawResponse: undefined,
      toJsonResponse: (() => new Response()) as any,
      providerMetadata: undefined,
    } as any);

    const result = await classifyIntent('we had this before, fix it the same way', mockModel);

    expect(result.type).toBe('combined');
    expect(result.format_hint).toBe('combined');
  });

  it('extracts time_range with from/to ISO dates from natural language', async () => {
    const expectedResult: IntentResult = {
      type: 'memory',
      search_query: 'incidents in March',
      time_range: {
        from: '2026-03-01T00:00:00.000Z',
        to: '2026-03-31T23:59:59.000Z',
      },
      format_hint: 'list',
    };

    mockGenerateObject.mockResolvedValueOnce({
      object: expectedResult,
      finishReason: 'stop',
      usage: { promptTokens: 0, completionTokens: 0 },
      warnings: [],
      request: {} as any,
      response: {} as any,
      rawResponse: undefined,
      toJsonResponse: (() => new Response()) as any,
      providerMetadata: undefined,
    } as any);

    const result = await classifyIntent('was hatten wir im Maerz?', mockModel);

    expect(result.time_range).toBeDefined();
    expect(result.time_range!.from).toBe('2026-03-01T00:00:00.000Z');
    expect(result.time_range!.to).toBe('2026-03-31T23:59:59.000Z');
  });

  it('returns search_query extracted from the user prompt', async () => {
    const expectedResult: IntentResult = {
      type: 'memory',
      search_query: 'nginx 502 errors',
      format_hint: 'narrative',
    };

    mockGenerateObject.mockResolvedValueOnce({
      object: expectedResult,
      finishReason: 'stop',
      usage: { promptTokens: 0, completionTokens: 0 },
      warnings: [],
      request: {} as any,
      response: {} as any,
      rawResponse: undefined,
      toJsonResponse: (() => new Response()) as any,
      providerMetadata: undefined,
    } as any);

    const result = await classifyIntent('tell me about past nginx 502 errors', mockModel);

    expect(result.search_query).toBe('nginx 502 errors');
  });

  it('returns format_hint appropriate to query type', async () => {
    const expectedResult: IntentResult = {
      type: 'memory',
      search_query: 'all incidents analysis',
      format_hint: 'narrative',
    };

    mockGenerateObject.mockResolvedValueOnce({
      object: expectedResult,
      finishReason: 'stop',
      usage: { promptTokens: 0, completionTokens: 0 },
      warnings: [],
      request: {} as any,
      response: {} as any,
      rawResponse: undefined,
      toJsonResponse: (() => new Response()) as any,
      providerMetadata: undefined,
    } as any);

    const result = await classifyIntent('summarize all our infrastructure issues', mockModel);

    expect(result.format_hint).toBe('narrative');
  });

  it('returns fallback on generateObject failure', async () => {
    mockGenerateObject.mockRejectedValueOnce(new Error('LLM timeout'));

    const result = await classifyIntent('what did we fix?', mockModel);

    // Graceful degradation: treat as action
    expect(result.type).toBe('action');
    expect(result.search_query).toBe('what did we fix?');
    expect(result.format_hint).toBe('combined');
  });

  it('passes the model to generateObject', async () => {
    const expectedResult: IntentResult = {
      type: 'memory',
      search_query: 'test',
      format_hint: 'list',
    };

    mockGenerateObject.mockResolvedValueOnce({
      object: expectedResult,
      finishReason: 'stop',
      usage: { promptTokens: 0, completionTokens: 0 },
      warnings: [],
      request: {} as any,
      response: {} as any,
      rawResponse: undefined,
      toJsonResponse: (() => new Response()) as any,
      providerMetadata: undefined,
    } as any);

    await classifyIntent('test query', mockModel);

    expect(mockGenerateObject).toHaveBeenCalledWith(
      expect.objectContaining({
        model: mockModel,
      }),
    );
  });

  it('injects current date/time in system prompt', async () => {
    const expectedResult: IntentResult = {
      type: 'memory',
      search_query: 'test',
      format_hint: 'list',
    };

    mockGenerateObject.mockResolvedValueOnce({
      object: expectedResult,
      finishReason: 'stop',
      usage: { promptTokens: 0, completionTokens: 0 },
      warnings: [],
      request: {} as any,
      response: {} as any,
      rawResponse: undefined,
      toJsonResponse: (() => new Response()) as any,
      providerMetadata: undefined,
    } as any);

    await classifyIntent('what happened yesterday?', mockModel);

    // System prompt should contain current date/time for relative time resolution
    const call = mockGenerateObject.mock.calls[0][0] as any;
    expect(call.system).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
  });
});
