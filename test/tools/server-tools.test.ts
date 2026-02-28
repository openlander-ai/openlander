import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { AppContext } from '../../src/app.js';
import { createToolRegistry } from '../../src/tools/registry.js';
import type { Docker } from '../../src/pipeline/docker.js';
import type { Database } from '../../src/db/index.js';

// Mock Docker client for stats
const mockGetContainer = vi.fn();
const mockStats = vi.fn();
const mockGetClient = vi.fn(() => ({
  getContainer: mockGetContainer,
}));

// Mock listAllContainers
const mockListAllContainers = vi.fn();

// Mock scanUsedPorts
const mockScanUsedPorts = vi.fn();

// Mock the modules
vi.mock('../../src/pipeline/port.js', () => ({
  scanUsedPorts: () => mockScanUsedPorts(),
}));

function createMockContext(): { ctx: AppContext; docker: Docker; db: Database } {
  const docker = {
    listAllContainers: mockListAllContainers,
    getClient: mockGetClient,
  } as unknown as Docker;

  const db = {
    getUsedPorts: vi.fn().mockReturnValue([]),
  } as unknown as Database;

  const ctx = {
    config: {
      git: { sshKeyPath: '' },
    },
    docker,
    db,
    pipeline: {},
  } as unknown as AppContext;

  return { ctx, docker, db };
}

function getTool(ctx: AppContext, name: string) {
  const tool = createToolRegistry(ctx).find((entry) => entry.name === name);
  expect(tool).toBeDefined();
  return tool!;
}

describe('Server Tools (v0.0.9-5)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetContainer.mockReturnValue({
      stats: mockStats,
    });
  });

  describe('list_all_containers', () => {
    it('returns all containers when state is "all"', async () => {
      const { ctx } = createMockContext();
      const tool = getTool(ctx, 'list_all_containers');

      mockListAllContainers.mockResolvedValueOnce([
        {
          id: 'abc123',
          name: 'managed-app',
          image: 'nginx:latest',
          state: 'running',
          status: 'Up 2 hours',
          ports: [{ PublicPort: 80 }],
          labels: { 'openlander.managed': 'true' },
          managedByOpenLander: true,
          composeProject: null,
          created: Date.now(),
        },
        {
          id: 'def456',
          name: 'external-app',
          image: 'redis:latest',
          state: 'exited',
          status: 'Exited (0) 1 hour ago',
          ports: [],
          labels: {},
          managedByOpenLander: false,
          composeProject: 'myproject',
          created: Date.now(),
        },
      ]);

      const result = await tool.execute({ state: 'all' }, { target: 'agent' });

      expect(mockListAllContainers).toHaveBeenCalledOnce();
      expect(result).toEqual({
        count: 2,
        containers: expect.arrayContaining([
          expect.objectContaining({
            id: 'abc123',
            name: 'managed-app',
            managedByOpenLander: true,
          }),
          expect.objectContaining({
            id: 'def456',
            name: 'external-app',
            managedByOpenLander: false,
          }),
        ]),
      });
    });

    it('filters to running containers when state is "running"', async () => {
      const { ctx } = createMockContext();
      const tool = getTool(ctx, 'list_all_containers');

      mockListAllContainers.mockResolvedValueOnce([
        { id: '1', name: 'running-app', state: 'running', ports: [], managedByOpenLander: true },
        { id: '2', name: 'stopped-app', state: 'exited', ports: [], managedByOpenLander: false },
        {
          id: '3',
          name: 'another-running',
          state: 'running',
          ports: [],
          managedByOpenLander: false,
        },
      ]);

      const result = await tool.execute({ state: 'running' }, { target: 'agent' });

      expect(result.count).toBe(2);
      expect(result.containers).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'running-app' }),
          expect.objectContaining({ name: 'another-running' }),
        ]),
      );
    });

    it('filters to stopped containers when state is "stopped"', async () => {
      const { ctx } = createMockContext();
      const tool = getTool(ctx, 'list_all_containers');

      mockListAllContainers.mockResolvedValueOnce([
        { id: '1', name: 'running-app', state: 'running', ports: [], managedByOpenLander: true },
        { id: '2', name: 'stopped-app', state: 'exited', ports: [], managedByOpenLander: false },
        { id: '3', name: 'paused-app', state: 'paused', ports: [], managedByOpenLander: false },
      ]);

      const result = await tool.execute({ state: 'stopped' }, { target: 'agent' });

      expect(result.count).toBe(2);
      expect(result.containers).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'stopped-app' }),
          expect.objectContaining({ name: 'paused-app' }),
        ]),
      );
    });

    it('defaults to "all" when state is not provided', async () => {
      const { ctx } = createMockContext();
      const tool = getTool(ctx, 'list_all_containers');

      mockListAllContainers.mockResolvedValueOnce([
        { id: '1', name: 'app', state: 'running', ports: [], managedByOpenLander: true },
      ]);

      const result = await tool.execute({}, { target: 'agent' });

      expect(result.count).toBe(1);
    });

    it('includes composeProject in response', async () => {
      const { ctx } = createMockContext();
      const tool = getTool(ctx, 'list_all_containers');

      mockListAllContainers.mockResolvedValueOnce([
        {
          id: '1',
          name: 'web',
          state: 'running',
          ports: [],
          managedByOpenLander: false,
          composeProject: 'myapp',
        },
      ]);

      const result = await tool.execute({}, { target: 'agent' });

      expect(result.containers[0].composeProject).toBe('myapp');
    });
  });

  describe('scan_ports', () => {
    it('returns port scan result from all sources', async () => {
      const { ctx } = createMockContext();
      const tool = getTool(ctx, 'scan_ports');

      mockScanUsedPorts.mockResolvedValueOnce({
        db: [10001, 10002],
        docker: [80, 443],
        os: [3000, 5432],
        all: [80, 443, 3000, 5432, 10001, 10002],
        conflicts: [80, 443],
      });

      const result = await tool.execute({}, { target: 'agent' });

      expect(mockScanUsedPorts).toHaveBeenCalledOnce();
      expect(result).toEqual({
        db: [10001, 10002],
        docker: [80, 443],
        os: [3000, 5432],
        all: [80, 443, 3000, 5432, 10001, 10002],
        conflicts: [80, 443],
      });
    });

    it('returns empty arrays when no ports in use', async () => {
      const { ctx } = createMockContext();
      const tool = getTool(ctx, 'scan_ports');

      mockScanUsedPorts.mockResolvedValueOnce({
        db: [],
        docker: [],
        os: [],
        all: [],
        conflicts: [],
      });

      const result = await tool.execute({}, { target: 'agent' });

      expect(result.db).toEqual([]);
      expect(result.docker).toEqual([]);
      expect(result.os).toEqual([]);
      expect(result.all).toEqual([]);
      expect(result.conflicts).toEqual([]);
    });

    it('identifies conflicts with default OpenLander ports', async () => {
      const { ctx } = createMockContext();
      const tool = getTool(ctx, 'scan_ports');

      mockScanUsedPorts.mockResolvedValueOnce({
        db: [],
        docker: [80, 443, 8080],
        os: [],
        all: [80, 443, 8080],
        conflicts: [80, 443, 8080],
      });

      const result = await tool.execute({}, { target: 'agent' });

      expect(result.conflicts).toContain(80);
      expect(result.conflicts).toContain(443);
      expect(result.conflicts).toContain(8080);
    });
  });

  describe('get_container_stats', () => {
    it('returns formatted stats for a container', async () => {
      const { ctx } = createMockContext();
      const tool = getTool(ctx, 'get_container_stats');

      mockStats.mockResolvedValueOnce({
        cpu_stats: {
          cpu_usage: {
            total_usage: 2000000000,
            percpu_usage: [1000000000, 1000000000],
          },
          system_cpu_usage: 10000000000,
        },
        precpu_stats: {
          cpu_usage: {
            total_usage: 1000000000,
            percpu_usage: [500000000, 500000000],
          },
          system_cpu_usage: 5000000000,
        },
        memory_stats: {
          usage: 268435456, // 256 MB
          limit: 1073741824, // 1 GB
        },
        networks: {
          eth0: {
            rx_bytes: 1048576, // 1 MB
            tx_bytes: 2097152, // 2 MB
          },
        },
      });

      const result = await tool.execute({ container: 'my-container' }, { target: 'agent' });

      expect(mockGetClient).toHaveBeenCalledOnce();
      expect(mockGetContainer).toHaveBeenCalledWith('my-container');
      expect(mockStats).toHaveBeenCalledWith({ stream: false });

      expect(result).toEqual(
        expect.objectContaining({
          container: 'my-container',
          cpuPercent: expect.any(Number),
          memoryMB: 256,
          memoryPercent: expect.any(Number),
          networkRxMB: 1,
          networkTxMB: 2,
        }),
      );
    });

    it('handles missing networks gracefully', async () => {
      const { ctx } = createMockContext();
      const tool = getTool(ctx, 'get_container_stats');

      mockStats.mockResolvedValueOnce({
        cpu_stats: {
          cpu_usage: { total_usage: 100, percpu_usage: [100] },
          system_cpu_usage: 1000,
        },
        precpu_stats: {
          cpu_usage: { total_usage: 0, percpu_usage: [0] },
          system_cpu_usage: 0,
        },
        memory_stats: { usage: 0, limit: 1 },
        networks: undefined,
      });

      const result = await tool.execute({ container: 'test' }, { target: 'agent' });

      expect(result.networkRxMB).toBe(0);
      expect(result.networkTxMB).toBe(0);
    });

    it('returns error for non-existent container', async () => {
      const { ctx } = createMockContext();
      const tool = getTool(ctx, 'get_container_stats');

      mockStats.mockRejectedValueOnce(new Error('No such container: missing-container'));

      const result = await tool.execute({ container: 'missing-container' }, { target: 'agent' });

      expect(result).toEqual({
        error: 'Container "missing-container" not found.',
      });
    });

    it('returns error for other failures', async () => {
      const { ctx } = createMockContext();
      const tool = getTool(ctx, 'get_container_stats');

      mockStats.mockRejectedValueOnce(new Error('Docker daemon not responding'));

      const result = await tool.execute({ container: 'my-container' }, { target: 'agent' });

      expect(result).toEqual({
        error: 'Failed to get stats: Docker daemon not responding',
      });
    });

    it('handles container ID with leading slash', async () => {
      const { ctx } = createMockContext();
      const tool = getTool(ctx, 'get_container_stats');

      mockStats.mockResolvedValueOnce({
        cpu_stats: {
          cpu_usage: { total_usage: 100, percpu_usage: [100] },
          system_cpu_usage: 1000,
        },
        precpu_stats: {
          cpu_usage: { total_usage: 0, percpu_usage: [0] },
          system_cpu_usage: 0,
        },
        memory_stats: { usage: 0, limit: 1 },
        networks: {},
      });

      await tool.execute({ container: '/my-container' }, { target: 'agent' });

      expect(mockGetContainer).toHaveBeenCalledWith('/my-container');
    });
  });

  describe('Tool Registry Integration', () => {
    it('includes all 3 new tools in registry', () => {
      const { ctx } = createMockContext();
      const tools = createToolRegistry(ctx);
      const names = tools.map((t) => t.name);

      expect(names).toContain('list_all_containers');
      expect(names).toContain('scan_ports');
      expect(names).toContain('get_container_stats');
    });

    it('tools have valid schemas', () => {
      const { ctx } = createMockContext();
      const tools = createToolRegistry(ctx);

      for (const name of ['list_all_containers', 'scan_ports', 'get_container_stats']) {
        const tool = tools.find((t) => t.name === name);
        expect(tool).toBeDefined();
        expect(tool!.description.length).toBeGreaterThan(0);
        expect(typeof tool!.execute).toBe('function');
      }
    });

    it('validates list_all_containers schema', () => {
      const { ctx } = createMockContext();
      const tool = getTool(ctx, 'list_all_containers');

      // Valid inputs
      expect(tool.inputSchema.safeParse({}).success).toBe(true);
      expect(tool.inputSchema.safeParse({ state: 'all' }).success).toBe(true);
      expect(tool.inputSchema.safeParse({ state: 'running' }).success).toBe(true);
      expect(tool.inputSchema.safeParse({ state: 'stopped' }).success).toBe(true);

      // Invalid input
      expect(tool.inputSchema.safeParse({ state: 'invalid' }).success).toBe(false);
    });

    it('validates get_container_stats schema', () => {
      const { ctx } = createMockContext();
      const tool = getTool(ctx, 'get_container_stats');

      // Valid input
      expect(tool.inputSchema.safeParse({ container: 'my-container' }).success).toBe(true);

      // Missing required field
      expect(tool.inputSchema.safeParse({}).success).toBe(false);
    });
  });
});
