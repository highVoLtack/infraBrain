/**
 * StatusOverlay - Full overlay dashboard ("technical cockpit")
 *
 * Shows hard facts about the InfraBrain pipeline:
 * - Backends: baseUrl, status, latency, models
 * - Model Assignments: role -> model mapping
 * - Cache Stats: hit rate, total entries, avg confidence
 * - Memory Stats: incident count, entity count, WAL size
 * - Context Window: token usage visualization
 * - Compression Efficiency: placeholder for Caveman/Perc (v2.0)
 *
 * Activated by 's' key, dismissed by Esc.
 * When active, other panel focus hooks should be disabled (Pitfall 6).
 */

import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';

// ---- Pure logic (testable without React) ----

export interface BackendInfo {
  baseUrl: string;
  connected: boolean;
  responseTimeMs?: number;
  models?: string[];
  error?: string;
}

export interface ModelAssignment {
  role: string;
  model: string;
}

export interface OverlayData {
  backends: BackendInfo[];
  modelAssignments: ModelAssignment[];
  cacheStats: {
    hitRate: string;
    totalEntries: number;
    avgConfidence: string;
  };
  memoryStats: {
    incidentCount: number;
    entityCount: number;
    walSize: string;
  };
  contextWindow: {
    current: number;
    max: number;
    percentage: number;
  };
  inferenceMode: string;
}

/**
 * Pure function: parse /health and /status responses into overlay display data.
 * Exported for unit testing without React context.
 */
export function parseOverlayData(
  healthResponse: {
    backends?: BackendInfo[];
    modelRegistry?: Array<{ role: string; model: string }>;
    inferenceMode?: string;
  },
  statusResponse?: {
    cache?: { totalEntries?: number; hitRate?: number; avgConfidence?: number };
    memory?: { incidentCount?: number; entityCount?: number; walSize?: string };
    context?: { currentTokens?: number; maxTokens?: number };
  },
): OverlayData {
  const backends = healthResponse.backends ?? [];

  const modelAssignments: ModelAssignment[] = (healthResponse.modelRegistry ?? []).map((m) => ({
    role: m.role,
    model: m.model,
  }));

  const cache = statusResponse?.cache;
  const cacheStats = {
    hitRate: cache?.hitRate != null ? `${(cache.hitRate * 100).toFixed(1)}%` : 'N/A',
    totalEntries: cache?.totalEntries ?? 0,
    avgConfidence: cache?.avgConfidence != null ? `${(cache.avgConfidence * 100).toFixed(1)}%` : 'N/A',
  };

  const mem = statusResponse?.memory;
  const memoryStats = {
    incidentCount: mem?.incidentCount ?? 0,
    entityCount: mem?.entityCount ?? 0,
    walSize: mem?.walSize ?? '0 B',
  };

  const ctx = statusResponse?.context;
  const currentTokens = ctx?.currentTokens ?? 0;
  const maxTokens = ctx?.maxTokens ?? 32768;
  const contextWindow = {
    current: currentTokens,
    max: maxTokens,
    percentage: maxTokens > 0 ? Math.round((currentTokens / maxTokens) * 100) : 0,
  };

  return {
    backends,
    modelAssignments,
    cacheStats,
    memoryStats,
    contextWindow,
    inferenceMode: healthResponse.inferenceMode ?? 'sequential',
  };
}

/**
 * Pure function: render a text-based progress bar.
 */
export function renderProgressBar(percentage: number, width: number = 30): string {
  const filled = Math.round((percentage / 100) * width);
  const empty = width - filled;
  return `[${'#'.repeat(filled)}${'-'.repeat(empty)}] ${percentage}%`;
}

// ---- React Component ----

export interface StatusOverlayProps {
  apiBaseUrl: string;
  onDismiss: () => void;
}

export function StatusOverlay({ apiBaseUrl, onDismiss }: StatusOverlayProps): React.ReactElement {
  const [data, setData] = useState<OverlayData>({
    backends: [],
    modelAssignments: [],
    cacheStats: { hitRate: 'N/A', totalEntries: 0, avgConfidence: 'N/A' },
    memoryStats: { incidentCount: 0, entityCount: 0, walSize: '0 B' },
    contextWindow: { current: 0, max: 32768, percentage: 0 },
    inferenceMode: 'sequential',
  });

  // Esc key dismisses overlay (isActive ensures priority capture per Pitfall 6)
  useInput((_input, key) => {
    if (key.escape) {
      onDismiss();
    }
  }, { isActive: true });

  // Fetch data on mount
  useEffect(() => {
    let cancelled = false;

    async function fetchOverlayData() {
      try {
        const [healthRes, statusRes] = await Promise.all([
          fetch(`${apiBaseUrl}/health`).catch(() => null),
          fetch(`${apiBaseUrl}/status`).catch(() => null),
        ]);

        const healthData = healthRes?.ok ? await healthRes.json() : {};
        const statusData = statusRes?.ok ? await statusRes.json() : {};

        if (!cancelled) {
          setData(parseOverlayData(healthData, statusData));
        }
      } catch {
        // Graceful degradation: show defaults
      }
    }

    fetchOverlayData();
    return () => { cancelled = true; };
  }, [apiBaseUrl]);

  return (
    <Box
      flexDirection="column"
      borderStyle="double"
      borderColor="cyanBright"
      paddingX={2}
      paddingY={1}
      width="100%"
    >
      <Text bold color="cyanBright">STATUS DASHBOARD</Text>
      <Text dimColor>Press Esc to dismiss</Text>
      <Text> </Text>

      {/* Backends */}
      <Text bold color="white">Backends</Text>
      {data.backends.length > 0 ? (
        data.backends.map((b, i) => (
          <Box key={i}>
            <Text color={b.connected ? 'green' : 'red'}>
              {b.connected ? '\u25CF' : '\u25CB'}
            </Text>
            <Text> {b.baseUrl}</Text>
            <Text dimColor> {b.connected ? `${b.responseTimeMs ?? '?'}ms` : b.error ?? 'disconnected'}</Text>
            {b.models && b.models.length > 0 && (
              <Text dimColor> [{b.models.join(', ')}]</Text>
            )}
          </Box>
        ))
      ) : (
        <Text dimColor>  No backends configured</Text>
      )}
      <Text> </Text>

      {/* Model Assignments */}
      <Text bold color="white">Model Assignments</Text>
      {data.modelAssignments.length > 0 ? (
        data.modelAssignments.map((m, i) => (
          <Text key={i}>  {m.role}: {m.model}</Text>
        ))
      ) : (
        <Text dimColor>  No model assignments</Text>
      )}
      <Text> </Text>

      {/* Cache Stats */}
      <Text bold color="white">Cache Stats</Text>
      <Text>  Hit Rate: {data.cacheStats.hitRate}</Text>
      <Text>  Total Entries: {data.cacheStats.totalEntries}</Text>
      <Text>  Avg Confidence: {data.cacheStats.avgConfidence}</Text>
      <Text> </Text>

      {/* Memory Stats */}
      <Text bold color="white">Memory Stats</Text>
      <Text>  Incidents: {data.memoryStats.incidentCount}</Text>
      <Text>  Entities: {data.memoryStats.entityCount}</Text>
      <Text>  WAL Size: {data.memoryStats.walSize}</Text>
      <Text> </Text>

      {/* Context Window */}
      <Text bold color="white">Context Window</Text>
      <Text>  {renderProgressBar(data.contextWindow.percentage)}</Text>
      <Text dimColor>  {data.contextWindow.current} / {data.contextWindow.max} tokens</Text>
      <Text> </Text>

      {/* Compression Efficiency (placeholder) */}
      <Text bold color="white">Compression Efficiency</Text>
      <Text dimColor>  Caveman/Perc integration: v2.0</Text>
    </Box>
  );
}
