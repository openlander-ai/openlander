import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, existsSync: vi.fn(actual.existsSync) };
});

vi.mock('../src/config/index.js', () => ({
  loadConfig: vi.fn(),
}));

import { execFile } from 'node:child_process';
import { cloneRepo } from '../src/pipeline/git.js';
import { loadConfig } from '../src/config/index.js';
import {
  setActiveGitCredentialManager,
  type GitCloneCredentialAuth,
  type GitCredentialManager,
} from '../src/git-credentials/manager.js';
import {
  GitAuthError,
  GitBranchNotFoundError,
  GitCloneError,
  GitHubRepoAccessError,
  GitNetworkUnreachableError,
  GitRepoNotFoundError,
} from '../src/errors.js';

const mockExecFile = execFile as unknown as ReturnType<typeof vi.fn>;
const mockLoadConfig = loadConfig as unknown as ReturnType<typeof vi.fn>;
const mockExistsSync = existsSync as unknown as ReturnType<typeof vi.fn>;
const describeGitClone = describe;
const originalWorkspaceDir = process.env['OPENLANDER_WORKSPACE_DIR'];
const originalFetch = global.fetch;

function githubRepo(name = 'repo') {
  return {
    name,
    full_name: `user/${name}`,
    description: null,
    html_url: `https://github.com/user/${name}`,
    clone_url: `https://github.com/user/${name}.git`,
    ssh_url: `git@github.com:user/${name}.git`,
    private: true,
    default_branch: 'main',
    language: null,
    updated_at: '2026-01-01T00:00:00Z',
    stargazers_count: 0,
  };
}

// Make promisified execFile resolve by default
beforeEach(() => {
  setActiveGitCredentialManager(null);
  mockExecFile.mockReset();
  mockLoadConfig.mockReset();
  mockExistsSync.mockReset();
  mockExistsSync.mockImplementation((path) =>
    String(path).startsWith('/home/user/.ssh/') ? true : false,
  );
  delete process.env['OPENLANDER_WORKSPACE_DIR'];
  global.fetch = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(githubRepo()), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );

  mockExecFile.mockImplementation(
    (
      _cmd: string,
      _args: string[],
      _opts: Record<string, unknown>,
      cb?: (err: Error | null, result: { stdout: string; stderr: string }) => void,
    ) => {
      // promisify(execFile) passes a callback
      if (cb) {
        cb(null, { stdout: 'abc123def456\n', stderr: '' });
      }
    },
  );

  mockLoadConfig.mockReturnValue({
    gitProviders: {
      github: { token: 'ghp_test_token_123' },
    },
  });
});

afterEach(() => {
  setActiveGitCredentialManager(null);
  global.fetch = originalFetch;
  if (originalWorkspaceDir === undefined) {
    delete process.env['OPENLANDER_WORKSPACE_DIR'];
  } else {
    process.env['OPENLANDER_WORKSPACE_DIR'] = originalWorkspaceDir;
  }
  vi.restoreAllMocks();
});

describeGitClone('cloneRepo — GitHub token injection', () => {
  it('injects token into HTTPS GitHub URLs for private repo support', async () => {
    await cloneRepo({ repoUrl: 'https://github.com/user/private-repo' });

    // git clone is the first call
    const cloneCall = mockExecFile.mock.calls[0];
    const args = cloneCall![1] as string[];

    // The URL should contain the token
    const urlArg = args.find((a: string) => a.includes('github.com'));
    expect(urlArg).toContain('x-access-token:ghp_test_token_123@github.com');
  });

  it('does not inject token when no GitHub token is configured', async () => {
    mockLoadConfig.mockReturnValue({
      gitProviders: {},
    });

    await cloneRepo({ repoUrl: 'https://github.com/user/public-repo' });

    const cloneCall = mockExecFile.mock.calls[0];
    const args = cloneCall![1] as string[];

    const urlArg = args.find((a: string) => a.includes('github.com'));
    expect(urlArg).toBe('https://github.com/user/public-repo');
    expect(urlArg).not.toContain('x-access-token');
  });

  it('uses SSH for a GitHub HTTPS URL only when no provider is connected', async () => {
    mockLoadConfig.mockReturnValue({ gitProviders: {} });

    await cloneRepo({
      repoUrl: 'https://github.com/user/private-repo',
      sshKeyPath: '/home/user/.ssh/id_ed25519',
    });

    const cloneCall = mockExecFile.mock.calls[0];
    const args = cloneCall?.[1] as string[];
    const opts = cloneCall?.[2] as { env: Record<string, string> };
    expect(args).toContain('git@github.com:user/private-repo');
    expect(args.join(' ')).not.toContain('x-access-token');
    expect(opts.env.GIT_SSH_COMMAND).toContain('/home/user/.ssh/id_ed25519');
  });

  it('prefers the connected provider over SSH for GitHub HTTPS URLs', async () => {
    await cloneRepo({
      repoUrl: 'https://github.com/user/repo',
      sshKeyPath: '/home/user/.ssh/id_rsa',
    });

    const cloneCall = mockExecFile.mock.calls[0];
    const args = cloneCall![1] as string[];

    const urlArg = args.find((a: string) => a.includes('github.com'));
    expect(urlArg).toContain('https://x-access-token:ghp_test_token_123@github.com/user/repo');
    expect(urlArg).not.toBe('git@github.com:user/repo');
  });

  it('does not inject token for non-GitHub HTTPS URLs', async () => {
    await cloneRepo({ repoUrl: 'https://gitlab.com/user/repo' });

    const cloneCall = mockExecFile.mock.calls[0];
    const args = cloneCall![1] as string[];

    const urlArg = args.find((a: string) => a.includes('gitlab.com'));
    expect(urlArg).toBe('https://gitlab.com/user/repo');
    expect(urlArg).not.toContain('x-access-token');
  });

  it('handles loadConfig throwing gracefully (proceeds without token)', async () => {
    mockLoadConfig.mockImplementation(() => {
      throw new Error('Config file not found');
    });

    await cloneRepo({ repoUrl: 'https://github.com/user/repo' });

    const cloneCall = mockExecFile.mock.calls[0];
    const args = cloneCall![1] as string[];

    const urlArg = args.find((a: string) => a.includes('github.com'));
    expect(urlArg).toBe('https://github.com/user/repo');
    expect(urlArg).not.toContain('x-access-token');
  });

  it('normalizes bare domain URLs before token injection', async () => {
    await cloneRepo({ repoUrl: 'github.com/user/repo' });

    const cloneCall = mockExecFile.mock.calls[0];
    const args = cloneCall![1] as string[];

    const urlArg = args.find((a: string) => a.includes('github.com'));
    expect(urlArg).toContain('x-access-token:ghp_test_token_123@github.com');
  });
});

describeGitClone('cloneRepo — deterministic provider authentication', () => {
  it('falls back to anonymous clone when a rejected token targets a public repo', async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: 'Bad credentials' }), { status: 401 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ...githubRepo('public-repo'), private: false }), {
          status: 200,
        }),
      );

    await cloneRepo({ repoUrl: 'https://github.com/user/public-repo' });

    const cloneArgs = mockExecFile.mock.calls[0]?.[1] as string[];
    expect(cloneArgs).toContain('https://github.com/user/public-repo');
    expect(cloneArgs.join(' ')).not.toContain('ghp_test_token_123');
    expect(global.fetch).toHaveBeenCalledTimes(2);
    const anonymousHeaders = vi.mocked(global.fetch).mock.calls[1]?.[1]?.headers as Record<
      string,
      string
    >;
    expect(anonymousHeaders['Authorization']).toBeUndefined();
  });

  it('stops before clone when organization SSO is decisively required', async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: 'SAML SSO required' }), {
          status: 403,
          headers: {
            'x-github-sso':
              'required; url=https://github.com/orgs/acme/sso?authorization_request=abc',
          },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 }),
      );

    await expect(
      cloneRepo({ repoUrl: 'https://github.com/acme/private-repo' }),
    ).rejects.toMatchObject({
      code: 'GITHUB_REPO_ACCESS_DENIED',
      details: { reason: 'sso_required' },
    });
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it.each([
    [
      'rate limit',
      new Response(JSON.stringify({ message: 'API rate limit exceeded' }), {
        status: 403,
        headers: { 'x-ratelimit-remaining': '0' },
      }),
    ],
    ['GitHub 5xx', new Response(JSON.stringify({ message: 'Unavailable' }), { status: 503 })],
  ])('continues authenticated clone when %s makes preflight inconclusive', async (_name, res) => {
    vi.mocked(global.fetch).mockResolvedValueOnce(res);

    await cloneRepo({ repoUrl: 'https://github.com/user/private-repo' });

    const cloneArgs = mockExecFile.mock.calls[0]?.[1] as string[];
    expect(cloneArgs.join(' ')).toContain('x-access-token:ghp_test_token_123@github.com');
  });

  it('continues authenticated clone when access preflight times out', async () => {
    vi.mocked(global.fetch).mockRejectedValueOnce(new DOMException('Timed out', 'TimeoutError'));

    await cloneRepo({ repoUrl: 'https://github.com/user/private-repo' });

    const cloneArgs = mockExecFile.mock.calls[0]?.[1] as string[];
    expect(cloneArgs.join(' ')).toContain('x-access-token:ghp_test_token_123@github.com');
  });

  it('does not silently retry provider authentication with SSH', async () => {
    mockExecFile.mockImplementationOnce(
      (
        _cmd: string,
        _args: string[],
        _opts: Record<string, unknown>,
        cb?: (err: Error | null, result: { stdout: string; stderr: string }) => void,
      ) => {
        cb?.(new Error('fatal: Authentication failed for https clone'), {
          stdout: '',
          stderr: '',
        });
      },
    );

    await expect(
      cloneRepo({
        repoUrl: 'https://github.com/user/private-repo',
        sshKeyPath: '/home/user/.ssh/id_ed25519',
      }),
    ).rejects.toMatchObject({
      code: 'GITHUB_REPO_ACCESS_DENIED',
      details: { reason: 'token_invalid' },
    });

    expect(mockExecFile).toHaveBeenCalledTimes(1);
    const cloneArgs = mockExecFile.mock.calls[0]?.[1] as string[];
    expect(cloneArgs.join(' ')).toContain('x-access-token:ghp_test_token_123@github.com');
    expect(cloneArgs.join(' ')).not.toContain('git@github.com');
  });

  it('preserves a typed GitHub access error when clone follows an inconclusive preflight', async () => {
    mockLoadConfig.mockReturnValue({
      gitProviders: {
        github: { token: 'ghp_test_token_123', authMethod: 'oauth' },
      },
    });
    vi.mocked(global.fetch).mockRejectedValueOnce(new DOMException('Timed out', 'TimeoutError'));
    mockExecFile.mockImplementationOnce(
      (
        _cmd: string,
        _args: string[],
        _opts: Record<string, unknown>,
        cb?: (err: Error | null, result: { stdout: string; stderr: string }) => void,
      ) => {
        cb?.(new Error('remote: Repository not found.'), { stdout: '', stderr: '' });
      },
    );

    await expect(
      cloneRepo({ repoUrl: 'https://github.com/acme/private-repo' }),
    ).rejects.toMatchObject({
      code: 'GITHUB_REPO_ACCESS_DENIED',
      details: {
        reason: 'not_found_or_not_authorized',
        repoUrl: 'https://github.com/acme/private-repo',
        authMethod: 'oauth',
      },
    });
  });

  it('redacts provider tokens from clone failures', async () => {
    mockExecFile.mockImplementationOnce(
      (
        _cmd: string,
        _args: string[],
        _opts: Record<string, unknown>,
        cb?: (err: Error | null, result: { stdout: string; stderr: string }) => void,
      ) => {
        cb?.(
          new Error(
            'fatal: transport failed for https://x-access-token:ghp_test_token_123@github.com/user/private-repo',
          ),
          { stdout: '', stderr: '' },
        );
      },
    );

    await expect(cloneRepo({ repoUrl: 'https://github.com/user/private-repo' })).rejects.toSatisfy(
      (error: unknown) => {
        return (
          error instanceof GitCloneError &&
          !error.message.includes('ghp_test_token_123') &&
          error.message.includes('https://***@github.com')
        );
      },
    );
  });

  it('does not expose GitHub provider messages in typed access-error details', async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: 'private provider diagnostic' }), { status: 401 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 }),
      );

    try {
      await cloneRepo({ repoUrl: 'https://github.com/user/private-repo' });
      throw new Error('expected clone to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(GitHubRepoAccessError);
      expect((error as GitHubRepoAccessError).details).not.toHaveProperty('providerMessage');
    }
  });

  it('does not retry when auth fails on unsupported host (no SSH conversion)', async () => {
    mockExecFile.mockImplementationOnce(
      (
        _cmd: string,
        _args: string[],
        _opts: Record<string, unknown>,
        cb?: (err: Error | null, result: { stdout: string; stderr: string }) => void,
      ) => {
        cb?.(new Error('fatal: Authentication failed for https://gitea.example.com/user/repo'), {
          stdout: '',
          stderr: '',
        });
      },
    );

    await expect(
      cloneRepo({ repoUrl: 'https://gitea.example.com/user/repo' }),
    ).rejects.toBeInstanceOf(GitAuthError);

    const firstCloneArgs = mockExecFile.mock.calls[0]?.[1] as string[];
    expect(firstCloneArgs).toContain('https://gitea.example.com/user/repo');
    expect(mockExecFile).toHaveBeenCalledTimes(1);
  });
});

describeGitClone('cloneRepo — error classification', () => {
  it.each([
    'fatal: unable to access repo: Could not resolve host: github.com',
    'ssh: connect to host github.com port 22: Network is unreachable',
    'fatal: unable to access repo: Connection reset by peer',
    'fatal: unable to access repo: Failed to connect to github.com port 443',
  ])('classifies network failures separately: %s', async (message) => {
    mockExecFile.mockImplementationOnce(
      (
        _cmd: string,
        _args: string[],
        _opts: Record<string, unknown>,
        cb?: (err: Error | null, result: { stdout: string; stderr: string }) => void,
      ) => {
        cb?.(new Error(message), { stdout: '', stderr: '' });
      },
    );

    await expect(
      cloneRepo({ repoUrl: 'git@github.com:org/private-repo.git' }),
    ).rejects.toBeInstanceOf(GitNetworkUnreachableError);
  });

  it('returns redacted retryable details for provider network failures', async () => {
    mockExecFile.mockImplementationOnce(
      (
        _cmd: string,
        _args: string[],
        _opts: Record<string, unknown>,
        cb?: (err: Error | null, result: { stdout: string; stderr: string }) => void,
      ) => {
        cb?.(
          new Error(
            'fatal: unable to access https://x-access-token:ghp_test_token_123@github.com/user/repo: Connection timed out',
          ),
          { stdout: '', stderr: '' },
        );
      },
    );

    await expect(cloneRepo({ repoUrl: 'https://github.com/user/repo' })).rejects.toMatchObject({
      code: 'GIT_NETWORK_UNREACHABLE',
      details: {
        repoUrl: 'https://github.com/user/repo',
        authMethod: 'pat',
        retryable: true,
      },
      message: expect.not.stringContaining('ghp_test_token_123'),
    });
  });

  it('preserves the configured OAuth method in network failure details', async () => {
    mockLoadConfig.mockReturnValue({
      gitProviders: {
        github: { token: 'gho_test_token_123', authMethod: 'oauth' },
      },
    });
    mockExecFile.mockImplementationOnce(
      (
        _cmd: string,
        _args: string[],
        _opts: Record<string, unknown>,
        cb?: (err: Error | null, result: { stdout: string; stderr: string }) => void,
      ) => {
        cb?.(new Error('fatal: unable to access repo: Connection timed out'), {
          stdout: '',
          stderr: '',
        });
      },
    );

    await expect(cloneRepo({ repoUrl: 'https://github.com/user/repo' })).rejects.toMatchObject({
      code: 'GIT_NETWORK_UNREACHABLE',
      details: { authMethod: 'oauth', retryable: true },
    });
  });

  it('redacts repository URL userinfo when rejecting unsafe clone input', async () => {
    mockLoadConfig.mockReturnValue({ gitProviders: {} });

    const result = cloneRepo({
      repoUrl: 'https://private-user:private-token@git.example.com/team/repo.git',
    });
    await expect(result).rejects.toMatchObject({
      code: 'UNSAFE_REPO_URL',
      details: {
        repoUrl: 'https://***@git.example.com/team/repo.git',
      },
    });
    await expect(result).rejects.not.toSatisfy((error: unknown) =>
      JSON.stringify(error).includes('private-token'),
    );
  });

  it('classifies low-level socket error codes before authentication failures', async () => {
    mockExecFile.mockImplementationOnce(
      (
        _cmd: string,
        _args: string[],
        _opts: Record<string, unknown>,
        cb?: (err: Error | null, result: { stdout: string; stderr: string }) => void,
      ) => {
        const error = Object.assign(new Error('fatal: Authentication failed'), {
          code: 'ETIMEDOUT',
        });
        cb?.(error, { stdout: '', stderr: '' });
      },
    );

    await expect(
      cloneRepo({ repoUrl: 'https://github.com/user/private-repo' }),
    ).rejects.toMatchObject({ code: 'GIT_NETWORK_UNREACHABLE' });
  });

  it('classifies a timed-out Deploy Key clone from child-process metadata', async () => {
    const manager = {
      runWithCloneCredential: vi.fn(
        async (
          _options: { repoUrl: string; credentialId?: string; serviceId?: string },
          clone: (auth: GitCloneCredentialAuth) => Promise<unknown>,
        ) =>
          await clone({
            credentialId: 'gitcred_timeout',
            cloneUrl: 'git@github.com:user/private-repo.git',
            gitSshCommand: 'ssh -F /dev/null -i /tmp/deploy_key',
          }),
      ),
    } as unknown as GitCredentialManager;
    setActiveGitCredentialManager(manager);
    mockExecFile.mockImplementationOnce(
      (
        _cmd: string,
        _args: string[],
        _opts: Record<string, unknown>,
        cb?: (err: Error | null, result: { stdout: string; stderr: string }) => void,
      ) => {
        const error = Object.assign(new Error('Command failed: git clone'), {
          code: null,
          killed: true,
          signal: 'SIGTERM',
          cmd: 'git clone',
        });
        cb?.(error, { stdout: '', stderr: '' });
      },
    );

    await expect(
      cloneRepo({
        repoUrl: 'https://github.com/user/private-repo',
        gitCredentialId: 'gitcred_timeout',
      }),
    ).rejects.toMatchObject({
      code: 'GIT_NETWORK_UNREACHABLE',
      details: {
        repoUrl: 'https://github.com/user/private-repo',
        authMethod: 'deploy_key',
        retryable: true,
      },
    });
  });

  it('falls back from GitHub SSH port 22 to port 443 only after a network failure', async () => {
    const manager = {
      runWithCloneCredential: vi.fn(
        async (
          _options: { repoUrl: string; credentialId?: string; serviceId?: string },
          clone: (auth: GitCloneCredentialAuth) => Promise<unknown>,
        ) =>
          await clone({
            credentialId: 'gitcred_fallback',
            cloneUrl: 'git@github.com:user/private-repo.git',
            gitSshCommand: 'ssh -F /dev/null -i /tmp/deploy_key',
            fallbackCloneUrl: 'ssh://git@ssh.github.com:443/user/private-repo.git',
            fallbackGitSshCommand: 'ssh -F /dev/null -i /tmp/deploy_key',
          }),
      ),
    } as unknown as GitCredentialManager;
    setActiveGitCredentialManager(manager);
    mockExecFile.mockImplementationOnce(
      (
        _cmd: string,
        _args: string[],
        _opts: Record<string, unknown>,
        cb?: (err: Error | null, result: { stdout: string; stderr: string }) => void,
      ) => {
        cb?.(new Error('ssh: connect to host github.com port 22: Connection timed out'), {
          stdout: '',
          stderr: '',
        });
      },
    );

    await expect(
      cloneRepo({
        repoUrl: 'https://github.com/user/private-repo',
        gitCredentialId: 'gitcred_fallback',
      }),
    ).resolves.toMatchObject({ gitCredentialId: 'gitcred_fallback' });

    const cloneCalls = mockExecFile.mock.calls.filter(
      (call) => (call[1] as string[])[0] === 'clone',
    );
    expect(cloneCalls).toHaveLength(2);
    expect(cloneCalls[0]?.[1]).toContain('git@github.com:user/private-repo.git');
    expect(cloneCalls[1]?.[1]).toContain('ssh://git@ssh.github.com:443/user/private-repo.git');
  });

  it('does not try the Deploy Key fallback endpoint after an authentication failure', async () => {
    const manager = {
      runWithCloneCredential: vi.fn(
        async (
          _options: { repoUrl: string; credentialId?: string; serviceId?: string },
          clone: (auth: GitCloneCredentialAuth) => Promise<unknown>,
        ) =>
          await clone({
            credentialId: 'gitcred_denied',
            cloneUrl: 'git@github.com:user/private-repo.git',
            gitSshCommand: 'ssh -F /dev/null -i /tmp/deploy_key',
            fallbackCloneUrl: 'ssh://git@ssh.github.com:443/user/private-repo.git',
            fallbackGitSshCommand: 'ssh -F /dev/null -i /tmp/deploy_key',
          }),
      ),
    } as unknown as GitCredentialManager;
    setActiveGitCredentialManager(manager);
    mockExecFile.mockImplementationOnce(
      (
        _cmd: string,
        _args: string[],
        _opts: Record<string, unknown>,
        cb?: (err: Error | null, result: { stdout: string; stderr: string }) => void,
      ) => {
        cb?.(new Error('git@github.com: Permission denied (publickey).'), {
          stdout: '',
          stderr: '',
        });
      },
    );

    await expect(
      cloneRepo({
        repoUrl: 'https://github.com/user/private-repo',
        gitCredentialId: 'gitcred_denied',
      }),
    ).rejects.toMatchObject({ code: 'GIT_DEPLOY_KEY_UNAUTHORIZED' });

    const cloneCalls = mockExecFile.mock.calls.filter(
      (call) => (call[1] as string[])[0] === 'clone',
    );
    expect(cloneCalls).toHaveLength(1);
  });

  it('retries GitHub SSH port 443 after both SSH endpoints have network failures', async () => {
    const manager = {
      runWithCloneCredential: vi.fn(
        async (
          _options: { repoUrl: string; credentialId?: string; serviceId?: string },
          clone: (auth: GitCloneCredentialAuth) => Promise<unknown>,
        ) =>
          await clone({
            credentialId: 'gitcred_network',
            cloneUrl: 'git@github.com:user/private-repo.git',
            gitSshCommand: 'ssh -F /dev/null -i /tmp/deploy_key',
            fallbackCloneUrl: 'ssh://git@ssh.github.com:443/user/private-repo.git',
            fallbackGitSshCommand: 'ssh -F /dev/null -i /tmp/deploy_key',
          }),
      ),
    } as unknown as GitCredentialManager;
    setActiveGitCredentialManager(manager);
    mockExecFile.mockImplementation(
      (
        _cmd: string,
        args: string[],
        _opts: Record<string, unknown>,
        cb?: (err: Error | null, result: { stdout: string; stderr: string }) => void,
      ) => {
        if (args[0] === 'clone') {
          cb?.(new Error('ssh: connect to host github.com port 22: Connection timed out'), {
            stdout: '',
            stderr: '',
          });
        }
      },
    );

    await expect(
      cloneRepo({
        repoUrl: 'https://github.com/user/private-repo',
        gitCredentialId: 'gitcred_network',
      }),
    ).rejects.toMatchObject({ code: 'GIT_NETWORK_UNREACHABLE' });

    const cloneCalls = mockExecFile.mock.calls.filter(
      (call) => (call[1] as string[])[0] === 'clone',
    );
    expect(cloneCalls).toHaveLength(3);
    expect(cloneCalls.map((call) => (call[1] as string[]).at(-2))).toEqual([
      'git@github.com:user/private-repo.git',
      'ssh://git@ssh.github.com:443/user/private-repo.git',
      'ssh://git@ssh.github.com:443/user/private-repo.git',
    ]);
  });

  it('classifies "Authentication failed" as GitAuthError', async () => {
    mockExecFile.mockImplementationOnce(
      (
        _cmd: string,
        _args: string[],
        _opts: Record<string, unknown>,
        cb?: (err: Error | null, result: { stdout: string; stderr: string }) => void,
      ) => {
        cb?.(new Error('fatal: Authentication failed'), { stdout: '', stderr: '' });
      },
    );

    await expect(
      cloneRepo({ repoUrl: 'git@gitea.example.com:org/private-repo.git' }),
    ).rejects.toBeInstanceOf(GitAuthError);
  });

  it('classifies "Permission denied" as GitAuthError', async () => {
    mockExecFile.mockImplementationOnce(
      (
        _cmd: string,
        _args: string[],
        _opts: Record<string, unknown>,
        cb?: (err: Error | null, result: { stdout: string; stderr: string }) => void,
      ) => {
        cb?.(new Error('fatal: Permission denied (publickey).'), { stdout: '', stderr: '' });
      },
    );

    await expect(
      cloneRepo({ repoUrl: 'https://bitbucket.org/org/private-repo' }),
    ).rejects.toBeInstanceOf(GitAuthError);
  });

  it('classifies remote branch not found as GitBranchNotFoundError', async () => {
    mockExecFile.mockImplementationOnce(
      (
        _cmd: string,
        _args: string[],
        _opts: Record<string, unknown>,
        cb?: (err: Error | null, result: { stdout: string; stderr: string }) => void,
      ) => {
        cb?.(new Error("fatal: Remote branch 'xyz' not found in upstream origin"), {
          stdout: '',
          stderr: '',
        });
      },
    );

    await expect(
      cloneRepo({
        repoUrl: 'https://github.com/user/repo',
        branch: 'xyz',
        sshKeyPath: '/home/user/.ssh/id_rsa',
      }),
    ).rejects.toBeInstanceOf(GitBranchNotFoundError);
  });

  it('classifies repo-missing signals as GitRepoNotFoundError', async () => {
    const messages = [
      'fatal: repository not found',
      'fatal: repository does not exist',
      'fatal: HTTP 404 from remote',
    ];

    for (const message of messages) {
      mockExecFile.mockImplementationOnce(
        (
          _cmd: string,
          _args: string[],
          _opts: Record<string, unknown>,
          cb?: (err: Error | null, result: { stdout: string; stderr: string }) => void,
        ) => {
          cb?.(new Error(message), { stdout: '', stderr: '' });
        },
      );

      await expect(cloneRepo({ repoUrl: 'https://example.com/org/repo' })).rejects.toBeInstanceOf(
        GitRepoNotFoundError,
      );
    }
  });

  it('classifies unknown clone failures as GitCloneError', async () => {
    mockExecFile.mockImplementationOnce(
      (
        _cmd: string,
        _args: string[],
        _opts: Record<string, unknown>,
        cb?: (err: Error | null, result: { stdout: string; stderr: string }) => void,
      ) => {
        cb?.(new Error('fatal: transport endpoint disconnected unexpectedly'), {
          stdout: '',
          stderr: '',
        });
      },
    );

    await expect(cloneRepo({ repoUrl: 'https://example.com/org/repo' })).rejects.toBeInstanceOf(
      GitCloneError,
    );
  });
});

describeGitClone('cloneRepo — URL and SSH key edge cases', () => {
  it('keeps http:// URL unchanged and never injects GitHub token', async () => {
    await cloneRepo({ repoUrl: 'http://github.com/user/repo' });

    const cloneCall = mockExecFile.mock.calls[0];
    const args = cloneCall?.[1] as string[];
    const urlArg = args.find((arg: string) => arg.includes('github.com'));

    expect(urlArg).toBe('http://github.com/user/repo');
    expect(urlArg).not.toContain('x-access-token');
  });

  it('keeps SSH input URL unchanged and sets GIT_SSH_COMMAND when sshKeyPath is provided', async () => {
    await cloneRepo({
      repoUrl: 'git@github.com:user/repo.git',
      sshKeyPath: '/home/user/.ssh/id_ed25519',
    });

    const cloneCall = mockExecFile.mock.calls[0];
    const args = cloneCall?.[1] as string[];
    const opts = cloneCall?.[2] as { env: Record<string, string> };

    expect(args).toContain('git@github.com:user/repo.git');
    expect(args.join(' ')).not.toContain('x-access-token');
    expect(opts.env.GIT_SSH_COMMAND).toBe(
      'ssh -i /home/user/.ssh/id_ed25519 -o StrictHostKeyChecking=no',
    );
  });

  it('converts HTTPS GitLab URL to SSH and sets GIT_SSH_COMMAND when sshKeyPath is provided', async () => {
    await cloneRepo({
      repoUrl: 'https://gitlab.com/user/repo',
      sshKeyPath: '/home/user/.ssh/id_gitlab',
    });

    const cloneCall = mockExecFile.mock.calls[0];
    const args = cloneCall?.[1] as string[];
    const opts = cloneCall?.[2] as { env: Record<string, string> };
    const urlArg = args.find((arg: string) => arg.includes('gitlab.com'));

    expect(urlArg).toBe('git@gitlab.com:user/repo');
    expect(opts.env.GIT_SSH_COMMAND).toBe(
      'ssh -i /home/user/.ssh/id_gitlab -o StrictHostKeyChecking=no',
    );
  });
});

describeGitClone('cloneRepo — workspace root', () => {
  it('uses OPENLANDER_WORKSPACE_DIR as the temporary clone root when configured', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'openlander-workspace-root-test-'));
    process.env['OPENLANDER_WORKSPACE_DIR'] = workspaceRoot;

    try {
      const result = await cloneRepo({ repoUrl: 'https://github.com/user/repo' });
      const cloneCall = mockExecFile.mock.calls[0];
      const args = cloneCall?.[1] as string[];
      const destinationArg = args.at(-1);

      expect(result.path.startsWith(workspaceRoot)).toBe(true);
      expect(destinationArg).toBe(result.path);
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });
});
