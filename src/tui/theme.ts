/**
 * Centralized color theme constants for the TUI.
 * Matches OpenCode's default dark theme (opencode.json) for visual consistency.
 * Reference: https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/cli/cmd/tui/context/theme/opencode.json
 */
export const theme = {
  // ── Core palette (OpenCode dark mode) ──────────────────────────
  primary: '#fab283', // Orange — assistant accent, active elements
  secondary: '#5c9cf5', // Blue — user accent, interactive elements
  accent: '#9d7cd8', // Purple — highlights, special elements
  text: '#eeeeee', // Near-white — primary text
  textMuted: '#808080', // Medium gray — de-emphasized text
  textDim: '#555555', // Dim gray — very subtle text (OpenLander-specific)

  // ── Backgrounds ───────────────────────────────────────────────
  background: '#0a0a0a', // Near-black root background
  backgroundPanel: '#141414', // Panel/message backgrounds
  backgroundElement: '#1e1e1e', // Interactive element hover/keybind bg
  backgroundMenu: '#1e1e1e', // Menu/overlay backgrounds

  // ── Borders (OpenCode uses lighter borders for visibility) ────
  border: '#484848', // Default borders
  borderActive: '#606060', // Active/focused borders
  borderSubtle: '#3c3c3c', // Very subtle separators

  // ── Status (OpenCode uses more vivid, saturated colors) ───────
  success: '#7fd88f', // Success states, green
  warning: '#f5a742', // Warnings, orange
  error: '#e06c75', // Errors, muted red
  info: '#56b6c2', // Informational, cyan

  // ── Diff colors ───────────────────────────────────────────────
  diffAdded: '#4fd6be', // Added lines (teal)
  diffRemoved: '#c53b53', // Removed lines (red)

  // ── Legacy compat (mapped to new names) ───────────────────────
  muted: '#808080', // = textMuted
  user: '#5c9cf5', // = secondary
  agent: undefined, // default fg
  progress: '#f5a742', // = warning
  url: '#5c9cf5', // = secondary
  toolBorder: '#484848', // = border
  inactive: '#555555', // = textDim
  sectionTitle: '#eeeeee', // = text
  projectName: undefined,

  // ── Status colors ─────────────────────────────────────────────
  statusRunning: '#7fd88f',
  statusBuilding: '#f5a742',
  statusStopped: '#555555',
  statusError: '#e06c75',

  // ── Resource thresholds ───────────────────────────────────────
  resourceOk: '#7fd88f',
  resourceWarn: '#f5a742',
  resourceCrit: '#e06c75',
} as const;

/** Pipe-style left border chars (OpenCode SplitBorder pattern) */
export const SplitBorder = {
  border: ['left' as const],
  customBorderChars: {
    topLeft: '',
    bottomLeft: '',
    vertical: '┃',
    topRight: '',
    bottomRight: '',
    horizontal: ' ',
    bottomT: '',
    topT: '',
    cross: '',
    leftT: '',
    rightT: '',
  },
};

export type ThemeColor = (typeof theme)[keyof typeof theme];
