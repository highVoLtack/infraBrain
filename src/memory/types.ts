/**
 * MemPalace semantic memory type definitions.
 * Defines data contracts for incident storage, entity knowledge graph,
 * write-ahead log, and memory configuration.
 *
 * All downstream memory modules import from this file.
 */

// Wing discriminator union (MEM-08)
export const WINGS = ['wing_incidents', 'wing_config', 'wing_runbooks', 'wing_user'] as const;
export type Wing = typeof WINGS[number];

// Incident record stored in LanceDB (MEM-01)
export interface IncidentRecord {
  id: string;
  session_id: string;
  wing: Wing;
  prompt: string;
  diagnosis: string;
  root_cause: string;
  fix_summary: string;
  outcome: 'completed' | 'halted' | 'failed';
  skill_name: string;
  created_at: string; // ISO 8601
  containers: string; // JSON array
  services: string;   // JSON array
  error_codes: string; // JSON array
  expert_domain: string; // v2.0 LoRA readiness (nullable via empty string)
}

// Entity record for knowledge graph (MEM-03)
export interface EntityRecord {
  id: string;
  entity_type: 'container' | 'port' | 'ip' | 'error_code' | 'service' | 'hostname';
  entity_value: string;
  wing: Wing;
  related_incident_id: string;
  related_entity_id: string; // entity-to-entity relationship
  relationship_type: 'involved_in' | 'runs_on' | 'connects_to' | 'has_port';
  valid_from: string; // ISO 8601
  valid_to: string;   // empty = still valid
  expert_domain: string; // v2.0 LoRA readiness
  created_at: string;
}

// WAL entry types (MEM-09)
export type WALMutationType = 'incident_add' | 'entity_add' | 'entity_update' | 'incident_update';

export interface WALEntry {
  type: WALMutationType;
  timestamp: string;
  sessionId: string;
  details: Record<string, unknown>;
}

// Memory config shape (mirrors zod schema in src/config/types.ts)
export interface MemoryConfig {
  enabled: boolean;
  dataDir: string;
  decayLambda: number;
  l2SimilarityThreshold: number;
  l2Limit: number;
  tokenBudgets: {
    l0: number;
    l1: number;
    l2l3: number;
  };
}

// Memory search result with computed score
export interface MemorySearchResult {
  incident: IncidentRecord;
  similarity: number;
  recencyScore: number;
  score: number; // weighted combination
}

// Entity search result
export interface EntitySearchResult {
  entity: EntityRecord;
  relatedIncidentIds: string[];
}
