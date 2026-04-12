import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppContext } from '../../src/app.js';
import { EventBus } from '../../src/events/index.js';
import {
  getEventBuffer,
  platformReadToolDefs,
  wireEventCapture,
} from '../../src/tools/defs/platform-read.js';

function createMockPlatformContext(overrides?: {
  containers?: Array<{
    id: string;
    name: string;
    image: string;
    status: string;
    labels?: Record<string, string>;
  }>;
  projects?: Array<{ id: string; name: string; container_id: string | null }>;
  services?: Array<{ id: string; container_id: string | null; container_name: string }>;
}) {
  const containers = overrides?.containers ?? [];
  const projects = overrides?.projects ?? [];
  const services = overrides?.services ?? [];

  const ctx = {
    config: {
      llm: { apiKey: 'llm-key', authToken: 'llm-token', model: 'gpt' },
      cloudflare: { apiToken: 'cf-token', tunnelId: 'tid' },
      gitProviders: {
        github: { token: 'gh-token', username: 'gh-user' },
        gitlab: { token: 'gl-token', username: 'gl-user' },
      },
      channels: {
        slack: { token: 'slack-token', signingSecret: 'slack-secret', enabled: true },
        discord: { token: 'discord-token', enabled: true },
        telegram: { token: 'telegram-token', webhookSecret: 'telegram-secret', enabled: true },
      },
      docker: { networkName: 'web' },
      mcp: { enabled: true },
    },
    docker: {
      listManagedContainers: vi.fn(async () => containers),
    },
    db: {
      listProjects: vi.fn(() => projects),
      listServices: vi.fn(() => services),
    },
  } as unknown as AppContext;

  return {
    ctx,
    docker: ctx.docker as unknown as { listManagedContainers: ReturnType<typeof vi.fn> },
    db: ctx.db as unknown as {
      listProjects: ReturnType<typeof vi.fn>;
      listServices: ReturnType<typeof vi.fn>;
    },
  };
}

function getTool(name: string) {
  const tool = platformReadToolDefs.find((def) => def.name === name);
  expect(tool).toBeDefined();
  return tool!;
}

describe('platform-read tools', () => {
  beforeEach(() => {
    getEventBuffer().clear();
    vi.restoreAllMocks();
  });

  it('defines exactly four MCP-only tools', () => {
    expect(platformReadToolDefs).toHaveLength(4);
    expect(platformReadToolDefs.map((tool) => tool.name)).toEqual([
      'platform_health',
      'platform_event_log',
      'platform_container_audit',
      'platform_config',
    ]);
    for (const tool of platformReadToolDefs) {
      expect(tool.targets).toEqual(['mcp']);
    }
  });

  it('platform_health returns runtime and platform counts', async () => {
    const { ctx } = createMockPlatformContext({
      containers: [
        {
          id: 'c1',
          name: 'ol-a',
          image: 'img',
          status: 'running',
          labels: { 'openlander.id': 'a' },
        },
      ],
      projects: [{ id: 'p1', name: 'app', container_id: 'c1' }],
    });

    const result = (await getTool('platform_health').execute(
      {},
      { target: 'mcp', appCtx: ctx },
    )) as {
      docker_status: string;
      db_status: string;
      managed_container_count: number;
      project_count: number;
      event_bus_buffer_size: number;
      node_version: string;
      uptime_seconds: number;
      version: string;
    };

    expect(result.docker_status).toBe('running');
    expect(result.db_status).toBe('ok');
    expect(result.managed_container_count).toBe(1);
    expect(result.project_count).toBe(1);
    expect(result.event_bus_buffer_size).toBe(0);
    expect(result.node_version).toBe(process.version);
    expect(result.uptime_seconds).toBeGreaterThanOrEqual(0);
    expect(result.version).toBeTypeOf('string');
  });

  it('platform_health marks docker_status=error when Docker throws', async () => {
    const { ctx, docker } = createMockPlatformContext();
    docker.listManagedContainers.mockRejectedValueOnce(new Error('docker unavailable'));

    const result = (await getTool('platform_health').execute(
      {},
      { target: 'mcp', appCtx: ctx },
    )) as {
      docker_status: string;
      managed_container_count: number;
    };

    expect(result.docker_status).toBe('error');
    expect(result.managed_container_count).toBe(0);
  });

  it('platform_health marks db_status=error when DB throws', async () => {
    const { ctx, db } = createMockPlatformContext();
    db.listProjects.mockImplementationOnce(() => {
      throw new Error('db unavailable');
    });

    const result = (await getTool('platform_health').execute(
      {},
      { target: 'mcp', appCtx: ctx },
    )) as {
      db_status: string;
      project_count: number;
    };

    expect(result.db_status).toBe('error');
    expect(result.project_count).toBe(0);
  });

  it('platform_event_log returns latest events using limit', async () => {
    const { ctx } = createMockPlatformContext();
    getEventBuffer().push({ type: 'deploy:start', payload: { id: 1 } });
    getEventBuffer().push({ type: 'deploy:build', payload: { id: 2 } });
    getEventBuffer().push({ type: 'deploy:success', payload: { id: 3 } });

    const result = (await getTool('platform_event_log').execute(
      { limit: 2 },
      { target: 'mcp', appCtx: ctx },
    )) as {
      count: number;
      events: Array<{ type: string }>;
    };

    expect(result.count).toBe(2);
    expect(result.events.map((event) => event.type)).toEqual(['deploy:build', 'deploy:success']);
  });

  it('platform_event_log applies prefix event_type filtering', async () => {
    const { ctx } = createMockPlatformContext();
    getEventBuffer().push({ type: 'deploy:start', payload: { id: 1 } });
    getEventBuffer().push({ type: 'deploy:failed', payload: { id: 2 } });
    getEventBuffer().push({ type: 'monitor:healthcheck', payload: { id: 3 } });

    const result = (await getTool('platform_event_log').execute(
      { event_type: 'deploy:' },
      { target: 'mcp', appCtx: ctx },
    )) as {
      count: number;
      events: Array<{ type: string }>;
    };

    expect(result.count).toBe(2);
    expect(result.events.every((event) => event.type.startsWith('deploy:'))).toBe(true);
  });

  it('platform_event_log applies since_minutes filtering', async () => {
    const { ctx } = createMockPlatformContext();
    const nowSpy = vi.spyOn(Date, 'now');
    nowSpy.mockReturnValueOnce(1_000_000);
    getEventBuffer().push({ type: 'deploy:start', payload: { old: true } });
    nowSpy.mockReturnValueOnce(2_000_000);
    getEventBuffer().push({ type: 'deploy:success', payload: { fresh: true } });
    nowSpy.mockReturnValue(2_000_000);

    const result = (await getTool('platform_event_log').execute(
      { since_minutes: 1 },
      { target: 'mcp', appCtx: ctx },
    )) as {
      count: number;
      events: Array<{ type: string }>;
    };

    expect(result.count).toBe(1);
    expect(result.events[0]?.type).toBe('deploy:success');
  });

  it('wireEventCapture stores EventBus emissions in shared buffer', async () => {
    const { ctx } = createMockPlatformContext();
    const bus = new EventBus();
    wireEventCapture(bus);

    await bus.emit('deploy:start', { projectId: 'p1', repoUrl: 'https://x.com/repo.git' });

    const result = (await getTool('platform_event_log').execute(
      {},
      { target: 'mcp', appCtx: ctx },
    )) as {
      count: number;
      events: Array<{ type: string }>;
    };

    expect(result.count).toBe(1);
    expect(result.events[0]?.type).toBe('deploy:start');
  });

  it('platform_container_audit detects orphan containers and skips infrastructure role', async () => {
    const { ctx } = createMockPlatformContext({
      containers: [
        {
          id: 'c1',
          name: 'ol-app',
          image: 'img',
          status: 'running',
          labels: { 'openlander.id': 'p1' },
        },
        {
          id: 'c2',
          name: 'ol-orphan',
          image: 'img',
          status: 'running',
          labels: { 'openlander.project': 'orphan' },
        },
        {
          id: 'c3',
          name: 'ol-traefik',
          image: 'img',
          status: 'running',
          labels: { 'openlander.role': 'proxy' },
        },
      ],
      projects: [{ id: 'p1', name: 'app', container_id: 'c1' }],
      services: [],
    });

    const result = (await getTool('platform_container_audit').execute(
      {},
      { target: 'mcp', appCtx: ctx },
    )) as {
      orphan_containers: Array<{ id: string }>;
      healthy: Array<{ project_id: string }>;
    };

    expect(result.orphan_containers.map((container) => container.id)).toEqual(['c2']);
    expect(result.healthy.map((record) => record.project_id)).toEqual(['p1']);
  });

  it('platform_container_audit detects ghost project records', async () => {
    const { ctx } = createMockPlatformContext({
      containers: [],
      projects: [{ id: 'p1', name: 'ghost-app', container_id: 'missing-container' }],
      services: [],
    });

    const result = (await getTool('platform_container_audit').execute(
      {},
      { target: 'mcp', appCtx: ctx },
    )) as {
      ghost_records: Array<{ project_id: string; container_id: string | null }>;
    };

    expect(result.ghost_records).toEqual([
      { project_id: 'p1', project_name: 'ghost-app', container_id: 'missing-container' },
    ]);
  });

  it('platform_container_audit supports project_name filter', async () => {
    const { ctx } = createMockPlatformContext({
      containers: [
        {
          id: 'c1',
          name: 'ol-app-1',
          image: 'img',
          status: 'running',
          labels: { 'openlander.id': '1' },
        },
        {
          id: 'c2',
          name: 'ol-app-2',
          image: 'img',
          status: 'running',
          labels: { 'openlander.id': '2' },
        },
      ],
      projects: [
        { id: 'p1', name: 'app-1', container_id: 'c1' },
        { id: 'p2', name: 'app-2', container_id: 'c2' },
      ],
      services: [],
    });

    const result = (await getTool('platform_container_audit').execute(
      { project_name: 'app-1' },
      { target: 'mcp', appCtx: ctx },
    )) as {
      total_db: number;
      healthy: Array<{ project_name: string }>;
    };

    expect(result.total_db).toBe(1);
    expect(result.healthy.map((item) => item.project_name)).toEqual(['app-1']);
  });

  it('platform_config redacts all required secret fields', async () => {
    const { ctx } = createMockPlatformContext();

    const result = (await getTool('platform_config').execute(
      {},
      { target: 'mcp', appCtx: ctx },
    )) as {
      llm: { apiKey: string; authToken: string };
      cloudflare: { apiToken: string };
      gitProviders: { github: { token: string }; gitlab: { token: string } };
      channels: {
        slack: { token: string; signingSecret: string };
        discord: { token: string };
        telegram: { token: string; webhookSecret: string };
      };
    };

    expect(result.llm.apiKey).toBe('***REDACTED***');
    expect(result.llm.authToken).toBe('***REDACTED***');
    expect(result.cloudflare.apiToken).toBe('***REDACTED***');
    expect(result.gitProviders.github.token).toBe('***REDACTED***');
    expect(result.gitProviders.gitlab.token).toBe('***REDACTED***');
    expect(result.channels.slack.token).toBe('***REDACTED***');
    expect(result.channels.slack.signingSecret).toBe('***REDACTED***');
    expect(result.channels.discord.token).toBe('***REDACTED***');
    expect(result.channels.telegram.token).toBe('***REDACTED***');
    expect(result.channels.telegram.webhookSecret).toBe('***REDACTED***');
  });

  it('platform_config supports top-level section filter', async () => {
    const { ctx } = createMockPlatformContext();

    const result = (await getTool('platform_config').execute(
      { section: 'llm' },
      { target: 'mcp', appCtx: ctx },
    )) as {
      llm: { apiKey: string; authToken: string; model: string };
    };

    expect(Object.keys(result)).toEqual(['llm']);
    expect(result.llm.model).toBe('gpt');
    expect(result.llm.apiKey).toBe('***REDACTED***');
  });
});
