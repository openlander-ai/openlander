import { describe, it, expect } from 'vitest';

import {
  TargetIdentityResolver,
  targetIdentityResolver,
} from '../../src/db/target-identity-resolver.js';

// Target Identity Resolver (pre-v0.2 refactor target #1, D1: derivation-behind-
// interface). The resolver OWNS the legacy `<projectId>__svc` convention so no
// workflow constructs it by hand. These tests pin the derivation contract and,
// critically, the D3 response-path null-guard that stops a synthetic id leaking
// to clients for an unresolved target.

describe('TargetIdentityResolver', () => {
  const resolver = new TargetIdentityResolver();

  it('derives the canonical deployable id for a runtime project', () => {
    expect(resolver.deployableServiceIdForRuntimeProject('proj_abc')).toBe('proj_abc__svc');
  });

  it('is idempotent — an id already carrying the suffix is returned unchanged', () => {
    expect(resolver.deployableServiceIdForRuntimeProject('proj_abc__svc')).toBe('proj_abc__svc');
  });

  it('inverts the derivation back to the runtime project id', () => {
    expect(resolver.runtimeProjectIdForDeployableService('proj_abc__svc')).toBe('proj_abc');
    // A managed service id without the suffix is returned unchanged.
    expect(resolver.runtimeProjectIdForDeployableService('svc-redis')).toBe('svc-redis');
  });

  describe('deployableServiceIdForResponse — D3 client-leak guard', () => {
    it('returns the canonical id for a resolved runtime project', () => {
      expect(resolver.deployableServiceIdForResponse('proj_abc')).toBe('proj_abc__svc');
    });

    it('returns undefined (never a synthetic id) for an unresolved target', () => {
      expect(resolver.deployableServiceIdForResponse(undefined)).toBeUndefined();
      expect(resolver.deployableServiceIdForResponse('')).toBeUndefined();
    });
  });

  it('exposes a shared stateless singleton', () => {
    expect(targetIdentityResolver).toBeInstanceOf(TargetIdentityResolver);
    expect(targetIdentityResolver.deployableServiceIdForRuntimeProject('p1')).toBe('p1__svc');
  });
});
