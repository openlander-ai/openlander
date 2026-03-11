import { describe, expect, it } from 'vitest';
import {
  CONSOLE_FOLLOW_MODES,
  CONSOLE_LABELS,
  CONSOLE_LOG_LEVELS,
  CONSOLE_SEARCH_MODES,
  DEFAULT_CONSOLE_FILTER_STATE,
  DEFAULT_CONSOLE_VIEW_STATE,
} from '../web/src/types/console';

describe('shared console contract', () => {
  it('defines stable default filter and view state', () => {
    expect(DEFAULT_CONSOLE_FILTER_STATE).toEqual({
      searchQuery: '',
      searchMode: 'text',
      followMode: 'follow',
      logLevel: 'all',
    });

    expect(DEFAULT_CONSOLE_VIEW_STATE).toEqual({
      ...DEFAULT_CONSOLE_FILTER_STATE,
      showTerminal: false,
    });
  });

  it('keeps follow and search labels aligned with exported modes', () => {
    expect(Object.keys(CONSOLE_LABELS.followMode)).toEqual([...CONSOLE_FOLLOW_MODES]);
    expect(Object.keys(CONSOLE_LABELS.searchMode)).toEqual([...CONSOLE_SEARCH_MODES]);
    expect(Object.keys(CONSOLE_LABELS.logLevel)).toEqual(['all', ...CONSOLE_LOG_LEVELS]);
  });

  it('exports the expected log levels for console styling', () => {
    expect(CONSOLE_LOG_LEVELS).toEqual(['error', 'warn', 'info', 'debug', 'plain']);
  });
});
