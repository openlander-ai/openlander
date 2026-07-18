import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import type { AppContext } from '../src/app.js';
import { GitHubRepoAccessError, OpenLanderError } from '../src/errors.js';
import { createGitProvider } from '../src/git-providers/index.js';
import { registerCompositeMcpTools } from '../src/tools/adapters/mcp.js';
import type { ToolDef } from '../src/tools/defs/types.js';
import { createSystemRoutes } from '../src/web/api/system-routes.js';

vi.mock('../src/git-providers/index.js', () => ({
  createGitProvider: vi.fn(),
}));

function appCtx(): AppContext {
  return {
    config: {
      gitProviders: {
        github: { token: 'secret-token', username: 'octocat', authMethod: 'oauth' },
      },
      server: { port: 10114, host: '0.0.0.0', baseUrl: 'http://localhost:10114' },
      mcp: {
        enabled: true,
        transport: 'stdio',
        instanceId: 'olinst_test',
        instanceName: 'ol-test',
        servers: [],
        platformTools: true,
      },
    },
  } as AppContext;
}

function accessError(): GitHubRepoAccessError {
  return new GitHubRepoAccessError(
    'https://github.com/acme/private-repo',
    'oauth',
    'sso_required',
    { authorizeUrl: 'https://github.com/orgs/acme/sso?authorization_request=abc' },
  );
}

describe('GitHub repository access error contract', () => {
  it('serializes the shared code and details through the HTTP boundary', async () => {
    vi.mocked(createGitProvider).mockReturnValue({
      searchRepos: vi.fn(async () => Promise.reject(accessError())),
    } as unknown as ReturnType<typeof createGitProvider>);

    const app = new Hono();
    app.onError((error, c) => {
      if (error instanceof OpenLanderError) {
        return c.json(error.toJSON(), error.statusCode as 403);
      }
      throw error;
    });
    app.route('/api', createSystemRoutes(appCtx()));

    const res = await app.request('/api/repos/search?q=acme/private-repo');

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({
      error: 'GITHUB_REPO_ACCESS_DENIED',
      code: 'GITHUB_REPO_ACCESS_DENIED',
      details: {
        reason: 'sso_required',
        repoUrl: 'https://github.com/acme/private-repo',
        authMethod: 'oauth',
        authorizeUrl: 'https://github.com/orgs/acme/sso?authorization_request=abc',
      },
    });
  });

  it('serializes the same code and details through the MCP boundary', async () => {
    const handlers = new Map<
      unknown,
      (request: { params: { name: string; arguments?: unknown } }) => unknown
    >();
    const tool: ToolDef = {
      name: 'github_access_contract_test',
      description: 'Test-only GitHub access tool.',
      riskLevel: 'low',
      targets: ['mcp'],
      inputSchema: z.object({}),
      execute: () => {
        throw accessError();
      },
    };

    registerCompositeMcpTools(
      {
        setRequestHandler(schema, handler) {
          handlers.set(schema, handler);
        },
      },
      [],
      [tool],
      appCtx(),
    );

    const handler = handlers.get(CallToolRequestSchema);
    const result = (await handler?.({
      params: { name: tool.name, arguments: {} },
    })) as { content: Array<{ text: string }>; isError: true };
    const payload = JSON.parse(result.content[0]?.text ?? '{}') as Record<string, unknown>;

    expect(result.isError).toBe(true);
    expect(payload).toMatchObject({
      error: 'GITHUB_REPO_ACCESS_DENIED',
      code: 'GITHUB_REPO_ACCESS_DENIED',
      details: {
        reason: 'sso_required',
        repoUrl: 'https://github.com/acme/private-repo',
        authMethod: 'oauth',
        authorizeUrl: 'https://github.com/orgs/acme/sso?authorization_request=abc',
      },
    });
    expect(JSON.stringify(payload)).not.toContain('secret-token');
  });
});
