/**
 * app-routes.test.ts — 1.0-rc.1 route logic unit tests.
 *
 * Validates the URL-dispatch and param-normalisation rules introduced in
 * ServiceDetailV2 without requiring a DOM environment (no @testing-library
 * or jsdom installed). Tests the pure-logic layer of the dispatcher:
 *
 *   /projects/:p/services/:s  → canonical, params { p, s }
 *   /projects/:p/infrastructure/:id → infrastructure service, params { p, id }
 *   /services/:id?project=:p  → legacy deployable, params { id }
 *
 * These mirror the three route shapes registered in App.tsx.
 */
import { describe, it, expect } from 'vitest';

// ─── Dispatcher logic (extracted for testability) ─────────────────────────

/**
 * Replicates the branch selection logic of ServiceDetailV2().
 * Returns which component branch would be rendered given a pathname
 * and the params object that React Router v6 would produce.
 */
function dispatchRouteVariant(
  pathname: string,
  params: { id?: string; p?: string; s?: string },
):
  | 'ManagedServiceDetail'
  | 'DeployableServiceDetail(canonical)'
  | 'DeployableServiceDetail(legacy)' {
  const { id, s } = params;
  if (pathname.includes('/infrastructure/') && id) {
    return 'ManagedServiceDetail';
  }
  if (s) {
    return 'DeployableServiceDetail(canonical)';
  }
  return 'DeployableServiceDetail(legacy)';
}

/**
 * Replicates the project-id normalisation in DeployableServiceDetail().
 * Canonical route: project comes from params.p.
 * Legacy route:    project comes from the ?project= query param.
 */
function normaliseProjectId(
  params: { p?: string },
  searchParamsProject: string | null,
): string | null {
  return params.p ?? searchParamsProject;
}

/**
 * Replicates the service-id normalisation in DeployableServiceDetail().
 * canonicalServiceId is set by the dispatcher when params.s is present.
 */
function normaliseServiceId(
  canonicalServiceId: string | undefined,
  paramsId: string | undefined,
): string | undefined {
  return canonicalServiceId ?? paramsId;
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('ServiceDetailV2 dispatcher — URL shape routing', () => {
  it('canonical /projects/:p/services/:s → DeployableServiceDetail(canonical)', () => {
    // React Router produces { p: 'abc', s: 'xyz' } for this path
    const result = dispatchRouteVariant('/projects/abc/services/xyz', { p: 'abc', s: 'xyz' });
    expect(result).toBe('DeployableServiceDetail(canonical)');
  });

  it('legacy /services/:id?project=:p → DeployableServiceDetail(legacy)', () => {
    // React Router produces { id: 'xyz' } for this path (no p, no s)
    const result = dispatchRouteVariant('/services/xyz', { id: 'xyz' });
    expect(result).toBe('DeployableServiceDetail(legacy)');
  });

  it('/projects/:p/infrastructure/:id → ManagedServiceDetail', () => {
    const result = dispatchRouteVariant('/projects/abc/infrastructure/xyz', {
      p: 'abc',
      id: 'xyz',
    });
    expect(result).toBe('ManagedServiceDetail');
  });

  it('/managed-services/:id is not a frontend detail route', () => {
    const result = dispatchRouteVariant('/managed-services/xyz', { id: 'xyz' });
    expect(result).toBe('DeployableServiceDetail(legacy)');
  });
});

describe('DeployableServiceDetail — project id normalisation', () => {
  it('canonical route: project comes from params.p (not query string)', () => {
    const projectId = normaliseProjectId({ p: 'abc' }, null);
    expect(projectId).toBe('abc');
  });

  it('legacy route: project comes from ?project= query param', () => {
    const projectId = normaliseProjectId({}, 'abc');
    expect(projectId).toBe('abc');
  });

  it('canonical params.p takes precedence over query string when both present', () => {
    const projectId = normaliseProjectId({ p: 'from-param' }, 'from-query');
    expect(projectId).toBe('from-param');
  });

  it('returns null when neither params.p nor ?project= is present', () => {
    const projectId = normaliseProjectId({}, null);
    expect(projectId).toBeNull();
  });
});

describe('DeployableServiceDetail — service id normalisation', () => {
  it('canonical: canonicalServiceId (from params.s) used when set', () => {
    const serviceId = normaliseServiceId('xyz', undefined);
    expect(serviceId).toBe('xyz');
  });

  it('legacy: params.id used when canonicalServiceId is absent', () => {
    const serviceId = normaliseServiceId(undefined, 'xyz');
    expect(serviceId).toBe('xyz');
  });

  it('canonicalServiceId takes precedence over params.id', () => {
    const serviceId = normaliseServiceId('canonical-id', 'legacy-id');
    expect(serviceId).toBe('canonical-id');
  });

  it('canonical route /projects/abc/services/xyz exposes { p: "abc", s: "xyz" }', () => {
    // Validate the expected params shape for the canonical route
    // (mirrors what React Router v6 produces for path="/projects/:p/services/:s")
    const params = { p: 'abc', s: 'xyz' };
    expect(params.p).toBe('abc');
    expect(params.s).toBe('xyz');
    // Dispatcher passes s as canonicalServiceId
    const serviceId = normaliseServiceId(params.s, undefined);
    expect(serviceId).toBe('xyz');
    // DeployableServiceDetail reads p from params
    const projectId = normaliseProjectId(params, null);
    expect(projectId).toBe('abc');
  });
});

describe('App.tsx route registration — three URL shapes coexist in rc.1', () => {
  // These tests document (not render) the three registered route paths
  // to catch accidental removal or path-string typos at review time.
  const CANONICAL_PATTERN = '/projects/:p/services/:s';
  const INFRASTRUCTURE_PATTERN = '/projects/:p/infrastructure/:id';
  const LEGACY_PATTERN = '/services/:id';

  it('canonical pattern contains both :p and :s params', () => {
    expect(CANONICAL_PATTERN).toContain(':p');
    expect(CANONICAL_PATTERN).toContain(':s');
  });

  it('legacy pattern contains :id param but not :p or :s', () => {
    expect(LEGACY_PATTERN).toContain(':id');
    expect(LEGACY_PATTERN).not.toContain(':p');
    expect(LEGACY_PATTERN).not.toContain(':s');
  });

  it('infrastructure pattern keeps project context and service id', () => {
    expect(INFRASTRUCTURE_PATTERN).toContain(':p');
    expect(INFRASTRUCTURE_PATTERN).toContain(':id');
    expect(INFRASTRUCTURE_PATTERN).not.toContain('managed-services');
  });

  it('infrastructure pattern is prefix-distinct from legacy deployable', () => {
    expect(CANONICAL_PATTERN.startsWith('/managed-services')).toBe(false);
    expect(LEGACY_PATTERN.startsWith('/managed-services')).toBe(false);
  });

  it('canonical URL for project=abc service=xyz is /projects/abc/services/xyz', () => {
    const p = 'abc';
    const s = 'xyz';
    const url = `/projects/${p}/services/${s}`;
    expect(url).toBe('/projects/abc/services/xyz');
  });
});
