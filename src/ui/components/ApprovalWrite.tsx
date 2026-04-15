/**
 * ApprovalWrite - Y/N approval component using Ink useInput
 *
 * Handles WRITE tier approval: displays command with risk coloring
 * and captures Y/N keyboard input for approval/rejection.
 */

import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

export interface ApprovalWriteProps {
  command: string;
  riskLevel: string;
  onResponse: (approved: boolean) => void;
}

export function ApprovalWrite({ command, riskLevel, onResponse }: ApprovalWriteProps): React.ReactElement {
  const [responded, setResponded] = useState(false);
  const [approved, setApproved] = useState(false);

  useInput((input, key) => {
    if (responded) return;

    if (input === 'y' || input === 'Y' || key.return) {
      setResponded(true);
      setApproved(true);
      onResponse(true);
    } else if (input === 'n' || input === 'N') {
      setResponded(true);
      setApproved(false);
      onResponse(false);
    }
  });

  return (
    <Box flexDirection="column">
      <Box gap={1}>
        <Text color="yellow" bold>WRITE</Text>
        <Text>Execute &quot;{command}&quot;?</Text>
        {!responded && <Text bold>[Y/n]</Text>}
      </Box>
      {responded && (
        <Text color={approved ? 'green' : 'red'}>
          {approved ? 'Approved' : 'Rejected'}
        </Text>
      )}
    </Box>
  );
}
