/**
 * Left panel: Session history with date-grouped tree
 *
 * Groups sessions by date: Today, Yesterday, This Week, Older.
 * Active session pinned at top. Arrow keys for navigation,
 * '/' for fuzzy search, Enter to select session for replay.
 * Windows visible sessions to max ~20 for performance.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import { SessionItem, type SessionItemData } from '../components/SessionItem.js';
import { theme } from '../theme.js';

// ---- Pure logic (testable without React) ----

export interface SessionEntry {
  id: string;
  status: string;
  target: string;
  updatedAt: string;
  eventCount: number;
}

export interface DateGroupedSessions {
  today: SessionEntry[];
  yesterday: SessionEntry[];
  thisWeek: SessionEntry[];
  older: SessionEntry[];
}

/**
 * Pure function: group sessions by date category.
 * Exported for unit testing without React context.
 */
export function groupSessionsByDate(sessions: SessionEntry[]): DateGroupedSessions {
  const now = Date.now();
  const ONE_DAY = 24 * 3600 * 1000;

  const result: DateGroupedSessions = {
    today: [],
    yesterday: [],
    thisWeek: [],
    older: [],
  };

  for (const session of sessions) {
    const age = now - new Date(session.updatedAt).getTime();
    if (age < ONE_DAY) {
      result.today.push(session);
    } else if (age < 2 * ONE_DAY) {
      result.yesterday.push(session);
    } else if (age < 7 * ONE_DAY) {
      result.thisWeek.push(session);
    } else {
      result.older.push(session);
    }
  }

  return result;
}

/** Simple fuzzy match: all characters of query appear in order in target. */
function fuzzyMatch(query: string, target: string): boolean {
  const lower = target.toLowerCase();
  const q = query.toLowerCase();
  let qi = 0;
  for (let i = 0; i < lower.length && qi < q.length; i++) {
    if (lower[i] === q[qi]) qi++;
  }
  return qi === q.length;
}

// ---- React Component ----

export interface SessionPanelProps {
  apiBaseUrl: string;
  onSelect: (sessionId: string) => void;
  activeFocus?: boolean;
}

const MAX_VISIBLE = 20;

export function SessionPanel({ apiBaseUrl, onSelect, activeFocus }: SessionPanelProps): React.ReactElement {
  const [sessions, setSessions] = useState<SessionEntry[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [searchMode, setSearchMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Fetch sessions on mount
  useEffect(() => {
    let cancelled = false;

    async function fetchSessions() {
      try {
        const res = await fetch(`${apiBaseUrl}/history?list=true&limit=50`);
        const data = await res.json() as { sessions: SessionEntry[] };
        if (!cancelled) {
          setSessions(data.sessions || []);
        }
      } catch {
        // Graceful degradation
      }
    }

    fetchSessions();
    return () => { cancelled = true; };
  }, [apiBaseUrl]);

  // Filter sessions by search query
  const filteredSessions = useMemo(() => {
    if (!searchQuery) return sessions;
    return sessions.filter(s => fuzzyMatch(searchQuery, s.target || s.id));
  }, [sessions, searchQuery]);

  const grouped = useMemo(() => groupSessionsByDate(filteredSessions), [filteredSessions]);

  // Flatten for navigation
  const flatList = useMemo(() => {
    return [
      ...grouped.today,
      ...grouped.yesterday,
      ...grouped.thisWeek,
      ...grouped.older,
    ];
  }, [grouped]);

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
      setSelectedIndex(i => Math.max(0, i - 1));
    } else if (key.downArrow || input === 'j') {
      setSelectedIndex(i => Math.min(flatList.length - 1, i + 1));
    } else if (key.return && flatList[selectedIndex]) {
      onSelect(flatList[selectedIndex]!.id);
    }
  });

  // Windowing: only render visible sessions around selection
  const windowStart = Math.max(0, selectedIndex - Math.floor(MAX_VISIBLE / 2));
  const windowEnd = Math.min(flatList.length, windowStart + MAX_VISIBLE);

  function renderGroup(label: string, items: SessionEntry[], globalOffset: number) {
    if (items.length === 0) return null;
    return (
      <Box flexDirection="column" key={label}>
        <Text bold color="white">{label}</Text>
        {items.map((session, localIdx) => {
          const globalIdx = globalOffset + localIdx;
          if (globalIdx < windowStart || globalIdx >= windowEnd) return null;
          const data: SessionItemData = {
            sessionId: session.id,
            status: session.status,
            target: session.target,
            timestamp: session.updatedAt,
            isActive: session.status === 'active' || session.status === 'in_progress',
          };
          return (
            <Box key={session.id}>
              <Text>{globalIdx === selectedIndex ? '\u25B6 ' : '  '}</Text>
              <SessionItem {...data} selected={globalIdx === selectedIndex} />
            </Box>
          );
        })}
      </Box>
    );
  }

  let offset = 0;
  const todayOffset = offset; offset += grouped.today.length;
  const yesterdayOffset = offset; offset += grouped.yesterday.length;
  const thisWeekOffset = offset; offset += grouped.thisWeek.length;
  const olderOffset = offset;

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold color="cyanBright">Sessions</Text>
      {searchMode && (
        <Box>
          <Text color="yellow">/ </Text>
          <Text>{searchQuery}</Text>
          <Text color="gray">_</Text>
        </Box>
      )}
      {renderGroup('Today', grouped.today, todayOffset)}
      {renderGroup('Yesterday', grouped.yesterday, yesterdayOffset)}
      {renderGroup('This Week', grouped.thisWeek, thisWeekOffset)}
      {renderGroup('Older', grouped.older, olderOffset)}
      {flatList.length === 0 && (
        <Text color="gray">No sessions</Text>
      )}
    </Box>
  );
}
