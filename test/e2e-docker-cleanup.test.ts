import { describe, expect, it } from 'vitest';

import {
  E2E_CONTAINER_NAME_PREFIXES,
  listContainerIdsByNamePrefixFromLines,
} from '../e2e/quality-gate/fixtures/docker-cleanup.js';

describe('quality-gate Docker cleanup', () => {
  it('matches only E2E prefixes owned by the current OpenLander instance', () => {
    const ids = listContainerIdsByNamePrefixFromLines(
      [
        'aaa111 ol-test-single-dockerfile olinst_current',
        'bbb222 openlander-qg-db-codex-10115 olinst_current',
        'ccc333 ol-demo-stack-postgres olinst_current',
        'ddd444 ol-mcp-single-dockerfile olinst_other',
        'eee555 qa-helper olinst_current',
        'fff666 ol-svc-qg-pg-smoke olinst_current',
        'ggg777 ol-svc-test-single-dockerfile olinst_current',
        'hhh888 ol-svc-golden-roll olinst_current',
        'iii999 ol-svc-qa-helper olinst_current',
        'jjj000 ol-svc-mcp-single-dockerfile',
        'kkk111 ol-svc-shared-pg olinst_current',
      ].join('\n'),
      E2E_CONTAINER_NAME_PREFIXES,
      'olinst_current',
    );

    expect(ids).toEqual(['aaa111', 'fff666', 'ggg777', 'hhh888', 'iii999']);
  });
});
