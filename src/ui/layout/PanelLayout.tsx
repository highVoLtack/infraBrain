/**
 * Responsive 3/2/1 panel layout container
 *
 * Renders panels based on terminal width breakpoints:
 * - full (>=120 cols): 3 panels — left 20%, center 55%, right 25%
 * - compact (80-119 cols): 2 panels — left 25%, center 75%
 * - minimal (<80 cols): 1 panel — center 100%
 *
 * Active panel has focused border color, others have dim border.
 */

import React from 'react';
import { Box, type BoxProps } from 'ink';
import { useResponsive } from '../hooks/useResponsive.js';
import { theme } from '../theme.js';
import type { LayoutMode, PanelId } from '../types.js';

// ---- Pure logic (testable without React) ----

export interface PanelConfig {
  panels: Array<{
    id: PanelId;
    flexBasis: string;
    focused: boolean;
  }>;
}

/**
 * Pure function: determine panel configuration based on layout mode and focus.
 * Exported for unit testing without React context.
 */
export function getPanelConfig(
  mode: LayoutMode,
  activePanel: PanelId = 'left',
): PanelConfig {
  switch (mode) {
    case 'full':
      return {
        panels: [
          { id: 'left', flexBasis: '20%', focused: activePanel === 'left' },
          { id: 'center', flexBasis: '55%', focused: activePanel === 'center' },
          { id: 'right', flexBasis: '25%', focused: activePanel === 'right' },
        ],
      };
    case 'compact':
      return {
        panels: [
          { id: 'left', flexBasis: '25%', focused: activePanel === 'left' },
          { id: 'center', flexBasis: '75%', focused: activePanel === 'center' },
        ],
      };
    case 'minimal':
      return {
        panels: [
          { id: 'center', flexBasis: '100%', focused: activePanel === 'center' },
        ],
      };
  }
}

// ---- React Component ----

export interface PanelLayoutProps {
  apiBaseUrl: string;
  activePanel: PanelId;
  centerContent: React.ReactNode;
  leftContent?: React.ReactNode;
  rightContent?: React.ReactNode;
  showEntityOverlay?: boolean;
  entityOverlayContent?: React.ReactNode;
}

/**
 * PanelLayout component: responsive 3/2/1 panel layout.
 * Uses useResponsive() for breakpoint detection.
 * Focused panel has bright border, others have dim border.
 */
export function PanelLayout({
  activePanel,
  centerContent,
  leftContent,
  rightContent,
  showEntityOverlay,
  entityOverlayContent,
}: PanelLayoutProps): React.ReactElement {
  const { mode } = useResponsive();
  const config = getPanelConfig(mode, activePanel);

  const contentMap: Record<PanelId, React.ReactNode> = {
    left: leftContent ?? null,
    center: centerContent,
    right: rightContent ?? null,
  };

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box flexDirection="row" flexGrow={1}>
        {config.panels.map((panel) => (
          <Box
            key={panel.id}
            flexBasis={panel.flexBasis}
            flexShrink={0}
            borderStyle="single"
            borderColor={panel.focused ? theme.panelBorderFocused : theme.panelBorder}
            flexDirection="column"
          >
            {contentMap[panel.id]}
          </Box>
        ))}
      </Box>
      {/* Entity overlay for compact mode (triggered by 'g' key) */}
      {mode === 'compact' && showEntityOverlay && entityOverlayContent && (
        <Box borderStyle="single" borderColor={theme.panelBorderFocused}>
          {entityOverlayContent}
        </Box>
      )}
    </Box>
  );
}
