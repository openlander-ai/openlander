import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { Docker, type AllContainerInfo } from '../src/pipeline/docker.js';

// Create a mock listContainers function
const mockListContainers = vi.fn();

// Mock dockerode module
vi.mock('dockerode', () => ({
  default: vi.fn(function (this: Record<string, unknown>) {
    this.ping = vi.fn().mockResolvedValue('OK');
    this.listContainers = mockListContainers;
  }),
}));

// ---------------------------------------------------------------------------
// Test Data
// ---------------------------------------------------------------------------

const createMockContainer = (
  id: string,
  name: string,
  options: {
    image?: string;
    state?: string;
    status?: string;
    ports?: Array<{ IP?: string; PrivatePort?: number; PublicPort?: number; Type?: string }>;
    labels?: Record<string, string>;
    created?: number;
  } = {},
) => ({
  Id: id,
  Names: [`/${name}`],
  Image: options.image ?? 'test-image:latest',
  State: options.state ?? 'running',
  Status: options.status ?? 'Up 2 hours',
  Ports: options.ports ?? [],
  Labels: options.labels ?? {},
  Created: options.created ?? Date.now(),
});

// ---------------------------------------------------------------------------
// listAllContainers Tests
// ---------------------------------------------------------------------------

describe('listAllContainers', () => {
  let docker: Docker;

  beforeEach(() => {
    vi.clearAllMocks();
    docker = new Docker();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });
  it('returns all containers without label filter', async () => {
    const mockContainers = [
      createMockContainer('abc123', 'managed-app', {
        labels: { 'openlander.managed': 'true' },
      }),
      createMockContainer('def456', 'external-app', {
        labels: {},
      }),
    ];

    mockListContainers.mockResolvedValueOnce(mockContainers);

    const result = await docker.listAllContainers();

    expect(mockListContainers).toHaveBeenCalledWith({ all: true });
    expect(result).toHaveLength(2);
  });

  it('marks managed containers correctly with managedByOpenLander field', async () => {
    const mockContainers = [
      createMockContainer('abc123', 'managed-app', {
        labels: { 'openlander.managed': 'true' },
      }),
      createMockContainer('def456', 'external-app', {
        labels: {},
      }),
      createMockContainer('ghi789', 'another-managed', {
        labels: { 'openlander.managed': 'true', other: 'value' },
      }),
    ];

    mockListContainers.mockResolvedValueOnce(mockContainers);

    const result = await docker.listAllContainers();

    expect(result[0].managedByOpenLander).toBe(true);
    expect(result[1].managedByOpenLander).toBe(false);
    expect(result[2].managedByOpenLander).toBe(true);
  });

  it('identifies compose groups with composeProject field', async () => {
    const mockContainers = [
      createMockContainer('abc123', 'compose-app-web', {
        labels: { 'com.docker.compose.project': 'myproject' },
      }),
      createMockContainer('def456', 'compose-app-db', {
        labels: { 'com.docker.compose.project': 'myproject' },
      }),
      createMockContainer('ghi789', 'standalone-app', {
        labels: {},
      }),
    ];

    mockListContainers.mockResolvedValueOnce(mockContainers);

    const result = await docker.listAllContainers();

    expect(result[0].composeProject).toBe('myproject');
    expect(result[1].composeProject).toBe('myproject');
    expect(result[2].composeProject).toBeNull();
  });

  it('returns empty array when no containers exist', async () => {
    mockListContainers.mockResolvedValueOnce([]);

    const result = await docker.listAllContainers();

    expect(result).toEqual([]);
  });

  it('returns empty array when Docker API throws an error', async () => {
    mockListContainers.mockRejectedValueOnce(new Error('Docker daemon not running'));

    const result = await docker.listAllContainers();

    expect(result).toEqual([]);
  });

  it('maps container fields correctly', async () => {
    const mockContainer = createMockContainer('abc123def456', 'my-container', {
      image: 'nginx:1.21',
      state: 'running',
      status: 'Up 3 days',
      ports: [{ IP: '0.0.0.0', PrivatePort: 80, PublicPort: 8080, Type: 'tcp' }],
      labels: { 'openlander.managed': 'true', custom: 'label' },
      created: 1700000000,
    });

    mockListContainers.mockResolvedValueOnce([mockContainer]);

    const result = await docker.listAllContainers();
    const container = result[0];

    expect(container.id).toBe('abc123def456');
    expect(container.name).toBe('my-container');
    expect(container.image).toBe('nginx:1.21');
    expect(container.state).toBe('running');
    expect(container.status).toBe('Up 3 days');
    expect(container.ports).toEqual([
      { IP: '0.0.0.0', PrivatePort: 80, PublicPort: 8080, Type: 'tcp' },
    ]);
    expect(container.labels).toEqual({ 'openlander.managed': 'true', custom: 'label' });
    expect(container.managedByOpenLander).toBe(true);
    expect(container.created).toBe(1700000000);
  });

  it('handles containers with empty Labels', async () => {
    const mockContainer = createMockContainer('abc123', 'test', {
      labels: {},
    });
    // Simulate dockerode returning undefined Labels
    (mockContainer as { Labels: Record<string, string> | undefined }).Labels = undefined;

    mockListContainers.mockResolvedValueOnce([mockContainer]);

    const result = await docker.listAllContainers();

    expect(result[0].labels).toEqual({});
    expect(result[0].managedByOpenLander).toBe(false);
    expect(result[0].composeProject).toBeNull();
  });

  it('handles containers with empty Names array', async () => {
    const mockContainer = createMockContainer('abc123', 'test');
    (mockContainer as { Names: string[] }).Names = [];

    mockListContainers.mockResolvedValueOnce([mockContainer]);

    const result = await docker.listAllContainers();

    expect(result[0].name).toBe('unknown');
  });

  it('handles mixed managed/unmanaged containers with compose projects', async () => {
    const mockContainers = [
      // OpenLander managed container
      createMockContainer('ol-001', 'frontend', {
        image: 'myapp-frontend:latest',
        state: 'running',
        ports: [{ PublicPort: 10001 }],
        labels: { 'openlander.managed': 'true', 'openlander.project': 'frontend' },
      }),
      // External compose project container
      createMockContainer('ext-001', 'nginx-proxy', {
        image: 'nginx:alpine',
        state: 'running',
        ports: [{ PublicPort: 80 }, { PublicPort: 443 }],
        labels: { 'com.docker.compose.project': 'webstack' },
      }),
      // Another external compose project
      createMockContainer('ext-002', 'postgres-db', {
        image: 'postgres:15',
        state: 'running',
        ports: [{ PublicPort: 5432 }],
        labels: { 'com.docker.compose.project': 'webstack' },
      }),
      // Standalone container
      createMockContainer('std-001', 'my-test-server', {
        image: 'node:18',
        state: 'exited',
        status: 'Exited (0) 2 hours ago',
        labels: {},
      }),
    ];

    mockListContainers.mockResolvedValueOnce(mockContainers);

    const result = await docker.listAllContainers();

    expect(result).toHaveLength(4);

    // Verify managed status
    const managed = result.filter((c) => c.managedByOpenLander);
    const unmanaged = result.filter((c) => !c.managedByOpenLander);
    expect(managed).toHaveLength(1);
    expect(unmanaged).toHaveLength(3);

    // Verify compose project grouping
    const webstackContainers = result.filter((c) => c.composeProject === 'webstack');
    expect(webstackContainers).toHaveLength(2);

    // Verify state
    const running = result.filter((c) => c.state === 'running');
    const exited = result.filter((c) => c.state === 'exited');
    expect(running).toHaveLength(3);
    expect(exited).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Type Export Tests
// ---------------------------------------------------------------------------

describe('AllContainerInfo type', () => {
  it('exports AllContainerInfo interface', () => {
    // This is a compile-time check - if it compiles, the type is exported
    const containerInfo: AllContainerInfo = {
      id: 'test-id',
      name: 'test-name',
      image: 'test-image',
      state: 'running',
      status: 'Up 1 hour',
      ports: [],
      labels: {},
      managedByOpenLander: false,
      composeProject: null,
      created: Date.now(),
    };
    expect(containerInfo).toBeDefined();
  });
});
