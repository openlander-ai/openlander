/**
 * Centralized color theme constants for the TUI.
 * All components should reference these instead of hardcoded color strings.
 */
export const theme = {
  // Text colors
  user: 'cyan', // User messages
  agent: undefined, // Agent messages (default foreground)
  success: 'green', // Success states
  warning: 'yellow', // Warnings
  error: 'red', // Errors
  progress: 'yellow', // In-progress states
  url: 'blue', // URLs (also underlined)
  info: 'cyan', // Informational text

  // UI elements
  border: 'gray', // Borders
  inactive: 'gray', // Dimmed/inactive text (use dimColor prop)
  sectionTitle: 'white', // Section headers (also bold)
  projectName: undefined, // Project names (use bold prop)

  // Status colors
  statusRunning: 'green',
  statusBuilding: 'yellow',
  statusStopped: 'gray',
  statusError: 'red',

  // Resource thresholds
  resourceOk: 'green', // < 60%
  resourceWarn: 'yellow', // 60-80%
  resourceCrit: 'red', // > 80%
} as const;

export type ThemeColor = (typeof theme)[keyof typeof theme];
