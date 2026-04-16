/**
 * Right panel: Entity knowledge graph with detail pane
 *
 * Top half shows compact tree grouped by provider.
 * Bottom half shows detail pane for selected entity.
 * Arrow keys navigate entity list, Enter selects detail view.
 * '/' for entity search. Live entities appear with "NEW" marker.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import { EntityTree, type EntityItem } from '../components/EntityTree.js';
import { EntityDetail, type EntityDetailData } from '../components/EntityDetail.js';
import { groupEntitiesByProvider } from '../components/EntityTree.js';

export interface EntityPanelProps {
  apiBaseUrl: string;
  onSelect?: (entityId: string) => void;
  liveEntities?: EntityItem[];
  activeFocus?: boolean;
  /** Increment to trigger entity re-fetch (e.g. after session completes) */
  refreshKey?: number;
}

/** Simple fuzzy match. */
function fuzzyMatch(query: string, target: string): boolean {
  const lower = target.toLowerCase();
  const q = query.toLowerCase();
  let qi = 0;
  for (let i = 0; i < lower.length && qi < q.length; i++) {
    if (lower[i] === q[qi]) qi++;
  }
  return qi === q.length;
}

export function EntityPanel({ apiBaseUrl, onSelect, liveEntities, activeFocus, refreshKey }: EntityPanelProps): React.ReactElement {
  const [apiEntities, setApiEntities] = useState<EntityItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [searchMode, setSearchMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Fetch entities from API
  useEffect(() => {
    let cancelled = false;

    async function fetchEntities() {
      try {
        const res = await fetch(`${apiBaseUrl}/entities`);
        const data = await res.json() as Array<Record<string, unknown>>;
        if (!cancelled) {
          const mapped: EntityItem[] = data.map((e) => ({
            id: (e.id as string) || '',
            entity_type: (e.entity_type as string) || '',
            entity_value: (e.entity_value as string) || '',
            provider: (e.expert_domain as string) || (e.provider as string) || undefined,
            isLive: false, // API entities are memory entities
          }));
          setApiEntities(mapped);
        }
      } catch {
        // Graceful degradation
      }
    }

    fetchEntities();
    return () => { cancelled = true; };
  }, [apiBaseUrl, refreshKey]);

  // Merge API entities with live entities (avoiding duplicates)
  const allEntities = useMemo(() => {
    const merged = [...(liveEntities || [])];
    const liveValues = new Set(merged.map(e => e.entity_value));
    for (const e of apiEntities) {
      if (!liveValues.has(e.entity_value)) {
        merged.push(e);
      }
    }
    return merged;
  }, [apiEntities, liveEntities]);

  // Filter by search
  const filteredEntities = useMemo(() => {
    if (!searchQuery) return allEntities;
    return allEntities.filter(e =>
      fuzzyMatch(searchQuery, e.entity_value) || fuzzyMatch(searchQuery, e.entity_type),
    );
  }, [allEntities, searchQuery]);

  // Flat list for navigation
  const flatList = useMemo(() => {
    const groups = groupEntitiesByProvider(filteredEntities);
    return groups.flatMap(g => g.entities);
  }, [filteredEntities]);

  const selectedIndex = flatList.findIndex(e => e.id === selectedId);

  // Get selected entity detail data
  const selectedEntity: EntityDetailData | null = useMemo(() => {
    if (!selectedId || !showDetail) return null;
    const entity = allEntities.find(e => e.id === selectedId);
    if (!entity) return null;
    return {
      entity_type: entity.entity_type,
      entity_value: entity.entity_value,
      provider: entity.provider,
    };
  }, [selectedId, showDetail, allEntities]);

  // Handle keyboard input when panel is focused
  useInput((input, key) => {
    if (!activeFocus) return;

    if (searchMode) {
      if (key.escape) {
        setSearchMode(false);
        setSearchQuery('');
      } else if (key.backspace || key.delete) {
        setSearchQuery(q => q.slice(0, -1));
      } else if (key.return) {
        setSearchMode(false);
      } else if (input && !key.ctrl && !key.meta) {
        setSearchQuery(q => q + input);
      }
      return;
    }

    if (input === '/') {
      setSearchMode(true);
      setSearchQuery('');
      return;
    }

    if (key.upArrow || input === 'k') {
      const newIdx = Math.max(0, selectedIndex - 1);
      if (flatList[newIdx]) setSelectedId(flatList[newIdx]!.id);
    } else if (key.downArrow || input === 'j') {
      const newIdx = Math.min(flatList.length - 1, selectedIndex + 1);
      if (flatList[newIdx]) setSelectedId(flatList[newIdx]!.id);
    } else if (key.return && selectedId) {
      setShowDetail(true);
      onSelect?.(selectedId);
    } else if (key.escape) {
      setShowDetail(false);
    }
  });

  return (
    <Box flexDirection="column" paddingX={1} flexGrow={1}>
      <Text bold color="cyanBright">Entities</Text>
      {searchMode && (
        <Box>
          <Text color="yellow">/ </Text>
          <Text>{searchQuery}</Text>
          <Text color="gray">_</Text>
        </Box>
      )}
      {/* Top half: entity tree */}
      <Box flexDirection="column" flexGrow={1}>
        <EntityTree
          entities={filteredEntities}
          selectedId={selectedId ?? undefined}
          onSelect={(id) => {
            setSelectedId(id);
            setShowDetail(true);
            onSelect?.(id);
          }}
        />
      </Box>
      {/* Bottom half: detail pane */}
      {showDetail && (
        <Box flexDirection="column" borderStyle="single" borderColor="gray">
          <EntityDetail entity={selectedEntity} />
        </Box>
      )}
    </Box>
  );
}
