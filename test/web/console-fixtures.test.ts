import { describe, expect, it, vi } from 'vitest';

import {
  createConsoleFilterState,
  createConsoleLogEntries,
  createMockUseLogStreamResult,
} from '../helpers/console-fixtures.js';

describe('console test fixtures', () => {
  it('builds deterministic log entries from multiline log text', () => {
    const entries = createConsoleLogEntries('build started\nwarn: cache miss\n');

    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => entry.line)).toEqual(['build started', 'warn: cache miss']);
    expect(entries[1].id).toBe(entries[0].id + 1);
    expect(entries[0].time).toMatch(/^2026-01-01T00:00:00/);
  });

  it('derives hook flags from console stream state for future LogViewer mocks', async () => {
    const loadOlder = vi.fn().mockResolvedValue(undefined);
    const result = createMockUseLogStreamResult({
      state: {
        entries: createConsoleLogEntries(['first', 'second']),
        connectionState: 'disconnected',
        followMode: 'paused',
        unseenCount: 2,
      },
      loadOlder,
    });

    expect(result.isConnected).toBe(false);
    expect(result.isDisconnected).toBe(true);
    expect(result.canJumpToLatest).toBe(true);

    await result.loadOlder();
    expect(loadOlder).toHaveBeenCalledTimes(1);
  });

  it('keeps filter fixtures aligned with shared console defaults', () => {
    expect(createConsoleFilterState({ searchQuery: 'error' })).toEqual({
      searchQuery: 'error',
      searchMode: 'text',
      followMode: 'follow',
      logLevel: 'all',
    });
  });
});
