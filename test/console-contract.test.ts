import { describe, expect, it } from 'vitest';
import { translations as en } from '../web/src/i18n/en';
import { translations as ko } from '../web/src/i18n/ko';
import {
  CONSOLE_FOLLOW_MODES,
  CONSOLE_LABEL_KEYS,
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

  it('keeps translated labels aligned with exported modes', () => {
    expect(Object.keys(CONSOLE_LABEL_KEYS.followMode)).toEqual([...CONSOLE_FOLLOW_MODES]);
    expect(Object.keys(CONSOLE_LABEL_KEYS.searchMode)).toEqual([...CONSOLE_SEARCH_MODES]);
    expect(Object.keys(CONSOLE_LABEL_KEYS.logLevel)).toEqual(['all', ...CONSOLE_LOG_LEVELS]);

    for (const locale of [en, ko]) {
      expect(Object.keys(locale.logs.console.followMode)).toEqual([...CONSOLE_FOLLOW_MODES]);
      expect(Object.keys(locale.logs.console.searchMode)).toEqual([...CONSOLE_SEARCH_MODES]);
      expect(Object.keys(locale.logs.console.logLevel)).toEqual(['all', ...CONSOLE_LOG_LEVELS]);
    }
  });

  it('exports the expected log levels for console styling', () => {
    expect(CONSOLE_LOG_LEVELS).toEqual(['error', 'warn', 'info', 'debug', 'plain']);
  });
});
