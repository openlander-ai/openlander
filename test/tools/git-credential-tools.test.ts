import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AppContext } from '../../src/app.js';
import * as configModule from '../../src/config/index.js';
import { gitToolDefs } from '../../src/tools/defs/git.js';

function tool(name: string) {
  const definition = gitToolDefs.find((candidate) => candidate.name === name);
  expect(definition).toBeDefined();
  return definition!;
}

function context(gitCredentials: Record<string, unknown>) {
  return { target: 'mcp' as const, appCtx: { gitCredentials } as unknown as AppContext };
}

describe('Git credential MCP actions', () => {
  afterEach(() => vi.restoreAllMocks());

  it('exposes the requested risk levels and sanitized manager operations', async () => {
    expect(tool('create_git_deploy_key').riskLevel).toBe('medium');
    expect(tool('list_git_credentials').riskLevel).toBe('low');
    expect(tool('verify_git_credential').riskLevel).toBe('low');
    expect(tool('remove_git_credential').riskLevel).toBe('high');

    const credential = {
      id: 'gitcred_1',
      public_key: 'ssh-ed25519 AAAA',
      status: 'pending',
    };
    const gitCredentials = {
      create: vi.fn(async () => credential),
      list: vi.fn(async () => [credential]),
      verify: vi.fn(async () => ({ ...credential, status: 'verified' })),
      remove: vi.fn(async () => undefined),
    };
    const ctx = context(gitCredentials);

    await expect(
      tool('create_git_deploy_key').execute(
        { repo_url: 'github.com/Team-SpaceY/incar-app' },
        ctx,
      ),
    ).resolves.toMatchObject({ credential: { id: 'gitcred_1' } });
    await tool('list_git_credentials').execute({}, ctx);
    await tool('verify_git_credential').execute({ credential_id: 'gitcred_1' }, ctx);
    await tool('remove_git_credential').execute({ credential_id: 'gitcred_1' }, ctx);

    expect(gitCredentials.create).toHaveBeenCalledWith({
      repoUrl: 'github.com/Team-SpaceY/incar-app',
      name: undefined,
    });
    expect(gitCredentials.remove).toHaveBeenCalledWith('gitcred_1');
  });

  it('lists verified Deploy Key repositories even without GitHub OAuth', async () => {
    vi.spyOn(configModule, 'loadConfig').mockReturnValue({
      gitProviders: { github: { token: '' } },
    } as ReturnType<typeof configModule.loadConfig>);
    const gitCredentials = {
      list: vi.fn(async () => [
        {
          id: 'gitcred_1',
          repository_url: 'https://github.com/Team-SpaceY/incar-app',
          default_branch: 'main',
          verified_at: '2026-07-18T00:00:00.000Z',
          updated_at: '2026-07-18T00:00:00.000Z',
        },
      ]),
    };

    const result = await tool('list_github_repos').execute({}, context(gitCredentials));
    expect(result).toMatchObject({
      count: 1,
      repos: [
        {
          fullName: 'Team-SpaceY/incar-app',
          cloneUrl: 'https://github.com/Team-SpaceY/incar-app',
          accessMethod: 'deploy_key',
        },
      ],
    });
  });
});
