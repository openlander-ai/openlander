import { describe, expect, it } from 'vitest';

import {
  buildTraefikLabels,
  getEnvironmentProjectHostname,
  getProjectHostname,
} from '../src/pipeline/traefik.js';

describe('Traefik environment hostnames', () => {
  it('keeps production hostname unchanged by default', () => {
    expect(getProjectHostname('my-app', '10.0.0.7')).toBe('my-app.10.0.0.7.sslip.io');
    expect(getEnvironmentProjectHostname('my-app', 'production', '10.0.0.7')).toBe(
      'my-app.10.0.0.7.sslip.io',
    );
  });

  it('adds staging hostname prefix', () => {
    expect(getEnvironmentProjectHostname('my-app', 'staging', '10.0.0.7')).toBe(
      'staging-my-app.10.0.0.7.sslip.io',
    );
  });

  it('adds development hostname prefix', () => {
    expect(getEnvironmentProjectHostname('my-app', 'development', '10.0.0.7')).toBe(
      'dev-my-app.10.0.0.7.sslip.io',
    );
  });
});

describe('Traefik labels with environment', () => {
  it('keeps production labels unchanged when environment is omitted', () => {
    const defaultLabels = buildTraefikLabels('my-app', 10001);
    const productionLabels = buildTraefikLabels('my-app', 10001, undefined, 'production');

    expect(defaultLabels['traefik.http.routers.ol-my-app.rule']).toBe(
      productionLabels['traefik.http.routers.ol-my-app.rule'],
    );
  });

  it('uses staging prefix in generated host rule', () => {
    const labels = buildTraefikLabels('my-app', 10001, undefined, 'staging');

    expect(labels['traefik.http.routers.ol-my-app.rule']).toContain('staging-my-app.');
  });

  it('uses development prefix in generated host rule', () => {
    const labels = buildTraefikLabels('my-app', 10001, undefined, 'development');

    expect(labels['traefik.http.routers.ol-my-app.rule']).toContain('dev-my-app.');
  });
});
