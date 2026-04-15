/**
 * Persistent 2-3 line header bar with system metrics
 *
 * Shows: InfraBrain version, inference mode badge, active model name,
 * backend health dot indicators. Fetches /health every 30 seconds.
 * Header color adapts based on inference mode.
 */

import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';

// ---- Pure logic (testable without React) ----

export interface BackendStatus {
  abbreviatedUrl: string;
  connected: boolean;
}

export interface HeaderData {
  title: string;
  inferenceMode: string;
  activeModel: string;
  backends: BackendStatus[];
}

/**
 * Abbreviate a backend URL for display.
 * Strips protocol and path suffix, keeps host:port (omits default ports).
 */
function abbreviateUrl(baseUrl: string): string {
  try {
    const url = new URL(baseUrl);
    // Omit default ports (80 for http, 443 for https)
    const port = url.port;
    if (port && port !== '80' && port !== '443') {
      return `${url.hostname}:${port}`;
    }
    return url.hostname;
  } catch {
    // Fallback: strip common prefixes/suffixes
    return baseUrl
      .replace(/^https?:\/\//, '')
      .replace(/\/v1\/?$/, '')
      .replace(/\/v1beta\/openai\/?$/, '');
  }
}

/**
 * Pure function: parse health API response into header display data.
 * Exported for unit testing without React context.
 */
export function parseHealthData(apiResponse: {
  status?: string;
  backends: Array<{
    baseUrl: string;
    connected: boolean;
    models?: string[];
    responseTimeMs?: number;
    error?: string;
  }>;
  summary: string;
  inferenceMode: string;
}): HeaderData {
  const backends: BackendStatus[] = apiResponse.backends.map((b) => ({
    abbreviatedUrl: abbreviateUrl(b.baseUrl),
    connected: b.connected,
  }));

  // Find the first connected backend's first model as active model
  let activeModel = '?';
  for (const b of apiResponse.backends) {
    if (b.connected && b.models && b.models.length > 0) {
      activeModel = b.models[0]!;
      break;
    }
  }

  return {
    title: 'InfraBrain v1.3',
    inferenceMode: apiResponse.inferenceMode,
    activeModel,
    backends,
  };
}

// ---- React Component ----

export interface HeaderBarProps {
  apiBaseUrl: string;
}

/**
 * HeaderBar component: persistent 2-3 line header with system metrics.
 * Fetches /health on mount and every 30 seconds.
 * Shows inference mode badge, active model, backend health dots.
 */
export function HeaderBar({ apiBaseUrl }: HeaderBarProps): React.ReactElement {
  const [headerData, setHeaderData] = useState<HeaderData>({
    title: 'InfraBrain v1.3',
    inferenceMode: '?',
    activeModel: '?',
    backends: [],
  });

  useEffect(() => {
    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval> | undefined;

    async function fetchHealth() {
      try {
        const res = await fetch(`${apiBaseUrl}/health`);
        const data = await res.json();
        if (!cancelled) {
          setHeaderData(parseHealthData(data as Parameters<typeof parseHealthData>[0]));
        }
      } catch {
        // Graceful degradation: keep showing stale data with '?' for unavailable fields
        if (!cancelled) {
          setHeaderData((prev) => ({ ...prev }));
        }
      }
    }

    fetchHealth();
    intervalId = setInterval(fetchHealth, 30_000);

    return () => {
      cancelled = true;
      if (intervalId) clearInterval(intervalId);
    };
  }, [apiBaseUrl]);

  // Color adapts based on inference mode
  const modeColor = headerData.inferenceMode === 'parallel' ? 'green' : 'blue';
  const modeBadge = headerData.inferenceMode.toUpperCase();

  return (
    <Box flexDirection="column" paddingX={1}>
      {/* Line 1: Title | Mode Badge | Active Model */}
      <Box>
        <Text bold color="white">
          {headerData.title}
        </Text>
        <Text> </Text>
        <Text color={modeColor} bold>
          [{modeBadge}]
        </Text>
        <Text> </Text>
        <Text color="white">{headerData.activeModel}</Text>
      </Box>
      {/* Line 2: Backend health dots */}
      <Box>
        {headerData.backends.map((b, i) => (
          <Box key={i} marginRight={1}>
            <Text color={b.connected ? 'green' : 'red'}>
              {b.connected ? '\u25CF' : '\u25CF'}
            </Text>
            <Text color="gray"> {b.abbreviatedUrl}</Text>
          </Box>
        ))}
        {headerData.backends.length === 0 && (
          <Text color="gray">No backends configured</Text>
        )}
      </Box>
    </Box>
  );
}
