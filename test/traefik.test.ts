import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  detectReverseProxy,
  switchToExternalMode,
  getProxyWarning,
  getProxyStatus,
  type ProxyDetection,
  TraefikManager,
} from '../src/pipeline/traefik.js';
import type { Docker } from '../src/pipeline/docker.js';
import {
  type MockContainer,
  createMockContainer,
  createMockDocker,
  createMockDockerWithError,
} from './helpers/docker-mocks.js';

// ---------------------------------------------------------------------------
// detectReverseProxy Tests
// ---------------------------------------------------------------------------

describe('detectReverseProxy', () => {
  let docker: Docker;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('detects managed OpenLander Traefik container', async () => {
    docker = createMockDocker([
      createMockContainer('openlander-traefik', {
        image: 'traefik:v3.3',
        ports: [{ PublicPort: 80 }, { PublicPort: 8080 }],
        labels: {
          'openlander.managed': 'true',
          'openlander.role': 'traefik',
        },
      }),
    ]);

    const result = await detectReverseProxy(docker);

    expect(result.type).toBe('traefik');
    expect(result.container).toBe('openlander-traefik');
    expect(result.ports).toContain(80);
    expect(result.ports).toContain(8080);
    expect(result.version).toBe('v3.3');
    expect(result.traefikDockerProvider).toBe(true);
  });

  it('detects external Traefik container', async () => {
    docker = createMockDocker([
      createMockContainer('my-traefik', {
        image: 'traefik:2.10',
        ports: [{ PublicPort: 80 }, { PublicPort: 443 }],
        labels: {},
      }),
    ]);

    const result = await detectReverseProxy(docker);

    expect(result.type).toBe('traefik');
    expect(result.container).toBe('my-traefik');
    expect(result.ports).toContain(80);
    expect(result.ports).toContain(443);
    expect(result.version).toBe('2.10');
    expect(result.traefikDockerProvider).toBe(true); // Defaults to true for external
  });

  it('detects Nginx container', async () => {
    docker = createMockDocker([
      createMockContainer('nginx-proxy', {
        image: 'nginx:1.25-alpine',
        ports: [{ PublicPort: 80 }, { PublicPort: 443 }],
        labels: {},
      }),
    ]);

    const result = await detectReverseProxy(docker);

    expect(result.type).toBe('nginx');
    expect(result.container).toBe('nginx-proxy');
    expect(result.ports).toContain(80);
    expect(result.version).toBe('1.25-alpine');
    expect(result.traefikDockerProvider).toBeUndefined();
  });

  it('detects Caddy container', async () => {
    docker = createMockDocker([
      createMockContainer('caddy-server', {
        image: 'caddy:2.7',
        ports: [{ PublicPort: 80 }, { PublicPort: 443 }],
        labels: {},
      }),
    ]);

    const result = await detectReverseProxy(docker);

    expect(result.type).toBe('caddy');
    expect(result.container).toBe('caddy-server');
    expect(result.version).toBe('2.7');
  });

  it('detects HAProxy container', async () => {
    docker = createMockDocker([
      createMockContainer('haproxy-lb', {
        image: 'haproxy:2.8',
        ports: [{ PublicPort: 80 }],
        labels: {},
      }),
    ]);

    const result = await detectReverseProxy(docker);

    expect(result.type).toBe('haproxy');
    expect(result.container).toBe('haproxy-lb');
    expect(result.version).toBe('2.8');
  });

  it('returns type none when no proxy is detected', async () => {
    docker = createMockDocker([
      createMockContainer('random-app', {
        image: 'node:18',
        ports: [{ PublicPort: 3000 }],
        labels: {},
      }),
    ]);

    const result = await detectReverseProxy(docker);

    expect(result.type).toBe('none');
    expect(result.ports).toEqual([]);
    expect(result.container).toBeUndefined();
  });

  it('returns type none when no containers exist', async () => {
    docker = createMockDocker([]);

    const result = await detectReverseProxy(docker);

    expect(result.type).toBe('none');
    expect(result.ports).toEqual([]);
  });

  it('returns type none when Docker daemon is not running', async () => {
    docker = createMockDockerWithError();

    const result = await detectReverseProxy(docker);

    expect(result.type).toBe('none');
    expect(result.ports).toEqual([]);
  });

  it('prioritizes Traefik over Nginx when both exist', async () => {
    docker = createMockDocker([
      createMockContainer('nginx-proxy', {
        image: 'nginx:latest',
        ports: [{ PublicPort: 8080 }],
        labels: {},
      }),
      createMockContainer('traefik-proxy', {
        image: 'traefik:v3',
        ports: [{ PublicPort: 80 }],
        labels: {},
      }),
    ]);

    const result = await detectReverseProxy(docker);

    expect(result.type).toBe('traefik');
    expect(result.container).toBe('traefik-proxy');
  });

  it('prioritizes Nginx over Caddy when both exist', async () => {
    docker = createMockDocker([
      createMockContainer('caddy-server', {
        image: 'caddy:latest',
        ports: [{ PublicPort: 8080 }],
        labels: {},
      }),
      createMockContainer('nginx-proxy', {
        image: 'nginx:latest',
        ports: [{ PublicPort: 80 }],
        labels: {},
      }),
    ]);

    const result = await detectReverseProxy(docker);

    expect(result.type).toBe('nginx');
    expect(result.container).toBe('nginx-proxy');
  });

  it('prioritizes Caddy over HAProxy when both exist', async () => {
    docker = createMockDocker([
      createMockContainer('haproxy-lb', {
        image: 'haproxy:latest',
        ports: [{ PublicPort: 8080 }],
        labels: {},
      }),
      createMockContainer('caddy-server', {
        image: 'caddy:latest',
        ports: [{ PublicPort: 80 }],
        labels: {},
      }),
    ]);

    const result = await detectReverseProxy(docker);

    expect(result.type).toBe('caddy');
    expect(result.container).toBe('caddy-server');
  });

  it('ignores stopped containers', async () => {
    docker = createMockDocker([
      createMockContainer('stopped-traefik', {
        image: 'traefik:v3',
        state: 'exited',
        ports: [{ PublicPort: 80 }],
        labels: {},
      }),
    ]);

    const result = await detectReverseProxy(docker);

    expect(result.type).toBe('none');
  });

  it('includes restarting containers', async () => {
    docker = createMockDocker([
      createMockContainer('restarting-traefik', {
        image: 'traefik:v3',
        state: 'restarting',
        ports: [{ PublicPort: 80 }],
        labels: {},
      }),
    ]);

    const result = await detectReverseProxy(docker);

    expect(result.type).toBe('traefik');
    expect(result.container).toBe('restarting-traefik');
  });

  it('handles image without tag (no version)', async () => {
    docker = createMockDocker([
      createMockContainer('traefik-no-tag', {
        image: 'traefik',
        ports: [{ PublicPort: 80 }],
        labels: {},
      }),
    ]);

    const result = await detectReverseProxy(docker);

    expect(result.type).toBe('traefik');
    expect(result.version).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// switchToExternalMode Tests
// ---------------------------------------------------------------------------

describe('switchToExternalMode', () => {
  let docker: Docker;
  let mockRemoveContainer: ReturnType<typeof vi.fn>;
  let mockSafeRemoveContainer: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRemoveContainer = vi.fn().mockResolvedValue(undefined);
    mockSafeRemoveContainer = vi.fn().mockResolvedValue(undefined);
    docker = {
      removeContainer: mockRemoveContainer,
      safeRemoveContainer: mockSafeRemoveContainer,
    } as unknown as Docker;
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('calls removeContainer for managed Traefik', async () => {
    await switchToExternalMode(docker, 'external-network');

    expect(mockSafeRemoveContainer).toHaveBeenCalledWith('traefik-ol');
  });

  it('does not throw if container does not exist', async () => {
    mockSafeRemoveContainer.mockRejectedValue(new Error('container not found'));

    // Should complete without throwing (error is caught internally)
    await switchToExternalMode(docker, 'external-network');
    expect(mockSafeRemoveContainer).toHaveBeenCalledWith('traefik-ol');
  });
});

// ---------------------------------------------------------------------------
// getProxyWarning Tests
// ---------------------------------------------------------------------------

describe('getProxyWarning', () => {
  it('returns undefined for no proxy', () => {
    const detection: ProxyDetection = { type: 'none', ports: [] };
    expect(getProxyWarning(detection)).toBeUndefined();
  });

  it('returns undefined for Traefik with Docker provider enabled', () => {
    const detection: ProxyDetection = {
      type: 'traefik',
      container: 'my-traefik',
      ports: [80],
      traefikDockerProvider: true,
    };
    expect(getProxyWarning(detection)).toBeUndefined();
  });

  it('returns warning for Traefik with Docker provider disabled', () => {
    const detection: ProxyDetection = {
      type: 'traefik',
      container: 'my-traefik',
      ports: [80],
      traefikDockerProvider: false,
    };
    const warning = getProxyWarning(detection);

    expect(warning).toContain('Traefik detected');
    expect(warning).toContain('Docker provider is not enabled');
    expect(warning).toContain('--providers.docker=true');
  });

  it('returns warning for Nginx', () => {
    const detection: ProxyDetection = {
      type: 'nginx',
      container: 'nginx-proxy',
      ports: [80],
      version: '1.25',
    };
    const warning = getProxyWarning(detection);

    expect(warning).toContain('Nginx');
    expect(warning).toContain('1.25');
    expect(warning).toContain('not automatically configure');
  });

  it('returns warning for Caddy', () => {
    const detection: ProxyDetection = {
      type: 'caddy',
      container: 'caddy-server',
      ports: [80],
      version: '2.7',
    };
    const warning = getProxyWarning(detection);

    expect(warning).toContain('Caddy');
    expect(warning).toContain('2.7');
  });

  it('returns warning for HAProxy', () => {
    const detection: ProxyDetection = {
      type: 'haproxy',
      container: 'haproxy-lb',
      ports: [80],
    };
    const warning = getProxyWarning(detection);

    expect(warning).toContain('HAProxy');
  });
});

// ---------------------------------------------------------------------------
// getProxyStatus Tests
// ---------------------------------------------------------------------------

describe('getProxyStatus', () => {
  it('returns message for no proxy in managed mode', () => {
    const detection: ProxyDetection = { type: 'none', ports: [] };
    const status = getProxyStatus(detection, 'managed');

    expect(status).toContain('No reverse proxy detected');
    expect(status).toContain('OpenLander will start Traefik');
  });

  it('returns message for no proxy in external mode', () => {
    const detection: ProxyDetection = { type: 'none', ports: [] };
    const status = getProxyStatus(detection, 'external');

    expect(status).toContain('No reverse proxy detected');
    expect(status).toContain('external mode may not work');
  });

  it('returns status for managed Traefik', () => {
    const detection: ProxyDetection = {
      type: 'traefik',
      container: 'openlander-traefik',
      ports: [80],
      version: 'v3.3',
      traefikDockerProvider: true,
    };
    const status = getProxyStatus(detection, 'managed');

    expect(status).toContain('Traefik');
    expect(status).toContain('v3.3');
    expect(status).toContain('managed mode');
    expect(status).not.toContain('Docker provider disabled');
  });

  it('returns status for external Traefik', () => {
    const detection: ProxyDetection = {
      type: 'traefik',
      container: 'my-traefik',
      ports: [80],
      version: '2.10',
      traefikDockerProvider: true,
    };
    const status = getProxyStatus(detection, 'external');

    expect(status).toContain('Traefik');
    expect(status).toContain('2.10');
    expect(status).toContain('external mode');
  });

  it('includes warning for Traefik with disabled Docker provider', () => {
    const detection: ProxyDetection = {
      type: 'traefik',
      container: 'my-traefik',
      ports: [80],
      traefikDockerProvider: false,
    };
    const status = getProxyStatus(detection, 'external');

    expect(status).toContain('Docker provider disabled');
  });

  it('returns status for non-Traefik proxy', () => {
    const detection: ProxyDetection = {
      type: 'nginx',
      container: 'nginx-proxy',
      ports: [80],
      version: '1.25',
    };
    const status = getProxyStatus(detection, 'managed');

    expect(status).toContain('Nginx');
    expect(status).toContain('1.25');
    expect(status).toContain('not integrated');
  });
});

// ---------------------------------------------------------------------------
// TraefikManager Basic Tests
// ---------------------------------------------------------------------------

describe('TraefikManager', () => {
  it('exports TraefikManager class', () => {
    // Just verify the class is exported and can be instantiated
    const mockDocker = createMockDocker();
    const manager = new TraefikManager(mockDocker);
    expect(manager).toBeDefined();
  });
});
