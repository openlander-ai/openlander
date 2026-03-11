import { describe, expect, it } from 'vitest';

import { getConsoleSurfaceState } from '../../web/src/types/console';

describe('console surface state helper', () => {
  it('keeps initial loading distinct before any logs arrive', () => {
    expect(
      getConsoleSurfaceState({
        hasEntries: false,
        hasFilteredEntries: false,
        isInitialLoading: true,
        isDisconnected: false,
        hasError: false,
      }),
    ).toBe('loading');
  });

  it('keeps empty, disconnected, and error states distinct when no logs exist', () => {
    expect(
      getConsoleSurfaceState({
        hasEntries: false,
        hasFilteredEntries: false,
        isInitialLoading: false,
        isDisconnected: false,
        hasError: false,
      }),
    ).toBe('empty');

    expect(
      getConsoleSurfaceState({
        hasEntries: false,
        hasFilteredEntries: false,
        isInitialLoading: false,
        isDisconnected: true,
        hasError: false,
      }),
    ).toBe('disconnected');

    expect(
      getConsoleSurfaceState({
        hasEntries: false,
        hasFilteredEntries: false,
        isInitialLoading: false,
        isDisconnected: false,
        hasError: true,
      }),
    ).toBe('error');
  });

  it('keeps filter misses separate from healthy log rendering', () => {
    expect(
      getConsoleSurfaceState({
        hasEntries: true,
        hasFilteredEntries: false,
        isInitialLoading: false,
        isDisconnected: false,
        hasError: false,
      }),
    ).toBe('noMatch');

    expect(
      getConsoleSurfaceState({
        hasEntries: true,
        hasFilteredEntries: true,
        isInitialLoading: false,
        isDisconnected: true,
        hasError: false,
      }),
    ).toBe('ready');
  });
});
