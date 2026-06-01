import { describe, expect, it } from 'vitest';

import {
  E2E_CONTAINER_NAME_PREFIXES,
  listContainerIdsByNamePrefixFromLines,
} from '../e2e/quality-gate/fixtures/docker-cleanup.js';

describe('quality-gate Docker cleanup', () => {
  it('matches only E2E-owned OpenLander container prefixes', () => {
    const ids = listContainerIdsByNamePrefixFromLines(
      [
        'aaa111 ol-test-single-dockerfile',
        'bbb222 openlander-qg-db-codex-10115',
        'ccc333 ol-demo-stack-postgres',
        'ddd444 ol-mcp-single-dockerfile',
        'eee555 qa-helper',
        'fff666 ol-svc-qg-pg-smoke',
        'ggg777 ol-svc-test-single-dockerfile',
        'hhh888 ol-svc-golden-roll',
        'iii999 ol-svc-qa-helper',
        'jjj000 ol-svc-mcp-single-dockerfile',
        'kkk111 ol-svc-shared-pg',
      ].join('\n'),
      E2E_CONTAINER_NAME_PREFIXES,
    );

    expect(ids).toEqual(['aaa111', 'ddd444', 'fff666', 'ggg777', 'hhh888', 'iii999', 'jjj000']);
  });
});
