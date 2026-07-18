import { describe, expect, it } from 'vitest';

import { assertComposeStatefulChangesSafe } from '../../src/pipeline/compose-stateful-guard.js';

describe('assertComposeStatefulChangesSafe', () => {
  const roles = new Map([['db', 'resource'] as const, ['web', 'application'] as const]);
  const existing = [
    { name: 'db', runtimeRole: 'resource' as const },
    { name: 'web', runtimeRole: 'application' as const },
  ];

  it('allows unchanged resources', () => {
    expect(() =>
      assertComposeStatefulChangesSafe({
        currentServiceNames: new Set(['db', 'web']),
        currentRuntimeRoles: roles,
        existingServices: existing,
        previousFingerprints: { db: 'same', web: 'old' },
        currentFingerprints: { db: 'same', web: 'new' },
      }),
    ).not.toThrow();
  });

  it('blocks a changed resource definition', () => {
    expect(() =>
      assertComposeStatefulChangesSafe({
        currentServiceNames: new Set(['db', 'web']),
        currentRuntimeRoles: roles,
        existingServices: existing,
        previousFingerprints: { db: 'old' },
        currentFingerprints: { db: 'new' },
      }),
    ).toThrowError(expect.objectContaining({ code: 'STATEFUL_SERVICE_CHANGE_BLOCKED' }));
  });

  it('blocks removal of an existing resource', () => {
    expect(() =>
      assertComposeStatefulChangesSafe({
        currentServiceNames: new Set(['web']),
        currentRuntimeRoles: new Map([['web', 'application'] as const]),
        existingServices: existing,
        previousFingerprints: { db: 'old', web: 'old' },
        currentFingerprints: { web: 'new' },
      }),
    ).toThrowError(expect.objectContaining({ code: 'STATEFUL_SERVICE_REMOVAL_BLOCKED' }));
  });

  it('allows legacy snapshots without fingerprints to be adopted', () => {
    expect(() =>
      assertComposeStatefulChangesSafe({
        currentServiceNames: new Set(['db', 'web']),
        currentRuntimeRoles: roles,
        existingServices: existing,
        currentFingerprints: { db: 'current', web: 'current' },
      }),
    ).not.toThrow();
  });
});
