import { vi } from 'vitest';

import {
  createInitialLogStreamState,
  useLogStream,
  type LogEntry,
  type LogStreamState,
} from '../../web/src/hooks/use-log-stream';
import {
  DEFAULT_CONSOLE_FILTER_STATE,
  DEFAULT_CONSOLE_VIEW_STATE,
  type ConsoleFilterState,
  type ConsoleViewState,
} from '../../web/src/types/console';

type MockUseLogStreamResult = ReturnType<typeof useLogStream>;

interface CreateMockUseLogStreamResultOptions {
  state?: Partial<LogStreamState>;
  clear?: MockUseLogStreamResult['clear'];
  pauseFollowing?: MockUseLogStreamResult['pauseFollowing'];
  jumpToLatest?: MockUseLogStreamResult['jumpToLatest'];
  loadOlder?: MockUseLogStreamResult['loadOlder'];
}

const FIXTURE_TIME_START = Date.parse('2026-01-01T00:00:00.000Z');

let fixtureEntryId = 0;

function createFixtureTimestamp(offset: number): string {
  return new Date(FIXTURE_TIME_START + offset * 1000).toISOString();
}

export function createConsoleFilterState(
  overrides: Partial<ConsoleFilterState> = {},
): ConsoleFilterState {
  return {
    ...DEFAULT_CONSOLE_FILTER_STATE,
    ...overrides,
  };
}

export function createConsoleViewState(
  overrides: Partial<ConsoleViewState> = {},
): ConsoleViewState {
  return {
    ...DEFAULT_CONSOLE_VIEW_STATE,
    ...overrides,
  };
}

export function createConsoleLogEntry(overrides: Partial<LogEntry> = {}): LogEntry {
  fixtureEntryId += 1;

  return {
    id: fixtureEntryId,
    line: `log line ${fixtureEntryId}`,
    stream: 'stdout',
    time: createFixtureTimestamp(fixtureEntryId - 1),
    ...overrides,
  };
}

export function createConsoleLogEntries(
  lines: string[] | string,
  stream: LogEntry['stream'] = 'stdout',
): LogEntry[] {
  const normalizedLines = Array.isArray(lines)
    ? lines
    : lines
        .split('\n')
        .map((line) => line.trimEnd())
        .filter((line) => line.length > 0);

  return normalizedLines.map((line) => createConsoleLogEntry({ line, stream }));
}

export function createConsoleLogStreamState(
  overrides: Partial<LogStreamState> = {},
): LogStreamState {
  return {
    ...createInitialLogStreamState(),
    ...overrides,
  };
}

export function createMockUseLogStreamResult(
  options: CreateMockUseLogStreamResultOptions = {},
): MockUseLogStreamResult {
  const state = createConsoleLogStreamState(options.state);

  return {
    ...state,
    isConnected: state.connectionState === 'live',
    isInitialLoading: state.connectionState === 'loading' && state.entries.length === 0,
    isDisconnected: state.connectionState === 'disconnected',
    canJumpToLatest: state.followMode === 'paused' || state.unseenCount > 0,
    clear: options.clear ?? vi.fn(),
    pauseFollowing: options.pauseFollowing ?? vi.fn(),
    jumpToLatest: options.jumpToLatest ?? vi.fn(),
    loadOlder: options.loadOlder ?? vi.fn().mockResolvedValue(undefined),
  };
}
