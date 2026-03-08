import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// vi.hoisted runs before vi.mock hoisting — safe to reference in factories
const { mockExecFile, mockLoadConfig } = vi.hoisted(() => ({
  mockExecFile: vi.fn(),
  mockLoadConfig: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execFile: mockExecFile,
}));

vi.mock('../src/config/index.js', () => ({
  loadConfig: () => mockLoadConfig(),
}));

import { cloneRepo } from '../src/pipeline/git.js';

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

describe('cloneRepo — GitHub token injection', () => {
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
