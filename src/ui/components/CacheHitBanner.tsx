/**
 * CacheHitBanner - Cache hit callout banner with provenance data
 *
 * Displays confidence score, source incident, provider/resourceType,
 * and an interactive Y/N prompt to accept or reject the cached fix.
 */

import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { providerBadge } from '../theme.js';

export interface CacheHitBannerProps {
  confidence: number;
  similarity: number;
  sourceSessionId: string;
  sourceDate: string;
  skillName: string;
  provider?: string;
  resourceType?: string;
  onResponse: (useCache: boolean) => void;
}

export function CacheHitBanner({
  confidence,
  similarity,
  sourceSessionId,
  sourceDate,
  skillName,
  provider,
  resourceType,
  onResponse,
}: CacheHitBannerProps): React.ReactElement {
  const [responded, setResponded] = useState(false);
  const [accepted, setAccepted] = useState(false);

  useInput((input, key) => {
    if (responded) return;

    if (input === 'y' || input === 'Y' || key.return) {
      setResponded(true);
      setAccepted(true);
      onResponse(true);
    } else if (input === 'n' || input === 'N') {
      setResponded(true);
      setAccepted(false);
      onResponse(false);
    }
  });

  const confidencePercent = `${Math.round(confidence * 100)}%`;
  const truncatedSessionId = sourceSessionId.slice(0, 8);
  const badge = provider ? providerBadge(provider) : null;

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1}>
      <Text bold color="yellow">CACHE HIT</Text>
      <Box gap={1}>
        <Text>Confidence: <Text bold>{confidencePercent}</Text></Text>
        <Text dimColor>Similarity: {Math.round(similarity * 100)}%</Text>
      </Box>
      <Box gap={1}>
        <Text>Source: <Text bold>{truncatedSessionId}</Text></Text>
        <Text dimColor>{sourceDate}</Text>
      </Box>
      <Text>Skill: <Text bold>{skillName}</Text></Text>
      {(provider || resourceType) && (
        <Box gap={1}>
          {badge && <Text color={badge.color}>[{badge.label}]</Text>}
          {resourceType && <Text dimColor>{resourceType}</Text>}
        </Box>
      )}
      {!responded ? (
        <Text>Use cached fix? <Text bold>[Y/n]</Text></Text>
      ) : (
        <Text color={accepted ? 'green' : 'red'}>
          {accepted ? 'Accepted' : 'Rejected'}
        </Text>
      )}
    </Box>
  );
}
