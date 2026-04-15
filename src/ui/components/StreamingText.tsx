/**
 * StreamingText - Token-by-token text rendering with windowed display
 *
 * Renders accumulated token text and auto-scrolls by showing only
 * the last N lines (windowed) to prevent terminal overflow.
 */

import React from 'react';
import { Box, Text } from 'ink';

export interface StreamingTextProps {
  /** Accumulated text to display */
  text: string;
  /** Maximum number of lines to display (default: 20) */
  maxLines?: number;
}

export function StreamingText({ text, maxLines = 20 }: StreamingTextProps): React.ReactElement | null {
  if (!text) {
    return null;
  }

  const lines = text.split('\n');
  const visibleLines = lines.length > maxLines ? lines.slice(-maxLines) : lines;

  return (
    <Box flexDirection="column">
      {visibleLines.map((line, i) => (
        <Text key={i}>{line}</Text>
      ))}
    </Box>
  );
}
