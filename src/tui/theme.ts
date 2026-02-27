/**
 * Centralized color theme constants for the OpenLander TUI.
 * Signal Green brand identity — cyber-terminal aesthetic.
 */
export const theme = {
  // ── Core palette ──────────────────────────────────────────────
  primary: '#36f0a0', // Signal green — brand accent, active elements
  secondary: '#4d96ff', // Electric blue — user accent, interactive elements
  accent: '#bd93f9', // Neon purple — highlights, special elements
  text: '#eeeeee', // Near-white — primary text
  textMuted: '#808080', // Medium gray — de-emphasized text
  textDim: '#555555', // Dim gray — very subtle text

  // ── Backgrounds ───────────────────────────────────────────────
  background: '#0a0a0a', // Near-black root background
  backgroundPanel: '#141414', // Panel/message backgrounds
  backgroundElement: '#1e1e1e', // Interactive element hover/keybind bg
  backgroundMenu: '#1e1e1e', // Menu/overlay backgrounds

  // ── Borders (OpenCode uses lighter borders for visibility) ────
  border: '#484848', // Default borders
  borderActive: '#606060', // Active/focused borders
  borderSubtle: '#3c3c3c', // Very subtle separators

  // ── Status ─────────────────────────────────────────────────────
  success: '#36f0a0', // Success = brand green (unified)
  warning: '#ffb86c', // Vibrant orange
  error: '#ff5555', // Terminal red
  info: '#89ddff', // Sky blue (distinct from green)

  // ── Diff colors ───────────────────────────────────────────────
  diffAdded: '#36f0a0', // Added lines = brand green
  diffRemoved: '#ff5555', // Removed lines = error red

  // ── Legacy compat (mapped to new names) ───────────────────────
  muted: '#808080', // = textMuted
  user: '#4d96ff', // = secondary
  agent: undefined, // default fg
  progress: '#ffb86c', // = warning
  url: '#4d96ff', // = secondary
  toolBorder: '#484848', // = border
  inactive: '#555555', // = textDim
  sectionTitle: '#eeeeee', // = text
  projectName: undefined,

  // ── Status colors ─────────────────────────────────────────────
  statusRunning: '#36f0a0',
  statusBuilding: '#ffb86c',
  statusStopped: '#555555',
  statusError: '#ff5555',

  // ── Resource thresholds ───────────────────────────────────────
  resourceOk: '#36f0a0',
  resourceWarn: '#ffb86c',
  resourceCrit: '#ff5555',
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
