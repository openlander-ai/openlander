/**
 * Centralized color theme constants for the TUI.
 * OpenCode-inspired hex color palette + legacy named colors for backward compat.
 */
export const theme = {
  // ── Core palette (OpenCode-inspired hex) ─────────────────────
  primary: '#fab283', // Orange — assistant accent, active elements
  secondary: '#5c9cf5', // Blue — user accent, interactive elements
  muted: '#6a6a6a', // Gray — de-emphasized text, separators
  text: '#e0e0e0', // Light gray — primary text
  toolBorder: '#4b4c5c', // Dark gray — tool call borders
  background: '#212121', // Dark bg (informational, not enforced by Ink)

  // ── Legacy text colors (backward compat) ────────────────────
  user: '#5c9cf5', // User messages (maps to secondary)
  agent: undefined, // Agent messages (default foreground)
  success: '#a6e3a1', // Success states
  warning: '#f9e2af', // Warnings
  error: '#f38ba8', // Errors
  progress: '#f9e2af', // In-progress states
  url: '#5c9cf5', // URLs (maps to secondary)
  info: '#5c9cf5', // Informational text

  // ── UI elements ─────────────────────────────────────────────
  border: '#4b4c5c', // Borders (maps to toolBorder)
  inactive: '#6a6a6a', // Dimmed/inactive (maps to muted)
  sectionTitle: '#e0e0e0', // Section headers (maps to text)
  projectName: undefined, // Project names (use bold prop)

  // ── Status colors ───────────────────────────────────────────
  statusRunning: '#a6e3a1',
  statusBuilding: '#f9e2af',
  statusStopped: '#6a6a6a',
  statusError: '#f38ba8',

  // ── Resource thresholds ─────────────────────────────────────
  resourceOk: '#a6e3a1', // < 60%
  resourceWarn: '#f9e2af', // 60-80%
  resourceCrit: '#f38ba8', // > 80%
} as const;

export type ThemeColor = (typeof theme)[keyof typeof theme];
