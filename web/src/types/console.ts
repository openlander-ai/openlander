export const CONSOLE_SEARCH_MODES = ['text', 'regex'] as const;
export type ConsoleSearchMode = (typeof CONSOLE_SEARCH_MODES)[number];

export const CONSOLE_FOLLOW_MODES = ['follow', 'paused'] as const;
export type ConsoleFollowMode = (typeof CONSOLE_FOLLOW_MODES)[number];

export const CONSOLE_LOG_LEVELS = ['error', 'warn', 'info', 'debug', 'plain'] as const;
export type ConsoleLogLevel = (typeof CONSOLE_LOG_LEVELS)[number];
export type ConsoleLogLevelFilter = ConsoleLogLevel | 'all';

export interface ConsoleFilterState {
  searchQuery: string;
  searchMode: ConsoleSearchMode;
  followMode: ConsoleFollowMode;
  logLevel: ConsoleLogLevelFilter;
}

export interface ConsoleViewState extends ConsoleFilterState {
  showTerminal: boolean;
}

export const CONSOLE_SURFACE_STATES = [
  'loading',
  'empty',
  'error',
  'disconnected',
  'noMatch',
  'ready',
] as const;
export type ConsoleSurfaceState = (typeof CONSOLE_SURFACE_STATES)[number];

export interface ConsoleSurfaceStateOptions {
  hasEntries: boolean;
  hasFilteredEntries: boolean;
  isInitialLoading: boolean;
  isDisconnected: boolean;
  hasError: boolean;
}

export const DEFAULT_CONSOLE_FILTER_STATE: ConsoleFilterState = {
  searchQuery: '',
  searchMode: 'text',
  followMode: 'follow',
  logLevel: 'all',
};

export const DEFAULT_CONSOLE_VIEW_STATE: ConsoleViewState = {
  ...DEFAULT_CONSOLE_FILTER_STATE,
  showTerminal: false,
};

export function getConsoleSurfaceState({
  hasEntries,
  hasFilteredEntries,
  isInitialLoading,
  isDisconnected,
  hasError,
}: ConsoleSurfaceStateOptions): ConsoleSurfaceState {
  if (isInitialLoading && !hasEntries) return 'loading';
  if (hasError && !hasEntries) return 'error';
  if (isDisconnected && !hasEntries) return 'disconnected';
  if (!hasEntries) return 'empty';
  if (!hasFilteredEntries) return 'noMatch';
  return 'ready';
}

export const CONSOLE_LABELS = {
  terminal: 'Terminal',
  searchPlaceholder: 'Search logs...',
  clear: 'Clear',
  live: 'Live',
  bottom: 'Bottom',
  jumpToLatest: 'Jump to latest',
  loadOlder: 'Load older logs',
  loadingOlder: 'Loading older...',
  disconnected: 'Disconnected',
  connecting: 'Connecting',
  lines: 'lines',
  followMode: {
    follow: 'Follow',
    paused: 'Paused',
  },
  searchMode: {
    text: 'Text',
    regex: 'Regex',
  },
  logLevel: {
    all: 'All Levels',
    error: 'Errors',
    warn: 'Warnings',
    info: 'Info',
    debug: 'Debug',
    plain: 'Plain',
  },
} as const;
