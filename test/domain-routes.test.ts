import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

import type { Database, ProjectRow, ServiceRow } from '../src/db/index.js';
import { eventBus } from '../src/events/index.js';
import { createDomainRoutes } from '../src/web/api/domain-routes.js';

async function waitFor(condition: () => boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('Timed out waiting for async domain analysis');
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function createProjectRow(): ProjectRow {
  return {
    id: 'proj-1',
    name: 'demo-project',
    repo_url: null,
    branch: null,
    status: 'running',
    visibility: 'internal',
    assigned_port: null,
    container_id: null,
    image_tag: null,
    previous_image_tag: null,
    public_url: null,
    parent_project_id: null,
    dockerfile_path: null,
    docker_target: null,
    build_context: null,
    build_method: null,
    source: null,
    image_url: null,
    image_cmd: null,
    container_port: null,
    pending_fix: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    archived_at: null,
    deploy_lock_session: null,
    deploy_lock_at: null,
    access_code: null,
    access_code_iv: null,
    is_preview: 0,
    pr_number: null,
    project_type: 'web',
    health_check_strategy: null,
    health_check_path: null,
    server_id: 'local',
    recovering_started_at: null,
  };
}

function createServiceRow(projectId = 'proj-1'): ServiceRow {
  return {
    id: 'svc-1',
    project_id: projectId,
    name: 'demo-api',
    kind: 'git',
    parent_service_id: null,
    status: 'running',
    visibility: 'production',
    assigned_port: 10001,
    container_id: 'container-1',
    container_name: 'ol-svc-demo-api',
    container_port: 3000,
    image_tag: 'demo-api:latest',
    previous_image_tag: null,
    public_url: null,
    dockerfile_path: 'Dockerfile',
    docker_target: null,
    build_context: null,
    build_method: 'dockerfile',
    source: 'git',
    repo_url: 'github.com/example/demo',
    branch: 'main',
    image_url: null,
    image_cmd: null,
    pending_fix: null,
    access_code: null,
    access_code_iv: null,
    is_preview: 0,
    pr_number: null,
    project_type: 'web',
    health_check_strategy: 'http',
    health_check_path: '/',
    recovering_started_at: null,
    credentials: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    archived_at: null,
    server_id: 'local',
  };
}

type TimelineEvent = {
  projectId: string;
  type: string;
  message?: string;
  detail?: string;
  severity?: string;
  toolName?: string;
};

type DomainRouteDb = {
  getProject: ReturnType<typeof vi.fn>;
  getProjectByName: ReturnType<typeof vi.fn>;
  getService: ReturnType<typeof vi.fn>;
  createTimelineEvent: ReturnType<typeof vi.fn>;
  getTimelineEvents: ReturnType<typeof vi.fn>;
};

function createDomainRouteDb(): DomainRouteDb {
  const project = createProjectRow();
  const service = createServiceRow(project.id);
  const timelineEvents: TimelineEvent[] = [];

  return {
    getProject: vi.fn(async (id: string) => (id === project.id ? project : undefined)),
    getProjectByName: vi.fn(async (name: string) => (name === project.name ? project : undefined)),
    getService: vi.fn(async (id: string) => (id === service.id ? service : undefined)),
    createTimelineEvent: vi.fn(async (event: TimelineEvent) => {
      timelineEvents.unshift(event);
      return event;
    }),
    getTimelineEvents: vi.fn((projectId: string) =>
      timelineEvents.filter((event) => event.projectId === projectId),
    ),
  };
}

describe('createDomainRoutes', () => {
  let db: DomainRouteDb;

  const cloudflare = {
    createTunnel: vi.fn().mockResolvedValue(undefined),
    createTunnelForService: vi.fn().mockResolvedValue(undefined),
    removeTunnel: vi.fn().mockResolvedValue(undefined),
    removeTunnelForService: vi.fn().mockResolvedValue(undefined),
    listDomains: vi.fn().mockReturnValue(['api.example.com']),
    listDomainsForService: vi.fn().mockReturnValue(['api.example.com']),
  };

  const traefik = {
    start: vi.fn().mockResolvedValue(undefined),
  };

  const env = {
    setBulk: vi.fn().mockReturnValue(true),
  };

  const pipeline = {
    redeploy: vi.fn().mockResolvedValue({ success: true }),
  };

  const deployQueue = {
    acquire: vi.fn().mockResolvedValue(() => {}),
  };

  const questionBridge = {
    setActiveProject: vi.fn(),
    ask: vi.fn(),
  };

  beforeEach(() => {
    db = createDomainRouteDb();

    cloudflare.createTunnel.mockClear();
    cloudflare.createTunnelForService.mockClear();
    cloudflare.removeTunnel.mockClear();
    cloudflare.removeTunnelForService.mockClear();
    cloudflare.listDomains.mockClear();
    cloudflare.listDomainsForService.mockClear();
    traefik.start.mockClear();
    env.setBulk.mockClear();
    pipeline.redeploy.mockClear();
    questionBridge.setActiveProject.mockClear();
    questionBridge.ask.mockClear();
  });

  afterEach(() => {
    eventBus.clear();
    vi.restoreAllMocks();
  });

  it('maps domain and skips post-add analysis when agent is null', async () => {
    const app = new Hono();
    app.route(
      '/api',
      createDomainRoutes({
        db: db as unknown as Database,
        cloudflare: cloudflare as never,
        traefik: traefik as never,
        agent: null,
        env: env as never,
        pipeline: pipeline as never,
        questionBridge: questionBridge as never,
        deployQueue: deployQueue as never,
      }),
    );

    const response = await app.request('/api/projects/proj-1/domains', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain: 'https://api.example.com' }),
    });

    expect(response.status).toBe(201);
    expect(cloudflare.createTunnel).toHaveBeenCalledWith('proj-1', 'api.example.com');
    expect(questionBridge.ask).not.toHaveBeenCalled();
    expect(env.setBulk).not.toHaveBeenCalled();
    expect(pipeline.redeploy).not.toHaveBeenCalled();
  });

  it('lists service-scoped domains', async () => {
    const app = new Hono();
    app.route(
      '/api',
      createDomainRoutes({
        db: db as unknown as Database,
        cloudflare: cloudflare as never,
        traefik: traefik as never,
        agent: null,
        env: env as never,
        pipeline: pipeline as never,
        questionBridge: questionBridge as never,
        deployQueue: deployQueue as never,
      }),
    );

    const response = await app.request('/api/projects/proj-1/services/svc-1/domains');

    expect(response.status).toBe(200);
    expect(cloudflare.listDomainsForService).toHaveBeenCalledWith('svc-1');
    await expect(response.json()).resolves.toMatchObject({
      projectId: 'proj-1',
      serviceId: 'svc-1',
      count: 1,
      domains: ['api.example.com'],
    });
  });

  it('maps service-scoped domain without project post-add analysis', async () => {
    const app = new Hono();
    app.route(
      '/api',
      createDomainRoutes({
        db: db as unknown as Database,
        cloudflare: cloudflare as never,
        traefik: traefik as never,
        agent: null,
        env: env as never,
        pipeline: pipeline as never,
        questionBridge: questionBridge as never,
        deployQueue: deployQueue as never,
      }),
    );

    const response = await app.request('/api/projects/proj-1/services/svc-1/domains', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain: 'https://api.example.com/path' }),
    });

    expect(response.status).toBe(201);
    expect(cloudflare.createTunnelForService).toHaveBeenCalledWith('svc-1', 'api.example.com');
    expect(cloudflare.createTunnel).not.toHaveBeenCalled();
    expect(questionBridge.ask).not.toHaveBeenCalled();
  });

  it('removes service-scoped domain', async () => {
    const app = new Hono();
    app.route(
      '/api',
      createDomainRoutes({
        db: db as unknown as Database,
        cloudflare: cloudflare as never,
        traefik: traefik as never,
        agent: null,
        env: env as never,
        pipeline: pipeline as never,
        questionBridge: questionBridge as never,
        deployQueue: deployQueue as never,
      }),
    );

    const response = await app.request(
      '/api/projects/proj-1/services/svc-1/domains/api.example.com',
      {
        method: 'DELETE',
      },
    );

    expect(response.status).toBe(200);
    expect(cloudflare.removeTunnelForService).toHaveBeenCalledWith('svc-1', 'api.example.com');
    expect(cloudflare.removeTunnel).not.toHaveBeenCalled();
  });

  it('asks approval and redeploys when agent suggests URL env updates', async () => {
    const agentEvents: string[] = [];
    eventBus.on('agent:event', (payload) => {
      if (payload.projectId === 'proj-1') {
        agentEvents.push(payload.event.type);
      }
    });

    const agent = {
      chatStream: vi
        .fn()
        .mockImplementation(
          async (_message: string, onEvent: (event: unknown) => Promise<void>) => {
            await onEvent({ type: 'thinking' });
            await onEvent({ type: 'tool_call', toolName: 'list_env_vars', arguments: {} });
            await onEvent({
              type: 'message',
              content:
                '{"needs_env_update":true,"reason":"public URL changed","env_updates":[{"key":"NEXT_PUBLIC_APP_URL","suggested":"https://api.example.com"}]}',
            });
            await onEvent({ type: 'done' });
          },
        ),
    };

    questionBridge.ask.mockResolvedValue([
      { questionIndex: 0, selectedLabels: ['Approve and redeploy'] },
    ]);

    const app = new Hono();
    app.route(
      '/api',
      createDomainRoutes({
        db: db as unknown as Database,
        cloudflare: cloudflare as never,
        traefik: traefik as never,
        agent: agent as never,
        env: env as never,
        pipeline: pipeline as never,
        questionBridge: questionBridge as never,
        deployQueue: deployQueue as never,
      }),
    );

    const response = await app.request('/api/projects/proj-1/domains', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain: 'api.example.com' }),
    });

    expect(response.status).toBe(201);

    await waitFor(() => questionBridge.ask.mock.calls.length === 1);

    expect(agent.chatStream).toHaveBeenCalledOnce();
    expect(agentEvents).toContain('thinking');
    expect(agentEvents).toContain('tool_call');
    expect(questionBridge.setActiveProject).toHaveBeenCalledWith('proj-1');
    expect(questionBridge.setActiveProject).toHaveBeenCalledWith(null);
    expect(env.setBulk).toHaveBeenCalledWith('proj-1', {
      NEXT_PUBLIC_APP_URL: 'https://api.example.com',
    });
    expect(pipeline.redeploy).toHaveBeenCalledWith('proj-1');

    const timelineTypes = db
      .getTimelineEvents('proj-1')
      .map((event) => event.type)
      .slice(0, 12);
    expect(timelineTypes).toContain('agent_tool_call');
    expect(timelineTypes).toContain('question_pending');
  });

  it('does not ask question when AI reports no env change needed', async () => {
    const agent = {
      chatStream: vi
        .fn()
        .mockImplementation(
          async (_message: string, onEvent: (event: unknown) => Promise<void>) => {
            await onEvent({
              type: 'message',
              content:
                '{"needs_env_update":false,"reason":"no URL env var found","env_updates":[]}',
            });
            await onEvent({ type: 'done' });
          },
        ),
    };

    const app = new Hono();
    app.route(
      '/api',
      createDomainRoutes({
        db: db as unknown as Database,
        cloudflare: cloudflare as never,
        traefik: traefik as never,
        agent: agent as never,
        env: env as never,
        pipeline: pipeline as never,
        questionBridge: questionBridge as never,
        deployQueue: deployQueue as never,
      }),
    );

    const response = await app.request('/api/projects/proj-1/domains', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain: 'api.example.com' }),
    });

    expect(response.status).toBe(201);
    await waitFor(() => agent.chatStream.mock.calls.length === 1);
    expect(questionBridge.ask).not.toHaveBeenCalled();
    expect(env.setBulk).not.toHaveBeenCalled();
    expect(pipeline.redeploy).not.toHaveBeenCalled();
  });
});
