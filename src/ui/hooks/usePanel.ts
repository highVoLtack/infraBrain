/**
 * Panel focus management with Tab cycling
 *
 * Manages which panel (left, center, right) is currently focused.
 * cyclePanel cycles: left -> center -> right -> left
 *
 * Exported as a factory function for both direct use and React integration.
 * In React components, wrap with useState for reactivity.
 */

import type { PanelId } from '../types.js';

const PANEL_ORDER: PanelId[] = ['left', 'center', 'right'];

export interface PanelState {
  activePanel: PanelId;
  cyclePanel: () => void;
  setPanel: (id: PanelId) => void;
}

export function usePanel(): PanelState {
  const state: PanelState = {
    activePanel: 'left',
    cyclePanel() {
      const currentIndex = PANEL_ORDER.indexOf(state.activePanel);
      state.activePanel = PANEL_ORDER[(currentIndex + 1) % PANEL_ORDER.length]!;
    },
    setPanel(id: PanelId) {
      state.activePanel = id;
    },
  };

  return state;
}
