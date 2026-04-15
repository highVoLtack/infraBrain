/**
 * Theme system for Ink terminal UI
 *
 * Provides color palette, risk level colors, provider badges,
 * and status icons used across all UI components.
 */

// ---- Color Palette ----

export const theme = {
  headerBg: 'blueBright',
  panelBorder: 'gray',
  panelBorderFocused: 'cyanBright',
  activePhaseBg: 'blueBright',
  dimText: 'gray',
} as const;

// ---- Risk Level Colors ----

const RISK_COLORS: Record<string, string> = {
  read: 'green',
  write: 'yellow',
  destructive: 'red',
  blocked: 'gray',
};

export function riskColor(risk: string): string {
  return RISK_COLORS[risk] ?? 'gray';
}

// ---- Provider Badges ----

const PROVIDER_COLORS: Record<string, string> = {
  Docker: 'blue',
  Postgres: 'cyan',
  Nginx: 'green',
  Redis: 'red',
  MySQL: 'cyan',
  Node: 'greenBright',
};

export function providerBadge(provider: string): { label: string; color: string } {
  return {
    label: provider,
    color: PROVIDER_COLORS[provider] ?? 'white',
  };
}

// ---- Status Icons ----

const STATUS_ICONS: Record<string, string> = {
  active: '\u25CB',   // ○ open circle (spinner placeholder)
  complete: '\u2713', // ✓ checkmark
  error: '\u2717',    // ✗ cross
  pending: '\u00B7',  // · middle dot
};

export function statusIcon(status: string): string {
  return STATUS_ICONS[status] ?? '\u00B7';
}
