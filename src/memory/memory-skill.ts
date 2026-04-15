/**
 * Memory query response generation for MemPalace semantic memory.
 * Handles incoming memory queries by searching the incident store with
 * temporal decay scoring and formatting results based on intent classification.
 *
 * Output: plain text formatted for Ink terminal readiness (Phase 19).
 * Uses simple formatting (dashes, pipes) -- no Chalk/Box dependency yet.
 */

import type { IntentResult } from './intent-classifier.js';
import type { IncidentStore } from './incident-store.js';
import type { EntityStore } from './entity-store.js';
import type { MemoryConfig, MemorySearchResult } from './types.js';
import { searchWithDecay } from './memory-search.js';
import { generateEmbedding } from '../cache/embedder.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MemoryQueryParams {
  intent: IntentResult;
  memoryConfig: MemoryConfig;
  incidentStore: IncidentStore;
  entityStore: EntityStore;
  embeddingParams: {
    baseURL: string;
    modelId: string;
    apiKey?: string;
  };
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatDate(isoDate: string): string {
  try {
    const d = new Date(isoDate);
    return d.toISOString().slice(0, 10);
  } catch {
    return isoDate;
  }
}

function formatListResponse(results: MemorySearchResult[]): string {
  const header = '  Date       | Skill           | Root Cause                                | Outcome';
  const separator = '  -----------|-----------------|-------------------------------------------|----------';

  const rows = results.map((r) => {
    const date = formatDate(r.incident.created_at);
    const skill = r.incident.skill_name.padEnd(15);
    const rootCause = r.incident.root_cause.length > 41
      ? r.incident.root_cause.slice(0, 38) + '...'
      : r.incident.root_cause.padEnd(41);
    const outcome = r.incident.outcome;
    return `  ${date} | ${skill} | ${rootCause} | ${outcome}`;
  });

  return [
    `Found ${results.length} incident${results.length !== 1 ? 's' : ''}:`,
    '',
    header,
    separator,
    ...rows,
  ].join('\n');
}

function formatNarrativeResponse(results: MemorySearchResult[]): string {
  const count = results.length;
  if (count === 0) return 'No incidents found matching your query.';

  const lines: string[] = [
    `Found ${count} related incident${count !== 1 ? 's' : ''}:`,
    '',
  ];

  // Group by skill for narrative coherence
  const bySkill = new Map<string, MemorySearchResult[]>();
  for (const r of results) {
    const skill = r.incident.skill_name;
    if (!bySkill.has(skill)) bySkill.set(skill, []);
    bySkill.get(skill)!.push(r);
  }

  for (const [skill, incidents] of bySkill) {
    lines.push(`- ${skill}: ${incidents.length} incident${incidents.length !== 1 ? 's' : ''}`);
    for (const inc of incidents) {
      lines.push(`  - ${formatDate(inc.incident.created_at)}: ${inc.incident.root_cause} (${inc.incident.outcome})`);
    }
  }

  return lines.join('\n');
}

function formatCombinedResponse(results: MemorySearchResult[]): string {
  const list = formatListResponse(results);
  const narrative = formatNarrativeResponse(results);

  return [list, '', '---', '', narrative].join('\n');
}

// ---------------------------------------------------------------------------
// Time range filtering
// ---------------------------------------------------------------------------

function filterByTimeRange(
  results: MemorySearchResult[],
  timeRange?: { from?: string; to?: string },
): MemorySearchResult[] {
  if (!timeRange) return results;

  const from = timeRange.from ? new Date(timeRange.from).getTime() : -Infinity;
  const to = timeRange.to ? new Date(timeRange.to).getTime() : Infinity;

  return results.filter((r) => {
    const createdAt = new Date(r.incident.created_at).getTime();
    return createdAt >= from && createdAt <= to;
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Handle a memory query by searching incidents and formatting results.
 * Generates an embedding from the intent's search_query, searches with
 * temporal decay, applies time range filtering, and formats the response.
 *
 * @param params - Memory query parameters including intent, stores, config
 * @returns Formatted plain text response
 */
export async function handleMemoryQuery(params: MemoryQueryParams): Promise<string> {
  const { intent, memoryConfig, incidentStore, embeddingParams } = params;

  // Generate embedding for search query
  const embedding = await generateEmbedding(
    intent.search_query,
    embeddingParams.baseURL,
    embeddingParams.modelId,
    { apiKey: embeddingParams.apiKey },
  );

  if (!embedding) {
    return 'No incidents found -- embedding generation failed.';
  }

  // Search with temporal decay scoring
  const limit = memoryConfig.l2Limit || 10;
  const results = await searchWithDecay(
    incidentStore,
    embedding,
    limit,
    { decayLambda: memoryConfig.decayLambda },
  );

  // Apply time range filter if specified
  const filtered = filterByTimeRange(results, intent.time_range);

  if (filtered.length === 0) {
    return 'No incidents found matching your query.';
  }

  // Format based on format_hint
  switch (intent.format_hint) {
    case 'list':
      return formatListResponse(filtered);
    case 'narrative':
      return formatNarrativeResponse(filtered);
    case 'combined':
      return formatCombinedResponse(filtered);
    default:
      return formatListResponse(filtered);
  }
}
