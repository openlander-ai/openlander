import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

import type { AppContext } from '../../src/app.js';
import { createProjectRoutes } from '../../src/web/api/project-routes.js';
import type { ProjectRow } from '../../src/db/types.js';

function makeProjectRow(overrides: Partial<ProjectRow> = {}): ProjectRow {
  return {
    id: 'proj-1',
    name: 'workspace',
    archived_at: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    server_id: 'local',
    deploy_lock_session: null,
    deploy_lock_at: null,
    container_id: null,
    ...overrides,
  };
}

function createTestApp(options: {
  existingProject?: ProjectRow;
  createProjectResult?: ProjectRow;
  createProjectGroupResult?: ProjectRow;
}) {
  const db = {
    getProjectByName: vi.fn(async () => options.existingProject),
    createProject: vi.fn(async () => options.createProjectResult ?? makeProjectRow()),
    createProjectGroup: vi.fn(async () => options.createProjectGroupResult ?? makeProjectRow()),
  };

  const app = new Hono();
  app.route('/api', createProjectRoutes({ db } as unknown as AppContext));
  return { app, db };
}

describe('POST /api/projects group creation', () => {
  it('creates a project group when only a name is provided', async () => {
    const { app, db } = createTestApp({
      createProjectGroupResult: makeProjectRow({ id: 'group-1', name: 'hotdeal-tracker' }),
    });

    const res = await app.request('/api/projects', {
      method: 'POST',
      body: JSON.stringify({ name: 'hotdeal-tracker' }),
      headers: { 'content-type': 'application/json' },
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      project: { id: 'group-1', name: 'hotdeal-tracker', status: 'idle' },
    });
    expect(db.createProjectGroup).toHaveBeenCalledWith({
      id: expect.any(String),
      name: 'hotdeal-tracker',
    });
    expect(db.createProject).not.toHaveBeenCalled();
  });

  it('rejects project-level source fields when repo_url is provided', async () => {
    const { app, db } = createTestApp({
      createProjectResult: makeProjectRow({
        id: 'repo-1',
        name: 'repo-app',
        status: 'stopped',
      }),
    });

    const res = await app.request('/api/projects', {
      method: 'POST',
      body: JSON.stringify({
        repo_url: ' https://github.com/acme/repo-app.git ',
        branch: ' main ',
      }),
      headers: { 'content-type': 'application/json' },
    });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: 'PROJECT_SOURCE_REMOVED',
      code: 'PROJECT_SOURCE_REMOVED',
    });
    expect(db.createProject).not.toHaveBeenCalled();
    expect(db.createProjectGroup).not.toHaveBeenCalled();
  });

  it('rejects an empty body because group creation needs a name', async () => {
    const { app, db } = createTestApp({});

    const res = await app.request('/api/projects', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'content-type': 'application/json' },
    });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: 'MISSING_FIELD',
    });
    expect(db.createProject).not.toHaveBeenCalled();
    expect(db.createProjectGroup).not.toHaveBeenCalled();
  });

  it('treats a blank repo_url as group creation when name is present', async () => {
    const { app, db } = createTestApp({
      createProjectGroupResult: makeProjectRow({ id: 'group-2', name: 'manual-group' }),
    });

    const res = await app.request('/api/projects', {
      method: 'POST',
      body: JSON.stringify({ name: 'manual-group', repo_url: '   ' }),
      headers: { 'content-type': 'application/json' },
    });

    expect(res.status).toBe(200);
    expect(db.createProjectGroup).toHaveBeenCalledWith({
      id: expect.any(String),
      name: 'manual-group',
    });
    expect(db.createProject).not.toHaveBeenCalled();
  });
});
