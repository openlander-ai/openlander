import { describe, expect, it } from 'vitest';

import {
  kindGroupFromTypeParam,
  typeParamFromKindGroup,
} from '../../web/src/lib/agentActivity.js';

describe('Activity type URL mapping', () => {
  it.each([
    [null, 'all'],
    ['all', 'all'],
    ['deploy', 'deploys'],
    ['config', 'config'],
    // Legacy URL alias kept decoding — old bookmarks like /activity?type=crash
    // still surface the same set of events under the renamed "System" tab.
    ['crash', 'system'],
    ['system', 'system'],
    ['mcp', 'mcp'],
    ['unknown', 'all'],
  ] as const)('maps URL type %s to KindGroup %s', (param, expected) => {
    expect(kindGroupFromTypeParam(param)).toBe(expected);
  });

  it.each([
    ['all', 'all'],
    ['deploys', 'deploy'],
    ['config', 'config'],
    ['system', 'system'],
    ['mcp', 'mcp'],
  ] as const)('maps KindGroup %s back to URL type %s', (kind, expected) => {
    expect(typeParamFromKindGroup(kind)).toBe(expected);
  });
});
