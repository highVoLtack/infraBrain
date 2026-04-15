/**
 * 4-layer wake-up context builder for MemPalace semantic memory.
 * Produces pinned (L0 identity + L1 recent) and evictable (L2 search + L3 deep) context
 * blocks for injection into the LLM prompt.
 *
 * Each layer is independently try-caught for graceful degradation.
 * Token budgets are enforced via countTokens().
 */

import type { IncidentStore } from './incident-store.js';
import type { EntityStore } from './entity-store.js';
import type { MemoryConfig, MemorySearchResult } from './types.js';
import { searchWithDecay } from './memory-search.js';
import { extractEntitiesFromText } from './entity-extractor.js';
import { generateEmbedding } from '../cache/embedder.js';
import { countTokens } from '../context/token-counter.js';

export interface WakeUpParams {
  currentPrompt: string;
  memoryConfig: MemoryConfig;
  embeddingParams: { baseURL: string; modelId: string; apiKey?: string };
  incidentStore: IncidentStore;
  entityStore: EntityStore;
}

export interface WakeUpResult {
  pinned: string;
  evictable: string;
}

/**
 * Build wake-up context with 4 layers:
 * - L0 Identity (~100 tokens, pinned): incident count, domains, success rate
 * - L1 Recent (~500 tokens, pinned): last N incidents as one-liners
 * - L2 Filtered Search (evictable): vector search with decay scoring
 * - L3 Deep Semantic (evictable, conditional): entity-based search on weak L2
 *
 * Returns { pinned, evictable } strings. Both empty on total failure.
 */
export async function buildWakeUpContext(params: WakeUpParams): Promise<WakeUpResult> {
  const { currentPrompt, memoryConfig, embeddingParams, incidentStore, entityStore } = params;

  let l0 = '';
  let l1 = '';
  let l2 = '';
  let l3 = '';
  let bestL2Similarity = 1.0; // default to high so L3 doesn't fire if L2 fails

  // --- L0 Identity (pinned) ---
  try {
    const stats = await incidentStore.getStats();
    if (stats && stats.totalIncidents > 0) {
      const topDomainNames = stats.topDomains.slice(0, 3).map(d => d.skill_name).join(', ');
      l0 = `You have resolved ${stats.totalIncidents} incidents. Top domains: ${topDomainNames}. Success rate: ${stats.successRate.toFixed(1)}%.`;
    }
  } catch {
    // L0 unavailable -- proceed without identity
  }

  // --- L1 Recent (pinned) ---
  try {
    const recent = await incidentStore.getRecent(5);
    if (recent.length > 0) {
      const lines = recent.map(row => {
        const date = (row['created_at'] as string).split('T')[0];
        const skill = row['skill_name'] as string;
        const rootCause = row['root_cause'] as string;
        const outcome = row['outcome'] as string;
        return `[${date}] ${skill}: ${rootCause} -> ${outcome}`;
      });
      l1 = lines.join('\n');
    }
  } catch {
    // L1 unavailable -- proceed without recent
  }

  // --- L2 Filtered Search (evictable) ---
  let l2Results: MemorySearchResult[] = [];
  try {
    const embedding = await generateEmbedding(
      currentPrompt,
      embeddingParams.baseURL,
      embeddingParams.modelId,
      { apiKey: embeddingParams.apiKey },
    );

    if (embedding) {
      l2Results = await searchWithDecay(
        incidentStore,
        embedding,
        memoryConfig.l2Limit,
        { decayLambda: memoryConfig.decayLambda },
      );

      if (l2Results.length > 0) {
        bestL2Similarity = Math.max(...l2Results.map(r => r.similarity));

        const lines = l2Results.map(r => {
          const date = r.incident.created_at.split('T')[0];
          return `[Score: ${r.score.toFixed(2)}] ${r.incident.root_cause} (${r.incident.skill_name}, ${date})`;
        });
        l2 = `### Similar Past Incidents\n${lines.join('\n')}`;
      }
    }
  } catch {
    // L2 unavailable -- proceed without search
  }

  // --- L3 Deep Semantic (evictable, conditional) ---
  try {
    if (bestL2Similarity < memoryConfig.l2SimilarityThreshold) {
      const entities = extractEntitiesFromText(currentPrompt);
      if (entities.length > 0) {
        const values = entities.map(e => e.value);
        const entityResults = await entityStore.searchByEntities(values);

        if (entityResults.length > 0) {
          const incidentIds = [...new Set(entityResults.map(r => r['related_incident_id'] as string))];
          const lines = incidentIds.map(id => {
            const relatedEntities = entityResults
              .filter(r => r['related_incident_id'] === id)
              .map(r => `${r['entity_type']}:${r['entity_value']}`)
              .join(', ');
            return `Incident ${id}: ${relatedEntities}`;
          });
          l3 = `### Deep Search\n${lines.join('\n')}`;
        }
      }
    }
  } catch {
    // L3 unavailable -- proceed without deep search
  }

  // --- Assemble output ---
  const pinnedParts: string[] = [];
  if (l0) pinnedParts.push(`### Identity\n${l0}`);
  if (l1) pinnedParts.push(`### Recent\n${l1}`);

  const pinned = pinnedParts.length > 0 ? `## Memory\n${pinnedParts.join('\n\n')}` : '';

  // Token budget enforcement for L2+L3
  let evictable = '';
  const evictableParts: string[] = [];
  if (l2) evictableParts.push(l2);
  if (l3) evictableParts.push(l3);

  if (evictableParts.length > 0) {
    const combined = evictableParts.join('\n\n');
    const tokens = countTokens(combined);

    if (tokens <= memoryConfig.tokenBudgets.l2l3) {
      evictable = combined;
    } else {
      // Truncate: start with L2 only, then try adding L3
      if (l2 && countTokens(l2) <= memoryConfig.tokenBudgets.l2l3) {
        evictable = l2;
        // Try adding L3 if there's room
        if (l3) {
          const withL3 = `${l2}\n\n${l3}`;
          if (countTokens(withL3) <= memoryConfig.tokenBudgets.l2l3) {
            evictable = withL3;
          }
        }
      } else if (l2) {
        // L2 alone exceeds budget -- truncate L2 text
        let truncated = l2;
        while (countTokens(truncated) > memoryConfig.tokenBudgets.l2l3 && truncated.length > 50) {
          // Remove last line
          const lastNewline = truncated.lastIndexOf('\n');
          if (lastNewline <= 0) break;
          truncated = truncated.slice(0, lastNewline);
        }
        evictable = truncated;
      }
    }
  }

  return { pinned, evictable };
}
