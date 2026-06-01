import { describe, expect, it } from 'vitest';

import { listContainerIdsByNamePrefixFromLines } from '../e2e/quality-gate/fixtures/docker-cleanup.js';

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
      ].join('\n'),
      ['ol-test-', 'ol-golden-', 'ol-qg-', 'ol-qa-', 'ol-mcp-', 'ol-svc-qg-'],
    );

    expect(ids).toEqual(['aaa111', 'ddd444', 'fff666']);
  });
});
