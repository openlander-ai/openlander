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
  const originalContainerized = process.env['OPENLANDER_CONTAINERIZED'];

  afterEach(() => {
    if (originalContainerized === undefined) {
      delete process.env['OPENLANDER_CONTAINERIZED'];
    } else {
      process.env['OPENLANDER_CONTAINERIZED'] = originalContainerized;
    }
  });

  it('exports TraefikManager class', () => {
    // Just verify the class is exported and can be instantiated
    const mockDocker = createMockDocker();
    const manager = new TraefikManager(mockDocker);
    expect(manager).toBeDefined();
  });

  it('recreates legacy Traefik containers that do not expose the HTTP provider', async () => {
    const legacy = createMockContainer('legacy-traefik', {
      labels: {
        'openlander.managed': 'true',
        'openlander.role': 'traefik',
      },
    });
    const runtime = {
      listAllContainers: vi.fn(async () => [legacy]),
      inspectContainer: vi.fn(async (containerName: string) => {
        if (containerName === legacy.name) {
          return {
            Config: {
              Cmd: [
                '--api.insecure=true',
                '--providers.docker=true',
                '--providers.docker.network=openlander-prod',
              ],
            },
          };
        }
        throw new Error('container not found');
      }),
      getNetworkInfo: vi.fn(async () => ({})),
      ensureNetwork: vi.fn(async () => undefined),
      connectContainerToNetwork: vi.fn(async () => undefined),
      removeContainer: vi.fn(async () => undefined),
      pullImage: vi.fn(async () => undefined),
      runInfraContainer: vi.fn(async () => 'new-traefik'),
    } as unknown as Docker;

    const manager = new TraefikManager(runtime, 10114, { networkName: 'openlander-prod' });

    await manager.start();

    expect(runtime.inspectContainer).toHaveBeenCalledWith(legacy.name);
    expect(runtime.removeContainer).toHaveBeenCalledWith(legacy.id);
    expect(runtime.runInfraContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        Cmd: expect.arrayContaining([
          '--providers.http.endpoint=http://host.docker.internal:10114/api/traefik/config',
        ]),
        HostConfig: expect.not.objectContaining({
          Binds: expect.arrayContaining(['/var/run/docker.sock:/var/run/docker.sock:ro']),
        }),
      }),
    );
    const runCall = (runtime.runInfraContainer as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(runCall?.Cmd).not.toContain('--providers.docker=true');
    expect(runtime.connectContainerToNetwork).not.toHaveBeenCalledWith(
      legacy.name,
      expect.any(String),
    );
  });

  it('uses the OpenLander container DNS endpoint in containerized runtime', async () => {
    process.env['OPENLANDER_CONTAINERIZED'] = 'true';
    const runtime = {
      listAllContainers: vi.fn(async () => []),
      getNetworkInfo: vi.fn(async () => ({})),
      ensureNetwork: vi.fn(async () => undefined),
      connectContainerToNetwork: vi.fn(async () => undefined),
      removeContainer: vi.fn(async () => undefined),
      pullImage: vi.fn(async () => undefined),
      runInfraContainer: vi.fn(async () => 'new-traefik'),
    } as unknown as Docker;

    const manager = new TraefikManager(runtime, 10114, { networkName: 'openlander' });

    await manager.start();

    expect(runtime.runInfraContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        Cmd: expect.arrayContaining([
          '--providers.http.endpoint=http://openlander:10114/api/traefik/config',
        ]),
      }),
    );
    const runCall = (runtime.runInfraContainer as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(runCall?.Cmd).not.toContain(
      '--providers.http.endpoint=http://host.docker.internal:10114/api/traefik/config',
    );
  });

  it('recreates containerized Traefik when its HTTP provider still points at host.docker.internal', async () => {
    process.env['OPENLANDER_CONTAINERIZED'] = 'true';
    const legacy = createMockContainer('traefik-ol', {
      labels: {
        'openlander.managed': 'true',
        'openlander.role': 'traefik',
      },
      state: 'running',
    });
    const runtime = {
      listAllContainers: vi.fn(async () => [legacy]),
      inspectContainer: vi.fn(async () => ({
        Config: {
          Cmd: [
            '--api.insecure=true',
            '--providers.http.endpoint=http://host.docker.internal:10114/api/traefik/config',
            '--providers.http.pollInterval=5s',
            '--entrypoints.web.address=:80',
          ],
        },
      })),
      getNetworkInfo: vi.fn(async () => ({})),
      ensureNetwork: vi.fn(async () => undefined),
      connectContainerToNetwork: vi.fn(async () => undefined),
      removeContainer: vi.fn(async () => undefined),
      pullImage: vi.fn(async () => undefined),
      runInfraContainer: vi.fn(async () => 'new-traefik'),
    } as unknown as Docker;

    const manager = new TraefikManager(runtime, 10114, { networkName: 'openlander' });

    await manager.start();

    expect(runtime.removeContainer).toHaveBeenCalledWith(legacy.id);
    expect(runtime.runInfraContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        Cmd: expect.arrayContaining([
          '--providers.http.endpoint=http://openlander:10114/api/traefik/config',
        ]),
      }),
    );
  });

  it('connects managed Traefik to the OpenLander container network in containerized runtime', async () => {
    process.env['OPENLANDER_CONTAINERIZED'] = 'true';
    const runtime = {
      listAllContainers: vi.fn(async () => []),
      inspectContainer: vi.fn(async (containerName: string) => {
        if (containerName !== 'openlander') {
          throw new Error('container not found');
        }
        return {
          NetworkSettings: {
            Networks: {
              openlander_default: {},
            },
          },
        };
      }),
      getNetworkInfo: vi.fn(async () => ({})),
      ensureNetwork: vi.fn(async () => undefined),
      connectContainerToNetwork: vi.fn(async () => undefined),
      removeContainer: vi.fn(async () => undefined),
      pullImage: vi.fn(async () => undefined),
      runInfraContainer: vi.fn(async () => 'new-traefik'),
    } as unknown as Docker;

    const manager = new TraefikManager(runtime, 10114, { networkName: 'openlander' });

    await manager.start();

    expect(runtime.connectContainerToNetwork).toHaveBeenCalledWith('traefik-ol', 'openlander');
    expect(runtime.connectContainerToNetwork).toHaveBeenCalledWith(
      'traefik-ol',
      'openlander_default',
    );
  });

  it('connects adopted Traefik to the OpenLander container network in containerized runtime', async () => {
    process.env['OPENLANDER_CONTAINERIZED'] = 'true';
    const adopted = createMockContainer('openlander-traefik', {
      labels: {
        'openlander.managed': 'true',
        'openlander.role': 'traefik',
      },
      state: 'running',
    });
    const runtime = {
      listAllContainers: vi.fn(async () => [adopted]),
      inspectContainer: vi.fn(async (containerName: string) => {
        if (containerName === adopted.name) {
          return {
            Config: {
              Cmd: [
                '--api.insecure=true',
                '--providers.http.endpoint=http://openlander:10114/api/traefik/config',
                '--providers.http.pollInterval=5s',
                '--entrypoints.web.address=:80',
              ],
            },
          };
        }
        if (containerName === 'openlander') {
          return {
            NetworkSettings: {
              Networks: {
                openlander_default: {},
              },
            },
          };
        }
        throw new Error('container not found');
      }),
      getNetworkInfo: vi.fn(async () => ({})),
      ensureNetwork: vi.fn(async () => undefined),
      connectContainerToNetwork: vi.fn(async () => undefined),
      removeContainer: vi.fn(async () => undefined),
      pullImage: vi.fn(async () => undefined),
      runInfraContainer: vi.fn(async () => 'new-traefik'),
    } as unknown as Docker;

    const manager = new TraefikManager(runtime, 10114, { networkName: 'openlander' });

    await manager.start();

    expect(runtime.connectContainerToNetwork).toHaveBeenCalledWith(
      'openlander-traefik',
      'openlander',
    );
    expect(runtime.connectContainerToNetwork).toHaveBeenCalledWith(
      'openlander-traefik',
      'openlander_default',
    );
    expect(runtime.runInfraContainer).not.toHaveBeenCalled();
  });

  it('recreates legacy Traefik containers that still enable the Docker provider', async () => {
    const legacy = createMockContainer('legacy-traefik', {
      labels: {
        'openlander.managed': 'true',
        'openlander.role': 'traefik',
      },
    });
    const runtime = {
      listAllContainers: vi.fn(async () => [legacy]),
      inspectContainer: vi.fn(async (containerName: string) => {
        if (containerName === legacy.name) {
          return {
            Config: {
              Cmd: [
                '--api.insecure=true',
                '--providers.docker=true',
                '--providers.docker.network=openlander-prod',
                '--providers.http.endpoint=http://host.docker.internal:10114/api/traefik/config',
              ],
            },
          };
        }
        throw new Error('container not found');
      }),
      getNetworkInfo: vi.fn(async () => ({})),
      ensureNetwork: vi.fn(async () => undefined),
      connectContainerToNetwork: vi.fn(async () => undefined),
      removeContainer: vi.fn(async () => undefined),
      pullImage: vi.fn(async () => undefined),
      runInfraContainer: vi.fn(async () => 'new-traefik'),
    } as unknown as Docker;

    const manager = new TraefikManager(runtime, 10114, { networkName: 'openlander-prod' });

    await manager.start();

    expect(runtime.removeContainer).toHaveBeenCalledWith(legacy.id);
    expect(runtime.runInfraContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        Cmd: expect.not.arrayContaining(['--providers.docker=true']),
        HostConfig: expect.not.objectContaining({
          Binds: expect.arrayContaining(['/var/run/docker.sock:/var/run/docker.sock:ro']),
        }),
      }),
    );
  });

  it('adopts legacy Traefik containers only when the HTTP provider config is HTTP-only', async () => {
    const legacy = createMockContainer('legacy-traefik', {
      labels: {
        'openlander.managed': 'true',
        'openlander.role': 'traefik',
      },
    });
    const runtime = {
      listAllContainers: vi.fn(async () => [legacy]),
      inspectContainer: vi.fn(async (containerName: string) => {
        if (containerName === legacy.name) {
          return {
            Config: {
              Cmd: [
                '--api.insecure=true',
                '--providers.http.endpoint=http://host.docker.internal:10114/api/traefik/config',
              ],
            },
          };
        }
        throw new Error('container not found');
      }),
      getNetworkInfo: vi.fn(async () => ({})),
      ensureNetwork: vi.fn(async () => undefined),
      connectContainerToNetwork: vi.fn(async () => undefined),
      removeContainer: vi.fn(async () => undefined),
      pullImage: vi.fn(async () => undefined),
      runInfraContainer: vi.fn(async () => 'new-traefik'),
    } as unknown as Docker;

    const manager = new TraefikManager(runtime, 10114, { networkName: 'openlander-prod' });

    await manager.start();

    expect(runtime.connectContainerToNetwork).toHaveBeenCalledWith(legacy.name, 'openlander');
    expect(runtime.runInfraContainer).not.toHaveBeenCalled();
  });
});
