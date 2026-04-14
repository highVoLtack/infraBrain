/**
 * Entity extraction for MemPalace knowledge graph population.
 * Extends ground-truth extraction patterns with service and hostname detection.
 * Used for both search query enrichment and knowledge graph entity creation.
 */

import type { EntityRecord } from './types.js';

// ---------------------------------------------------------------------------
// Extraction regexes (reuse ground-truth patterns + extensions)
// ---------------------------------------------------------------------------

const PORT_RE = /(?::\s*|port\s+)(\d{2,5})\b/gi;
const IP_RE = /\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/g;
const ERROR_CODE_RE = /\b(OOM|ECONNREFUSED|EPERM|ENOENT|EACCES|SIGKILL|SIGTERM|exit\s+code\s+\d+)\b/gi;
const EXCLUDED_IPS = new Set(['0.0.0.0', '127.0.0.1']);

// Container name: alphanumeric + hyphens/underscores, at least one hyphen or underscore (distinguishes from plain words)
const CONTAINER_RE = /\b([a-z][a-z0-9]*(?:[-_][a-z0-9]+)+)\b/gi;

// Known infrastructure service names with word boundary anchors
const SERVICE_NAMES = [
  'redis', 'nginx', 'postgres', 'postgresql', 'mysql', 'mariadb',
  'apache', 'elasticsearch', 'mongodb', 'rabbitmq', 'kafka',
  'haproxy', 'memcached', 'consul', 'etcd', 'vault', 'grafana',
  'prometheus', 'zookeeper', 'cassandra', 'minio',
];
const SERVICE_RE = new RegExp(`\\b(${SERVICE_NAMES.join('|')})\\b`, 'gi');

// Hostname detection: word.tld patterns for internal infrastructure
const HOSTNAME_RE = /\b([a-z][a-z0-9-]+\.(?:internal|local|lan|corp|cluster))\b/gi;

// Words that look like container names but are actually common identifiers/services
const CONTAINER_EXCLUDE = new Set([
  // Exclude known service names -- they get classified as services, not containers
  ...SERVICE_NAMES,
  // Common hyphenated words that are not containers
  'read-only', 'non-zero', 'built-in', 'run-time', 'shut-down',
  'start-up', 'set-up', 'time-out', 'log-in', 'log-out',
  'back-end', 'front-end', 'real-time', 'end-to-end',
]);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ExtractedEntity {
  type: EntityRecord['entity_type'];
  value: string;
}

/**
 * Extract infrastructure entities from diagnostic/discovery text.
 * Returns deduplicated entities suitable for search enrichment.
 */
export function extractEntitiesFromText(text: string): ExtractedEntity[] {
  const seen = new Set<string>();
  const entities: ExtractedEntity[] = [];

  function addEntity(type: EntityRecord['entity_type'], value: string): void {
    const key = `${type}:${value.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    entities.push({ type, value });
  }

  // Services (check before containers to avoid double-counting)
  SERVICE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SERVICE_RE.exec(text)) !== null) {
    addEntity('service', match[1].toLowerCase());
  }

  // Hostnames
  HOSTNAME_RE.lastIndex = 0;
  while ((match = HOSTNAME_RE.exec(text)) !== null) {
    addEntity('hostname', match[1].toLowerCase());
  }

  // Containers (alphanumeric-hyphen patterns, exclude known services and common words)
  CONTAINER_RE.lastIndex = 0;
  while ((match = CONTAINER_RE.exec(text)) !== null) {
    const name = match[1];
    if (!CONTAINER_EXCLUDE.has(name.toLowerCase())) {
      addEntity('container', name);
    }
  }

  // IPs
  IP_RE.lastIndex = 0;
  while ((match = IP_RE.exec(text)) !== null) {
    if (!EXCLUDED_IPS.has(match[1])) {
      addEntity('ip', match[1]);
    }
  }

  // Ports
  PORT_RE.lastIndex = 0;
  while ((match = PORT_RE.exec(text)) !== null) {
    addEntity('port', match[1]);
  }

  // Error codes
  ERROR_CODE_RE.lastIndex = 0;
  while ((match = ERROR_CODE_RE.exec(text)) !== null) {
    addEntity('error_code', match[1].toUpperCase());
  }

  return entities;
}

/**
 * Create full EntityRecord objects for knowledge graph storage.
 * Extracts entities from combined discovery + diagnosis text,
 * creates records with incident relationship, and deduplicates.
 */
export function extractEntitiesForGraph(
  discoveryRaw: Record<string, string>,
  diagnosis: string,
  incidentId: string,
): Omit<EntityRecord, 'id'>[] {
  // Combine all text sources
  const discoveryText = Object.values(discoveryRaw).join('\n');
  const combinedText = `${discoveryText}\n${diagnosis}`;

  const rawEntities = extractEntitiesFromText(combinedText);
  const now = new Date().toISOString();

  // Deduplicate by type+value (extractEntitiesFromText already deduplicates,
  // but this ensures graph-level uniqueness)
  const seen = new Set<string>();
  const records: Omit<EntityRecord, 'id'>[] = [];

  for (const entity of rawEntities) {
    const key = `${entity.type}:${entity.value.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);

    records.push({
      entity_type: entity.type,
      entity_value: entity.value,
      wing: 'wing_incidents',
      related_incident_id: incidentId,
      related_entity_id: '',
      relationship_type: 'involved_in',
      valid_from: now,
      valid_to: '',
      expert_domain: '',
      created_at: now,
    });
  }

  return records;
}
