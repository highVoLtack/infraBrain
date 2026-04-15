/**
 * SSE (Server-Sent Events) consumption via native fetch ReadableStream
 *
 * parseSSEStream is a pure async generator (NOT a React hook) for testability.
 * useSSE is the React hook that wraps parseSSEStream with lifecycle management.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { SSEEventMap } from '../types.js';

// ---- SSE Stream Parser (Pure async generator) ----

export async function* parseSSEStream(
  response: Response
): AsyncGenerator<{ event: string; data: string }> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let currentEvent = '';
  let currentData = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (line.startsWith('event: ')) {
        currentEvent = line.slice(7);
      } else if (line.startsWith('data: ')) {
        currentData = line.slice(6);
      } else if (line === '' && currentEvent && currentData) {
        yield { event: currentEvent, data: currentData };
        currentEvent = '';
        currentData = '';
      }
    }
  }
}

// ---- SSE React Hook ----

export interface UseSSEOptions {
  method?: string;
  body?: unknown;
}

export interface UseSSEResult {
  connected: boolean;
  error?: string;
}

export function useSSE(
  url: string,
  onEvent: <K extends keyof SSEEventMap>(event: K, data: SSEEventMap[K]) => void,
  options?: UseSSEOptions
): UseSSEResult {
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const abortRef = useRef<AbortController | null>(null);

  const stableOnEvent = useCallback(onEvent, []);

  useEffect(() => {
    const controller = new AbortController();
    abortRef.current = controller;

    async function connect() {
      try {
        const fetchOptions: RequestInit = {
          signal: controller.signal,
          headers: { Accept: 'text/event-stream' },
        };

        if (options?.method) {
          fetchOptions.method = options.method;
        }

        if (options?.body) {
          fetchOptions.headers = {
            ...fetchOptions.headers,
            'Content-Type': 'application/json',
          };
          fetchOptions.body = JSON.stringify(options.body);
        }

        const response = await fetch(url, fetchOptions);

        if (!response.ok) {
          setError(`HTTP ${response.status}: ${response.statusText}`);
          return;
        }

        setConnected(true);
        setError(undefined);

        for await (const { event, data } of parseSSEStream(response)) {
          if (controller.signal.aborted) break;
          try {
            const parsed = JSON.parse(data);
            stableOnEvent(event as keyof SSEEventMap, parsed);
          } catch {
            // Skip malformed JSON
          }
        }

        setConnected(false);
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') {
          // Normal cleanup
          return;
        }
        setError(err instanceof Error ? err.message : 'SSE connection failed');
        setConnected(false);
      }
    }

    connect();

    return () => {
      controller.abort();
      abortRef.current = null;
    };
  }, [url, stableOnEvent]);

  return { connected, error };
}
