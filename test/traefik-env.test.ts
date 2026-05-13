import { afterEach, describe, expect, it } from 'vitest';

import {
  buildTraefikLabels,
  getEnvironmentProjectHostname,
  getPreferredProjectUrl,
  getProjectHostname,
  getProjectUrls,
} from '../src/pipeline/traefik.js';

const originalPublicHost = process.env['OPENLANDER_PUBLIC_HOST'];

afterEach(() => {
  if (originalPublicHost === undefined) {
    delete process.env['OPENLANDER_PUBLIC_HOST'];
  } else {
    process.env['OPENLANDER_PUBLIC_HOST'] = originalPublicHost;
  }
});

describe('Traefik environment hostnames', () => {
  it('keeps production hostname unchanged by default', () => {
    delete process.env['OPENLANDER_PUBLIC_HOST'];
    expect(getProjectHostname('my-app', '10.0.0.7')).toBe('my-app.10.0.0.7.sslip.io');
    expect(getEnvironmentProjectHostname('my-app', 'production', '10.0.0.7')).toBe(
      'my-app.10.0.0.7.sslip.io',
    );
  });

  it('returns same hostname for development environment', () => {
    delete process.env['OPENLANDER_PUBLIC_HOST'];
    expect(getEnvironmentProjectHostname('my-app', 'development', '10.0.0.7')).toBe(
      'my-app.10.0.0.7.sslip.io',
    );
  });

  it('returns same hostname for development environment (duplicate coverage)', () => {
    delete process.env['OPENLANDER_PUBLIC_HOST'];
    expect(getEnvironmentProjectHostname('my-app', 'development', '10.0.0.7')).toBe(
      'my-app.10.0.0.7.sslip.io',
    );
  });

  it('prefers OPENLANDER_PUBLIC_HOST for advertised project hostnames', () => {
    process.env['OPENLANDER_PUBLIC_HOST'] = 'apps.example.com';

    expect(getProjectHostname('my-app')).toBe('my-app.apps.example.com');
    expect(getPreferredProjectUrl('my-app')).toBe('http://my-app.apps.example.com');
    expect(getProjectUrls('my-app')[0]).toMatchObject({
      url: 'http://my-app.apps.example.com',
      type: 'public',
      host: 'apps.example.com',
      reachable: 'external',
    });
  });

  it('keeps IP-based public hosts reachable through sslip.io', () => {
    process.env['OPENLANDER_PUBLIC_HOST'] = '192.168.1.50';

    expect(getProjectHostname('my-app')).toBe('my-app.192.168.1.50.sslip.io');
    expect(getProjectUrls('my-app')[0]).toMatchObject({
      url: 'http://my-app.192.168.1.50.sslip.io',
      type: 'public',
      host: '192.168.1.50',
      reachable: 'external',
    });
  });
});

describe('Traefik labels with environment', () => {
  it('keeps production labels unchanged when environment is omitted', () => {
    delete process.env['OPENLANDER_PUBLIC_HOST'];
    const defaultLabels = buildTraefikLabels('my-app', 10001);
    const productionLabels = buildTraefikLabels('my-app', 10001, undefined, 'production');

    expect(defaultLabels['traefik.http.routers.ol-my-app.rule']).toBe(
      productionLabels['traefik.http.routers.ol-my-app.rule'],
    );
  });

  it('uses production-style host rule even when development is passed', () => {
    delete process.env['OPENLANDER_PUBLIC_HOST'];
    const labels = buildTraefikLabels('my-app', 10001, undefined, 'development');

    expect(labels['traefik.http.routers.ol-my-app.rule']).toContain('my-app.');
  });

  it('uses production-style host rule even when development is passed (duplicate coverage)', () => {
    delete process.env['OPENLANDER_PUBLIC_HOST'];
    const labels = buildTraefikLabels('my-app', 10001, undefined, 'development');

    expect(labels['traefik.http.routers.ol-my-app.rule']).toContain('my-app.');
  });
});
