import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import type { AppContext } from '../../src/app.js';
import { createProjectCompatRoutes } from '../../src/web/api/project-compat-routes.js';

function createApp(ctx: Partial<AppContext> = {}) {
  const app = new Hono();
  app.route('/api', createProjectCompatRoutes(ctx as AppContext));
  return app;
}

describe('createProjectCompatRoutes', () => {
  it('keeps project-level runtime actions removed with replacement hints', async () => {
    const app = createApp();

    const res = await app.request('/api/projects/group-1/redeploy', { method: 'POST' });

    expect(res.status).toBe(410);
    await expect(res.json()).resolves.toMatchObject({
      error: 'PROJECT_RUNTIME_ACTION_REMOVED',
      code: 'PROJECT_RUNTIME_ACTION_REMOVED',
      replacement: 'POST /api/projects/:projectId/services/:serviceId/deploy',
    });
  });

  it('keeps project-level webhooks disabled', async () => {
    const app = createApp();

    const res = await app.request('/api/projects/group-1/webhooks');

    expect(res.status).toBe(410);
    await expect(res.json()).resolves.toMatchObject({
      error: 'FEATURE_DISABLED',
    });
  });

  it('validates question replies before resolving the bridge', async () => {
    const reply = vi.fn();
    const app = createApp({
      questionBridge: {
        hasPending: vi.fn(() => true),
        reply,
      },
    });

    const res = await app.request('/api/question/reply', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        request_id: 'question-1',
        answers: [{ questionIndex: 0, selectedLabels: ['Use Dockerfile'], customText: 'ok' }],
      }),
    });

    expect(res.status).toBe(200);
    expect(reply).toHaveBeenCalledWith('question-1', [
      { questionIndex: 0, selectedLabels: ['Use Dockerfile'], customText: 'ok' },
    ]);
    await expect(res.json()).resolves.toEqual({ status: 'answered' });
  });

  it('returns project-level logs through the legacy compatibility endpoint', async () => {
    const project = { id: 'group-1', name: 'workspace', container_id: null, status: 'running' };
    const getProject = vi.fn(async (id: string) => (id === project.id ? project : undefined));
    const getProjectByName = vi.fn(async () => undefined);
    const getDeployableForProject = vi.fn(async () => undefined);
    const getLogs = vi.fn(async () => ['line-1', 'line-2']);
    const app = createApp({
      db: { getProject, getProjectByName, getDeployableForProject },
      pipeline: { getLogs },
    });

    const res = await app.request('/api/projects/group-1/logs?lines=2');

    expect(res.status).toBe(200);
    expect(getLogs).toHaveBeenCalledWith('group-1', 2, { timestamps: true });
    await expect(res.json()).resolves.toEqual({
      project: 'workspace',
      logs: ['line-1', 'line-2'],
    });
  });

  it('does not fabricate a service topology node for empty project groups', async () => {
    const project = { id: 'group-1', name: 'workspace', container_id: null, status: null };
    const app = createApp({
      db: {
        getProject: vi.fn(async (id: string) => (id === project.id ? project : undefined)),
        getProjectByName: vi.fn(async () => undefined),
        getDeployablesByGroup: vi.fn(async () => []),
        getComposeChildProjects: vi.fn(async () => []),
        getChildProjects: vi.fn(async () => []),
        getEnvironmentsByProject: vi.fn(async () => []),
        getDeployableForProject: vi.fn(async () => null),
        findDependenciesByProject: vi.fn(async () => []),
      },
    });

    const res = await app.request('/api/projects/group-1/topology');

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ services: [] });
  });

  it('keeps the legacy single-node topology fallback when a backing deployable exists', async () => {
    const project = { id: 'legacy-1', name: 'legacy-app', container_id: null, status: null };
    const deployable = {
      id: 'legacy-1__svc',
      name: 'legacy-app__svc',
      assigned_port: 10001,
      image_url: null,
      image_tag: 'legacy-app:latest',
      container_id: null,
      status: 'running',
    };
    const app = createApp({
      db: {
        getProject: vi.fn(async (id: string) => (id === project.id ? project : undefined)),
        getProjectByName: vi.fn(async () => undefined),
        getDeployablesByGroup: vi.fn(async () => []),
        getComposeChildProjects: vi.fn(async () => []),
        getChildProjects: vi.fn(async () => []),
        getEnvironmentsByProject: vi.fn(async () => []),
        getDeployableForProject: vi.fn(async () => deployable),
        findDependenciesByProject: vi.fn(async () => []),
        getLatestServiceMetric: vi.fn(async () => null),
      },
      docker: {
        inspectContainer: vi.fn(),
      },
    });

    const res = await app.request('/api/projects/legacy-1/topology');

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      services: [
        {
          id: 'legacy-1',
          name: 'legacy-app',
          image: 'legacy-app:latest',
          port: 10001,
          dependsOn: [],
        },
      ],
    });
  });
});
