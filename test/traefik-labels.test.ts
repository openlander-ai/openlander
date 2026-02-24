import { describe, it, expect } from 'vitest';

import { buildTraefikLabels } from '../src/pipeline/traefik.js';

describe('Traefik Labels', () => {
  it('builds correct labels with default hostname', () => {
    const labels = buildTraefikLabels('my-app', 10001);

    expect(labels['traefik.enable']).toBe('true');
    expect(labels['traefik.http.routers.ol-my-app.rule']).toBe('Host(`my-app.localhost`)');
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
      'Host(`my-cool-app.localhost`)',
    );
  });

  it('port is serialized as string', () => {
    const labels = buildTraefikLabels('app', 10042);

    expect(labels['traefik.http.services.ol-app.loadbalancer.server.port']).toBe('10042');
    expect(typeof labels['traefik.http.services.ol-app.loadbalancer.server.port']).toBe('string');
  });
});
