/**
 * Responsive breakpoint hook wrapping Ink's useWindowSize
 *
 * Returns layout mode based on terminal width:
 * - full: >= 120 columns (3-panel layout)
 * - compact: 80-119 columns (2-panel layout)
 * - minimal: < 80 columns (single panel)
 */

import { useWindowSize } from 'ink';
import type { LayoutMode } from '../types.js';

export interface ResponsiveState {
  mode: LayoutMode;
  columns: number;
  rows: number;
}

/**
 * Pure breakpoint logic -- exported for testability without React context.
 */
export function getLayoutMode(columns: number): LayoutMode {
  if (columns >= 120) return 'full';
  if (columns >= 80) return 'compact';
  return 'minimal';
}

export function useResponsive(): ResponsiveState {
  const { columns, rows } = useWindowSize();
  const mode = getLayoutMode(columns);
  return { mode, columns, rows };
}
