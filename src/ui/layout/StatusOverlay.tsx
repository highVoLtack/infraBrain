/**
 * StatusOverlay - Full overlay dashboard ("technical cockpit")
 *
 * Shows hard facts about the InfraBrain pipeline:
 * - Latest Call: model, in/out tokens, latency, cost of the most recent LLM call (D-16)
 * - Backends: baseUrl, status, latency, models
 * - Model Assignments: role -> model mapping
 * - Cache Stats: cumulative row + this-session row (D-15)
 * - Memory Stats: incident count, entity count, WAL size
 * - Intelligence Efficiency: Caveman/Perc v2.0 placeholders (D-23)
 * - Context Window: token usage visualization
 *
 * Polls /health + /status every 2.5s while mounted, stops on unmount (D-14).
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

/** Em-dash used for every "unknown / not yet available" figure (D-11, D-23). */
const EM_DASH = '—';

/** D-14: live poll cadence while the overlay is open. */
export const POLL_INTERVAL_MS = 2500;

export interface CacheRow {
  hitRate: string;
  totalEntries: number;
  avgConfidence: string;
}

export interface LatestCall {
  modelId: string;
  inputTokens: number;
  outputTokens: number | null;
  latencyMs: number;
  costUsd: number | null;
}

export interface OverlayData {
  backends: BackendInfo[];
  modelAssignments: ModelAssignment[];
  /** Kept as the cumulative mirror for existing consumers. */
  cacheStats: CacheRow;
  /** D-15: all-time figures plus the current-session figures. */
  cacheBreakdown: {
    cumulative: CacheRow;
    thisSession: { hits: number; llmCallsSaved: number };
  };
  memoryStats: {
    incidentCount: number;
    entityCount: number;
    walSize: string;
    /** D-23: v2.0 Caveman metrics -- null until the distillation pipeline ships. */
    compressionRatio: number | null;
    totalTokensSaved: number | null;
    distilledEntriesCount: number | null;
  };
  contextWindow: {
    current: number;
    max: number;
    percentage: number;
  };
  /** D-16: most recent LLM call; undefined until one has happened. */
  latestCall?: LatestCall;
  inferenceMode: string;
}

interface StatusResponseShape {
  cache?: { totalEntries?: number; hitRate?: number | null; avgConfidence?: number | null };
  memory?: {
    incidentCount?: number;
    entityCount?: number;
    walSize?: string;
    compressionRatio?: number | null;
    totalTokensSaved?: number | null;
    distilledEntriesCount?: number | null;
  };
  context?: { currentTokens?: number; maxTokens?: number };
  latestCall?: Partial<LatestCall>;
}

/** Coerce to a finite number, falling back to `fallback` for null/undefined/NaN. */
function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Coerce to a finite number or null -- never NaN, never undefined. */
function numOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
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
  statusResponse?: StatusResponseShape,
): OverlayData {
  const backends = healthResponse.backends ?? [];

  const modelAssignments: ModelAssignment[] = (healthResponse.modelRegistry ?? []).map((m) => ({
    role: m.role,
    model: m.model,
  }));

  const cache = statusResponse?.cache;
  const cacheStats: CacheRow = {
    hitRate: cache?.hitRate != null ? `${(num(cache.hitRate, 0) * 100).toFixed(1)}%` : 'N/A',
    totalEntries: num(cache?.totalEntries, 0),
    avgConfidence:
      cache?.avgConfidence != null ? `${(num(cache.avgConfidence, 0) * 100).toFixed(1)}%` : 'N/A',
  };

  // D-15: the cumulative row mirrors the all-time figures; the this-session row
  // is zeroed in v1.3 -- the backend does not yet aggregate per-live-session cache
  // hits, but the shape is locked so no UI change is needed when it does.
  const cacheBreakdown = {
    cumulative: { ...cacheStats },
    thisSession: { hits: 0, llmCallsSaved: 0 },
  };

  const mem = statusResponse?.memory;
  const memoryStats = {
    incidentCount: num(mem?.incidentCount, 0),
    entityCount: num(mem?.entityCount, 0),
    walSize: typeof mem?.walSize === 'string' ? mem.walSize : '0 B',
    compressionRatio: numOrNull(mem?.compressionRatio),
    totalTokensSaved: numOrNull(mem?.totalTokensSaved),
    distilledEntriesCount: numOrNull(mem?.distilledEntriesCount),
  };

  const ctx = statusResponse?.context;
  const currentTokens = num(ctx?.currentTokens, 0);
  const maxTokens = num(ctx?.maxTokens, 32768);
  const contextWindow = {
    current: currentTokens,
    max: maxTokens,
    percentage: maxTokens > 0 ? Math.round((currentTokens / maxTokens) * 100) : 0,
  };

  // D-16: parsed when present so the backend can start emitting it without any
  // UI change. Undefined (not a zeroed object) while no call has happened.
  const lc = statusResponse?.latestCall;
  const latestCall: LatestCall | undefined =
    lc && typeof lc.modelId === 'string'
      ? {
          modelId: lc.modelId,
          inputTokens: num(lc.inputTokens, 0),
          outputTokens: numOrNull(lc.outputTokens),
          latencyMs: num(lc.latencyMs, 0),
          costUsd: numOrNull(lc.costUsd),
        }
      : undefined;

  return {
    backends,
    modelAssignments,
    cacheStats,
    cacheBreakdown,
    memoryStats,
    contextWindow,
    ...(latestCall ? { latestCall } : {}),
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
  /**
   * Live per-session token count. `/status` reports `context.currentTokens: 0`
   * because the real figure lives in the SSE session state (DPEVState.sessionSummary),
   * which is not reachable from the REST aggregator. When a caller can supply it,
   * it overrides the endpoint value and the Context Window bar becomes live.
   */
  sessionTokens?: number;
}

export function StatusOverlay({
  apiBaseUrl,
  onDismiss,
  sessionTokens,
}: StatusOverlayProps): React.ReactElement {
  const [data, setData] = useState<OverlayData>({
    backends: [],
    modelAssignments: [],
    cacheStats: { hitRate: 'N/A', totalEntries: 0, avgConfidence: 'N/A' },
    cacheBreakdown: {
      cumulative: { hitRate: 'N/A', totalEntries: 0, avgConfidence: 'N/A' },
      thisSession: { hits: 0, llmCallsSaved: 0 },
    },
    memoryStats: {
      incidentCount: 0,
      entityCount: 0,
      walSize: '0 B',
      compressionRatio: null,
      totalTokensSaved: null,
      distilledEntriesCount: null,
    },
    contextWindow: { current: 0, max: 32768, percentage: 0 },
    inferenceMode: 'sequential',
  });

  // Esc key dismisses overlay (isActive ensures priority capture per Pitfall 6)
  useInput((_input, key) => {
    if (key.escape) {
      onDismiss();
    }
  }, { isActive: true });

  // Fetch on mount, then poll every 2.5s while open (D-14). The interval is
  // cleared on unmount, so a dismissed overlay costs nothing.
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
    const interval = setInterval(() => {
      if (!cancelled) void fetchOverlayData();
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [apiBaseUrl]);

  // The live token figure wins over the endpoint's placeholder when supplied.
  const currentTokens = sessionTokens ?? data.contextWindow.current;
  const maxTokens = data.contextWindow.max;
  const contextPercentage =
    maxTokens > 0 ? Math.round((currentTokens / maxTokens) * 100) : 0;

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

      {/* Latest Call (D-16) */}
      <Text bold color="white">Latest Call</Text>
      {data.latestCall ? (
        <Text>
          {`  ${data.latestCall.modelId} · in:${data.latestCall.inputTokens} · out:${data.latestCall.outputTokens ?? EM_DASH} · ${data.latestCall.latencyMs}ms · $${data.latestCall.costUsd != null ? data.latestCall.costUsd.toFixed(4) : EM_DASH}`}
        </Text>
      ) : (
        <Text dimColor>  No LLM calls yet</Text>
      )}
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

      {/* Cache Stats (D-15) -- cumulative + this-session split */}
      <Text bold color="white">Cache Stats</Text>
      <Text>
        {`  Cumulative:   Hit Rate ${data.cacheBreakdown.cumulative.hitRate}  ·  Entries ${data.cacheBreakdown.cumulative.totalEntries}  ·  Avg Confidence ${data.cacheBreakdown.cumulative.avgConfidence}`}
      </Text>
      <Text>
        {`  This Session: ${data.cacheBreakdown.thisSession.hits} hits  ·  ${data.cacheBreakdown.thisSession.llmCallsSaved} LLM calls saved`}
      </Text>
      <Text> </Text>

      {/* Memory Stats */}
      <Text bold color="white">Memory Stats</Text>
      <Text>  Incidents: {data.memoryStats.incidentCount}</Text>
      <Text>  Entities: {data.memoryStats.entityCount}</Text>
      <Text>  WAL Size: {data.memoryStats.walSize}</Text>
      <Text> </Text>

      {/* Intelligence Efficiency (D-23) -- v2.0 Caveman placeholders */}
      <Text bold color="white">Intelligence Efficiency</Text>
      <Text dimColor>
        {`  Memory Density: ${data.memoryStats.compressionRatio ?? EM_DASH} (v2.0)`}
      </Text>
      <Text dimColor>
        {`  Tokens Saved: ${data.memoryStats.totalTokensSaved ?? EM_DASH} (v2.0)`}
      </Text>
      <Text dimColor>
        {`  Distilled Entries: ${data.memoryStats.distilledEntriesCount ?? EM_DASH} (v2.0)`}
      </Text>
      <Text> </Text>

      {/* Context Window */}
      <Text bold color="white">Context Window</Text>
      <Text>  {renderProgressBar(contextPercentage)}</Text>
      <Text dimColor>  {currentTokens} / {maxTokens} tokens</Text>
    </Box>
  );
}
