/**
 * ApprovalDestructive - Typed-target confirmation component
 *
 * Handles DESTRUCTIVE tier approval: requires typing the exact target
 * name to confirm execution. Uses useInput for character-by-character
 * input capture. Shows error on mismatch, allows retry.
 */

import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

export interface ApprovalDestructiveProps {
  command: string;
  target: string;
  onResponse: (approved: boolean) => void;
}

export function ApprovalDestructive({ command, target, onResponse }: ApprovalDestructiveProps): React.ReactElement {
  const [confirmed, setConfirmed] = useState(false);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState('');

  useInput((input, key) => {
    if (confirmed) return;

    if (key.return) {
      if (typed === target) {
        setConfirmed(true);
        setError('');
        onResponse(true);
      } else {
        setError(`Target mismatch: expected "${target}"`);
        setTyped('');
      }
    } else if (key.backspace || key.delete) {
      setTyped(prev => prev.slice(0, -1));
      setError('');
    } else if (input && !key.ctrl && !key.meta) {
      setTyped(prev => prev + input);
      setError('');
    }
  });

  return (
    <Box flexDirection="column">
      <Box gap={1}>
        <Text color="red" bold>DESTRUCTIVE</Text>
        <Text>&quot;{command}&quot;</Text>
      </Box>
      {!confirmed ? (
        <Box flexDirection="column">
          <Text>Type &quot;{target}&quot; to confirm:</Text>
          <Text>{typed}<Text dimColor>_</Text></Text>
          {error && <Text color="red">{error}</Text>}
        </Box>
      ) : (
        <Text color="green">Confirmed</Text>
      )}
    </Box>
  );
}
