import { describe, it, expect } from 'vitest';

import { buildTraefikLabels, getProjectHostname } from '../src/pipeline/traefik.js';
import { SHARED_NETWORK_NAME } from '../src/config/index.js';

describe('Traefik Labels', () => {
  it('builds correct labels with default hostname', () => {
    const labels = buildTraefikLabels('my-app', 10001);

    expect(labels['traefik.enable']).toBe('true');
    expect(labels['traefik.http.routers.ol-my-app.rule']).toBe(
      `Host(\`${getProjectHostname('my-app')}\`)`,
    );
    expect(labels['traefik.http.routers.ol-my-app.entrypoints']).toBe('web');
    expect(labels['traefik.http.routers.ol-my-app.service']).toBe('ol-my-app');
    expect(labels['traefik.http.services.ol-my-app.loadbalancer.server.port']).toBe('10001');
  });

  it('builds correct labels with custom hostname', () => {
    const labels = buildTraefikLabels('my-app', 10001, 'api.example.com');

    expect(labels['traefik.http.routers.ol-my-app.rule']).toBe('Host(`api.example.com`)');
  });

  it('handles project names with hyphens', () => {
    const labels = buildTraefikLabels('my-cool-app', 10005);

    expect(labels['traefik.http.routers.ol-my-cool-app.rule']).toBe(
      `Host(\`${getProjectHostname('my-cool-app')}\`)`,
    );
  });

  it('port is serialized as string', () => {
    const labels = buildTraefikLabels('app', 10042);

    expect(labels['traefik.http.services.ol-app.loadbalancer.server.port']).toBe('10042');
    expect(typeof labels['traefik.http.services.ol-app.loadbalancer.server.port']).toBe('string');
  });

  it('includes traefik.docker.network for production environment', () => {
    const labels = buildTraefikLabels('my-app', 10001, undefined, 'production');

    expect(labels['traefik.docker.network']).toBe(SHARED_NETWORK_NAME);
  });

  it('includes traefik.docker.network for development environment', () => {
    const labels = buildTraefikLabels('my-app', 10001, undefined, 'development');

    expect(labels['traefik.docker.network']).toBe(SHARED_NETWORK_NAME);
  });

  it('defaults traefik.docker.network to production when environment is omitted', () => {
    const labels = buildTraefikLabels('my-app', 10001);

    expect(labels['traefik.docker.network']).toBe(SHARED_NETWORK_NAME);
  });

  it('disables Docker-provider routes when HTTP provider owns app routing', () => {
    const labels = buildTraefikLabels(
      'my-app',
      10001,
      undefined,
      'production',
      SHARED_NETWORK_NAME,
      'http-provider',
    );

    expect(labels).toEqual({ 'traefik.enable': 'false' });
  });
});
