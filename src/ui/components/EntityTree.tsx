/**
 * EntityTree component: compact tree grouped by provider
 *
 * Shows entities grouped by provider with live/memory indicators.
 * Filled circle for live entities (current session), empty circle for memory.
 * Color intensity by recency: bold for live, dim for old.
 */

import React from 'react';
import { Box, Text } from 'ink';
import { providerBadge } from '../theme.js';

// ---- Pure logic (testable without React) ----

export interface EntityItem {
  id: string;
  entity_type: string;
  entity_value: string;
  provider?: string;
  isLive: boolean;
}

export interface EntityGroup {
  provider: string;
  providerColor: string;
  entities: EntityItem[];
}

/**
 * Pure function: group entities by provider.
 * Exported for unit testing without React context.
 */
export function groupEntitiesByProvider(entities: EntityItem[]): EntityGroup[] {
  const groupMap = new Map<string, EntityItem[]>();

  for (const entity of entities) {
    const provider = entity.provider || 'Unknown';
    if (!groupMap.has(provider)) {
      groupMap.set(provider, []);
    }
    groupMap.get(provider)!.push(entity);
  }

  return Array.from(groupMap.entries()).map(([provider, items]) => ({
    provider,
    providerColor: providerBadge(provider).color,
    entities: items,
  }));
}

// ---- React Component ----

export interface EntityTreeProps {
  entities: EntityItem[];
  selectedId?: string;
  onSelect: (id: string) => void;
}

export function EntityTree({ entities, selectedId, onSelect }: EntityTreeProps): React.ReactElement {
  const groups = groupEntitiesByProvider(entities);

  return (
    <Box flexDirection="column">
      {groups.map((group) => (
        <Box flexDirection="column" key={group.provider}>
          <Text bold color={group.providerColor}>{group.provider}</Text>
          {group.entities.map((entity) => {
            const isSelected = entity.id === selectedId;
            // Filled circle for live, empty circle for memory
            const indicator = entity.isLive ? '\u25CF' : '\u25CB';
            const indicatorColor = entity.isLive ? 'green' : 'gray';

            return (
              <Box key={entity.id}>
                <Text>{isSelected ? '\u25B6 ' : '  '}</Text>
                <Text color={indicatorColor}>{indicator}</Text>
                <Text> </Text>
                <Text bold={entity.isLive} dimColor={!entity.isLive} inverse={isSelected}>
                  {entity.entity_value}
                </Text>
              </Box>
            );
          })}
        </Box>
      ))}
      {groups.length === 0 && (
        <Text color="gray">No entities</Text>
      )}
    </Box>
  );
}
