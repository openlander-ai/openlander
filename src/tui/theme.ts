/**
 * Centralized color theme constants for the TUI.
 * OpenCode-inspired color palette for a polished terminal experience.
 */
export const theme = {
  // ── Core palette ──────────────────────────────────────────────
  primary: '#fab283', // Orange — assistant accent, active elements
  secondary: '#5c9cf5', // Blue — user accent, interactive elements
  accent: '#c4a7e7', // Purple — highlights, special elements
  text: '#e0e0e0', // Light gray — primary text
  textMuted: '#808080', // Medium gray — de-emphasized text
  textDim: '#555555', // Dim gray — very subtle text

  // ── Backgrounds ───────────────────────────────────────────────
  background: '#0a0a0a', // Near-black root background
  backgroundPanel: '#151515', // Panel/message backgrounds
  backgroundElement: '#252525', // Interactive element hover/keybind bg
  backgroundMenu: '#1a1a1a', // Menu/overlay backgrounds

  // ── Borders ───────────────────────────────────────────────────
  border: '#333333', // Default borders
  borderActive: '#555555', // Active/focused borders
  borderSubtle: '#222222', // Very subtle separators

  // ── Status ────────────────────────────────────────────────────
  success: '#a6e3a1', // Success states, green
  warning: '#f9e2af', // Warnings, yellow
  error: '#f38ba8', // Errors, red/pink
  info: '#5c9cf5', // Informational, blue

  // ── Diff colors ───────────────────────────────────────────────
  diffAdded: '#a6e3a1', // Added lines
  diffRemoved: '#f38ba8', // Removed lines

  // ── Legacy compat (mapped to new names) ───────────────────────
  muted: '#808080', // = textMuted
  user: '#5c9cf5', // = secondary
  agent: undefined, // default fg
  progress: '#f9e2af', // = warning
  url: '#5c9cf5', // = secondary
  toolBorder: '#333333', // = border
  inactive: '#555555', // = textDim
  sectionTitle: '#e0e0e0', // = text
  projectName: undefined,

  // ── Status colors ─────────────────────────────────────────────
  statusRunning: '#a6e3a1',
  statusBuilding: '#f9e2af',
  statusStopped: '#555555',
  statusError: '#f38ba8',

  // ── Resource thresholds ───────────────────────────────────────
  resourceOk: '#a6e3a1',
  resourceWarn: '#f9e2af',
  resourceCrit: '#f38ba8',
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
