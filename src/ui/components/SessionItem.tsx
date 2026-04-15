/**
 * SessionItem component and formatting logic
 *
 * Renders a single session entry with outcome icon, target name,
 * expert domain badge, and time ago display.
 * Uses text badges [D] [P] [N] for domain since terminal emoji support varies.
 */

import React from 'react';
import { Box, Text } from 'ink';

// ---- Pure logic (testable without React) ----

export interface SessionItemData {
  sessionId: string;
  status: string;
  target?: string;
  skillName?: string;
  expertDomain?: string;
  timestamp: string;
  isActive?: boolean;
}

export interface FormattedSessionItem {
  icon: string;
  shortId: string;
  targetName: string;
  domainBadge: string;
  timeAgo: string;
  isActive: boolean;
}

/** Map status to outcome icon. */
function getStatusIcon(status: string): string {
  switch (status) {
    case 'completed': return '\u2713'; // checkmark
    case 'failed':
    case 'halted':   return '\u2717'; // cross
    case 'active':
    case 'in_progress': return '\u231B'; // hourglass
    default: return '\u00B7'; // middle dot
  }
}

/** Map expert domain to text badge. */
function getDomainBadge(domain?: string): string {
  if (!domain) return '[-]';
  const upper = domain.toLowerCase();
  if (upper.includes('docker')) return '[D]';
  if (upper.includes('postgres')) return '[P]';
  if (upper.includes('nginx')) return '[N]';
  if (upper.includes('redis')) return '[R]';
  if (upper.includes('mysql')) return '[M]';
  if (upper.includes('node')) return '[J]';
  return '[-]';
}

/** Format relative time from ISO timestamp. */
function formatTimeAgo(timestamp: string): string {
  const diff = Date.now() - new Date(timestamp).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * Pure function: format session data for display.
 * Exported for unit testing without React context.
 */
export function formatSessionItem(data: SessionItemData): FormattedSessionItem {
  return {
    icon: getStatusIcon(data.status),
    shortId: data.sessionId.substring(0, 8),
    targetName: data.target || data.skillName || 'unknown',
    domainBadge: getDomainBadge(data.expertDomain),
    timeAgo: formatTimeAgo(data.timestamp),
    isActive: data.isActive ?? false,
  };
}

// ---- React Component ----

export interface SessionItemProps extends SessionItemData {
  selected?: boolean;
  onSelect?: () => void;
}

export function SessionItem(props: SessionItemProps): React.ReactElement {
  const formatted = formatSessionItem(props);

  return (
    <Box>
      <Text color={props.status === 'failed' ? 'red' : props.status === 'completed' ? 'green' : 'yellow'}>
        {formatted.icon}
      </Text>
      <Text> </Text>
      <Text bold={formatted.isActive} dimColor={!formatted.isActive && !props.selected}>
        {formatted.targetName}
      </Text>
      <Text> </Text>
      <Text color="gray">{formatted.domainBadge}</Text>
      <Text> </Text>
      <Text color="gray">{formatted.timeAgo}</Text>
    </Box>
  );
}
