import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

vi.mock('../src/config/index.js', () => ({
  loadConfig: vi.fn(),
}));

import { execFile } from 'node:child_process';
import { cloneRepo } from '../src/pipeline/git.js';
import { loadConfig } from '../src/config/index.js';
import {
  GitAuthError,
  GitBranchNotFoundError,
  GitCloneError,
  GitRepoNotFoundError,
} from '../src/errors.js';

const mockExecFile = execFile as unknown as ReturnType<typeof vi.fn>;
const mockLoadConfig = loadConfig as unknown as ReturnType<typeof vi.fn>;
const describeGitClone = describe;

// Make promisified execFile resolve by default
beforeEach(() => {
  mockExecFile.mockReset();
  mockLoadConfig.mockReset();

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

  it('converts to SSH URL and does not inject token when sshKeyPath is provided', async () => {
    await cloneRepo({
      repoUrl: 'https://github.com/user/repo',
      sshKeyPath: '/home/user/.ssh/id_rsa',
    });

    const cloneCall = mockExecFile.mock.calls[0];
    const args = cloneCall![1] as string[];

    // When sshKeyPath is provided, HTTPS URL is converted to SSH format
    const urlArg = args.find((a: string) => a.includes('github.com'));
    expect(urlArg).toBe('git@github.com:user/repo');
    expect(urlArg).not.toContain('x-access-token');
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

describeGitClone('cloneRepo — HTTPS auth failure and SSH retry', () => {
  it('retries with SSH when HTTPS fails with terminal prompts disabled and succeeds', async () => {
    mockExecFile
      .mockImplementationOnce(
        (
          _cmd: string,
          _args: string[],
          _opts: Record<string, unknown>,
          cb?: (err: Error | null, result: { stdout: string; stderr: string }) => void,
        ) => {
          cb?.(new Error('fatal: terminal prompts disabled'), { stdout: '', stderr: '' });
        },
      )
      .mockImplementationOnce(
        (
          _cmd: string,
          _args: string[],
          _opts: Record<string, unknown>,
          cb?: (err: Error | null, result: { stdout: string; stderr: string }) => void,
        ) => {
          cb?.(null, { stdout: '', stderr: '' });
        },
      )
      .mockImplementationOnce(
        (
          _cmd: string,
          _args: string[],
          _opts: Record<string, unknown>,
          cb?: (err: Error | null, result: { stdout: string; stderr: string }) => void,
        ) => {
          cb?.(null, { stdout: 'retry-success-sha\n', stderr: '' });
        },
      )
      .mockImplementationOnce(
        (
          _cmd: string,
          _args: string[],
          _opts: Record<string, unknown>,
          cb?: (err: Error | null, result: { stdout: string; stderr: string }) => void,
        ) => {
          cb?.(null, { stdout: 'main\n', stderr: '' });
        },
      );

    const result = await cloneRepo({ repoUrl: 'https://github.com/user/private-repo' });

    const firstCloneArgs = mockExecFile.mock.calls[0]?.[1] as string[];
    const retryCloneArgs = mockExecFile.mock.calls[1]?.[1] as string[];

    expect(firstCloneArgs).toContain(
      'https://x-access-token:ghp_test_token_123@github.com/user/private-repo',
    );
    expect(retryCloneArgs).toContain('git@github.com:user/private-repo');
    expect(result.commitSha).toBe('retry-success-sha');
    expect(result.branch).toBe('main');
    expect(mockExecFile).toHaveBeenCalledTimes(4);
  });

  it('throws GitCloneError when both HTTPS and SSH attempts fail', async () => {
    mockExecFile
      .mockImplementationOnce(
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
      )
      .mockImplementationOnce(
        (
          _cmd: string,
          _args: string[],
          _opts: Record<string, unknown>,
          cb?: (err: Error | null, result: { stdout: string; stderr: string }) => void,
        ) => {
          cb?.(new Error('fatal: Permission denied (publickey).'), { stdout: '', stderr: '' });
        },
      );

    try {
      await cloneRepo({ repoUrl: 'https://github.com/user/private-repo' });
      throw new Error('expected cloneRepo to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(GitCloneError);
      expect((error as Error).message).toContain('HTTPS and SSH both failed');
    }

    expect(mockExecFile).toHaveBeenCalledTimes(2);
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
