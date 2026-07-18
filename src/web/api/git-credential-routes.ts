import { Hono } from 'hono';

import type { AppContext } from '../../app.js';
import type { GitCredentialStatus } from '../../db/types.js';
import { OpenLanderError } from '../../errors.js';

const VALID_STATUSES = new Set<GitCredentialStatus>(['pending', 'verified', 'failed']);

function invalidInput(message: string, field: string): OpenLanderError {
  return new OpenLanderError(message, 'INVALID_REQUEST', 400, { field });
}

export function createGitCredentialRoutes(ctx: AppContext): Hono {
  const api = new Hono();

  api.post('/git-credentials', async (c) => {
    const body = await c.req
      .json<{ repo_url?: unknown; name?: unknown }>()
      .catch(() => ({ repo_url: undefined, name: undefined }));
    if (typeof body.repo_url !== 'string' || body.repo_url.trim().length === 0) {
      throw invalidInput('repo_url is required.', 'repo_url');
    }
    if (body.name !== undefined && typeof body.name !== 'string') {
      throw invalidInput('name must be a string.', 'name');
    }
    const credential = await ctx.gitCredentials.create({
      repoUrl: body.repo_url,
      ...(typeof body.name === 'string' ? { name: body.name } : {}),
    });
    return c.json({ credential }, 201);
  });

  api.get('/git-credentials', async (c) => {
    const repoUrl = c.req.query('repo_url');
    const statusParam = c.req.query('status');
    if (statusParam && !VALID_STATUSES.has(statusParam as GitCredentialStatus)) {
      throw invalidInput('status must be pending, verified, or failed.', 'status');
    }
    const credentials = await ctx.gitCredentials.list({
      ...(repoUrl ? { repoUrl } : {}),
      ...(statusParam ? { status: statusParam as GitCredentialStatus } : {}),
    });
    return c.json({ credentials });
  });

  api.post('/git-credentials/:id/verify', async (c) => {
    const credential = await ctx.gitCredentials.verify(c.req.param('id'));
    return c.json({ credential });
  });

  api.delete('/git-credentials/:id', async (c) => {
    const credentialId = c.req.param('id');
    await ctx.gitCredentials.remove(credentialId);
    return c.json({ status: 'deleted', credential_id: credentialId });
  });

  return api;
}
