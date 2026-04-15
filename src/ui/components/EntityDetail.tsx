/**
 * EntityDetail component: detail pane for selected entity
 *
 * Shows entity type, provider badge, resourceType, timestamps,
 * session count, and related incident IDs.
 * Per user decision: all entity displays include provider and resourceType.
 */

import React from 'react';
import { Box, Text } from 'ink';
import { providerBadge } from '../theme.js';

// ---- Pure logic (testable without React) ----

export interface EntityDetailData {
  entity_type: string;
  entity_value: string;
  provider?: string;
  resourceType?: string;
  valid_from?: string;
  valid_to?: string;
  session_count?: number;
  incident_ids?: string[];
}

export interface FormattedEntityDetail {
  type: string;
  value: string;
  provider: string;
  providerColor: string;
  resourceType: string;
  firstSeen: string;
  lastSeen: string;
  sessionCount: number;
  incidentIds: string[];
}

/** Format ISO date for display. */
function formatDate(iso?: string): string {
  if (!iso) return 'N/A';
  try {
    const d = new Date(iso);
    return d.toISOString().split('T')[0]!;
  } catch {
    return 'N/A';
  }
}

/**
 * Pure function: format entity data for display.
 * Exported for unit testing without React context.
 */
export function formatEntityDetail(data: EntityDetailData): FormattedEntityDetail {
  const badge = providerBadge(data.provider || '');

  return {
    type: data.entity_type,
    value: data.entity_value,
    provider: data.provider || 'N/A',
    providerColor: badge.color,
    resourceType: data.resourceType || 'N/A',
    firstSeen: formatDate(data.valid_from),
    lastSeen: (!data.valid_to || data.valid_to === '') ? 'Active' : formatDate(data.valid_to),
    sessionCount: data.session_count ?? 0,
    incidentIds: (data.incident_ids ?? []).map(id => id.substring(0, 12)),
  };
}

// ---- React Component ----

export interface EntityDetailProps {
  entity: EntityDetailData | null;
}

export function EntityDetail({ entity }: EntityDetailProps): React.ReactElement {
  if (!entity) {
    return (
      <Box paddingX={1}>
        <Text color="gray">Select an entity to view details</Text>
      </Box>
    );
  }

  const detail = formatEntityDetail(entity);

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold color="white">{detail.value}</Text>
      <Box>
        <Text color="gray">Type: </Text>
        <Text>{detail.type}</Text>
      </Box>
      <Box>
        <Text color="gray">Provider: </Text>
        <Text color={detail.providerColor}>{detail.provider}</Text>
      </Box>
      <Box>
        <Text color="gray">Resource: </Text>
        <Text>{detail.resourceType}</Text>
      </Box>
      <Box>
        <Text color="gray">First seen: </Text>
        <Text>{detail.firstSeen}</Text>
      </Box>
      <Box>
        <Text color="gray">Last seen: </Text>
        <Text>{detail.lastSeen}</Text>
      </Box>
      <Box>
        <Text color="gray">Sessions: </Text>
        <Text>{detail.sessionCount}</Text>
      </Box>
      {detail.incidentIds.length > 0 && (
        <Box flexDirection="column">
          <Text color="gray">Incidents:</Text>
          {detail.incidentIds.map((id, i) => (
            <Text key={i} color="gray"> - {id}</Text>
          ))}
        </Box>
      )}
    </Box>
  );
}
