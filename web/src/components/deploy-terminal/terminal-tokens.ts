export const terminalTokens = {
  colors: {
    background: '#0a0a0a',
    surface: '#111111',
    border: '#222222',
    text: {
      primary: '#e0e0e0',
      secondary: '#888888',
      muted: '#555555',
      success: '#22c55e',
      error: '#ef4444',
      warning: '#eab308',
      info: '#60a5fa',
      accent: '#a855f7',
    },
    glyph: {
      pending: '#555555',
      active: '#22c55e',
      done: '#4ade80',
      error: '#ef4444',
      skip: '#888888',
    },
  },
  typography: {
    fontFamily: '"JetBrains Mono", monospace',
    fontSize: {
      sm: '11px',
      base: '13px',
    },
    lineHeight: '1.6',
  },
  spacing: {
    px: '1px',
    1: '0.25rem',
    2: '0.5rem',
    3: '0.75rem',
    4: '1rem',
  },
  effects: {
    glow: '0 0 10px rgba(34, 197, 94, 0.2)',
    innerShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.05)',
  },
} as const;

export type TerminalColor = keyof typeof terminalTokens.colors.text;
export type TerminalGlyphState = keyof typeof terminalTokens.colors.glyph;
