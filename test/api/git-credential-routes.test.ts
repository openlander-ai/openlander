import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import type { AppContext } from '../../src/app.js';
import { OpenLanderError } from '../../src/errors.js';
import { createGitCredentialRoutes } from '../../src/web/api/git-credential-routes.js';

function createApp(gitCredentials: Partial<AppContext['gitCredentials']>) {
  const app = new Hono();
  app.onError((error, c) => {
    if (error instanceof OpenLanderError) {
      return c.json(error.toJSON(), error.statusCode as 400);
    }
    throw error;
  });
  app.route('/api', createGitCredentialRoutes({ gitCredentials } as AppContext));
  return app;
}

const credential = {
  id: 'gitcred_1',
  name: 'incar-app',
  provider: 'github' as const,
  auth_type: 'deploy_key' as const,
  repository_url: 'https://github.com/Team-SpaceY/incar-app',
  repository_key: 'github.com/team-spacey/incar-app',
  public_key: 'ssh-ed25519 AAAA test',
  fingerprint: 'SHA256:test',
  status: 'pending' as const,
  default_branch: null,
  last_error_code: null,
  verified_at: null,
  last_used_at: null,
  created_at: '2026-07-18T00:00:00.000Z',
  updated_at: '2026-07-18T00:00:00.000Z',
  github_setup_url: 'https://github.com/Team-SpaceY/incar-app/settings/keys',
  usage_count: 0,
  services: [],
};

describe('git credential HTTP API', () => {
  it('creates a key and returns only the public credential view', async () => {
    const create = vi.fn(async () => credential);
    const response = await createApp({ create }).request('/api/git-credentials', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        repo_url: 'git@github.com:Team-SpaceY/incar-app.git',
        name: 'incar-app',
      }),
    });

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toEqual({ credential });
    expect(JSON.stringify(body)).not.toContain('private_key');
    expect(create).toHaveBeenCalledWith({
      repoUrl: 'git@github.com:Team-SpaceY/incar-app.git',
      name: 'incar-app',
    });
  });

  it('filters lists and delegates verification and deletion', async () => {
    const list = vi.fn(async () => [credential]);
    const verify = vi.fn(async () => ({ ...credential, status: 'verified' as const }));
    const remove = vi.fn(async () => undefined);
    const app = createApp({ list, verify, remove });

    const listResponse = await app.request(
      '/api/git-credentials?repo_url=github.com%2FTeam-SpaceY%2Fincar-app&status=pending',
    );
    expect(listResponse.status).toBe(200);
    expect(list).toHaveBeenCalledWith({
      repoUrl: 'github.com/Team-SpaceY/incar-app',
      status: 'pending',
    });

    expect((await app.request('/api/git-credentials/gitcred_1/verify', { method: 'POST' })).status).toBe(
      200,
    );
    expect(verify).toHaveBeenCalledWith('gitcred_1');

    const deleteResponse = await app.request('/api/git-credentials/gitcred_1', {
      method: 'DELETE',
    });
    expect(deleteResponse.status).toBe(200);
    await expect(deleteResponse.json()).resolves.toEqual({
      status: 'deleted',
      credential_id: 'gitcred_1',
    });
  });

  it('rejects invalid input before invoking the manager', async () => {
    const create = vi.fn();
    const response = await createApp({ create }).request('/api/git-credentials', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: 'INVALID_REQUEST' });
    expect(create).not.toHaveBeenCalled();
  });
});
