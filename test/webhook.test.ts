import { createHmac } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import {
  WebhookManager,
  isPREvent,
  parseBitbucketPRPayload,
  parseGitHubPRPayload,
  parseGitLabPRPayload,
} from '../src/webhook/index.js';

function githubPushBody(branch: string): string {
  return JSON.stringify({
    ref: `refs/heads/${branch}`,
    after: 'abc123def456',
    repository: {
      clone_url: 'https://github.com/example/repo.git',
    },
  });
}

function githubSignature(body: string, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

function createPushWebhookManager(options: {
  branchFilter?: string;
  environments: Array<{
    id: string;
    type: 'production' | 'staging' | 'development';
    branch: string;
  }>;
}) {
  const branchFilter = options.branchFilter ?? 'main';
  const deployEnvironment = vi.fn(async () => ({ success: true }));
  const redeploy = vi.fn(async () => ({ success: true }));
  const emit = vi.fn(async () => undefined);

  const db = {
    getProject: vi.fn(() => ({
      id: 'project-1',
      name: 'demo',
      repo_url: 'https://github.com/example/repo.git',
    })),
    getWebhookConfig: vi.fn(() => ({
      enabled: 1,
      secret: 'test-secret',
      branch_filter: branchFilter,
    })),
    getEnvironmentsByProject: vi.fn(() =>
      options.environments.map((environment) => ({
        ...environment,
        project_id: 'project-1',
        status: 'idle',
        assigned_port: null,
        container_id: null,
        image_tag: null,
        previous_image_tag: null,
        public_url: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })),
    ),
    getPreviewProjects: vi.fn(() => []),
  };

  const pipeline = {
    deployEnvironment,
    redeploy,
    deployPreview: vi.fn(),
    remove: vi.fn(),
  };

  const manager = new WebhookManager(
    pipeline as unknown as ConstructorParameters<typeof WebhookManager>[0],
    db as unknown as ConstructorParameters<typeof WebhookManager>[1],
    { emit } as unknown as ConstructorParameters<typeof WebhookManager>[2],
  );

  return { manager, deployEnvironment, redeploy, emit };
}

describe('webhook PR helpers', () => {
  it('parseGitHubPRPayload parses opened pull request event', () => {
    const parsed = parseGitHubPRPayload({
      action: 'opened',
      pull_request: {
        number: 42,
        title: 'Add feature',
        head: {
          ref: 'feature/pr-preview',
          sha: 'abc123def456',
          repo: {
            clone_url: 'https://github.com/example/repo.git',
          },
        },
        base: {
          ref: 'main',
        },
      },
      repository: {
        clone_url: 'https://github.com/example/repo.git',
      },
    });

    expect(parsed).toEqual({
      action: 'opened',
      prNumber: 42,
      branch: 'feature/pr-preview',
      baseBranch: 'main',
      commitSha: 'abc123def456',
      repoUrl: 'https://github.com/example/repo.git',
      title: 'Add feature',
    });
  });

  it('parseGitHubPRPayload maps closed action', () => {
    const parsed = parseGitHubPRPayload({
      action: 'closed',
      pull_request: {
        number: 99,
        title: 'Close me',
        head: {
          ref: 'feature/old',
          sha: 'deadbeef',
          repo: {
            clone_url: 'https://github.com/example/repo.git',
          },
        },
        base: {
          ref: 'main',
        },
      },
      repository: {
        clone_url: 'https://github.com/example/repo.git',
      },
    });

    expect(parsed?.action).toBe('closed');
    expect(parsed?.prNumber).toBe(99);
  });

  it('parseGitHubPRPayload ignores unrelated actions', () => {
    const parsed = parseGitHubPRPayload({
      action: 'labeled',
      pull_request: {
        number: 1,
        head: { ref: 'feature/a', sha: 'abc' },
        base: { ref: 'main' },
      },
    });

    expect(parsed).toBeNull();
  });

  it('isPREvent detects GitHub pull_request event', () => {
    expect(isPREvent('github', { 'x-github-event': 'pull_request' })).toBe(true);
  });

  it('isPREvent detects GitLab merge request hook', () => {
    expect(isPREvent('gitlab', { 'x-gitlab-event': 'Merge Request Hook' })).toBe(true);
  });

  it('parseGitLabPRPayload parses opened merge request', () => {
    const parsed = parseGitLabPRPayload({
      object_attributes: {
        action: 'open',
        iid: 15,
        title: 'New MR',
        source_branch: 'feature/test',
        target_branch: 'main',
        last_commit: { id: 'gitlab-sha-123' },
      },
      project: {
        git_http_url: 'https://gitlab.com/org/repo.git',
      },
    });

    expect(parsed).toEqual({
      action: 'opened',
      prNumber: 15,
      branch: 'feature/test',
      baseBranch: 'main',
      commitSha: 'gitlab-sha-123',
      repoUrl: 'https://gitlab.com/org/repo.git',
      title: 'New MR',
    });
  });

  it('parseGitLabPRPayload maps merge action to closed', () => {
    const parsed = parseGitLabPRPayload({
      object_attributes: {
        action: 'merge',
        iid: 20,
        title: 'Merged MR',
        source_branch: 'feature/done',
        target_branch: 'main',
        merge_commit_sha: 'merge-sha-456',
      },
      project: { git_http_url: 'https://gitlab.com/org/repo.git' },
    });

    expect(parsed?.action).toBe('closed');
  });

  it('parseGitLabPRPayload maps update action to synchronize', () => {
    const parsed = parseGitLabPRPayload({
      object_attributes: {
        action: 'update',
        iid: 25,
        title: 'Updated MR',
        source_branch: 'feature/update',
        target_branch: 'main',
        last_commit: { id: 'update-sha' },
      },
      project: { git_http_url: 'https://gitlab.com/org/repo.git' },
    });

    expect(parsed?.action).toBe('synchronize');
  });

  it('parseGitLabPRPayload returns null for unrecognized action', () => {
    const parsed = parseGitLabPRPayload({
      object_attributes: {
        action: 'approved',
        iid: 30,
        source_branch: 'feature/x',
        target_branch: 'main',
        last_commit: { id: 'sha' },
      },
      project: {},
    });

    expect(parsed).toBeNull();
  });

  it('parseBitbucketPRPayload parses open pull request', () => {
    const parsed = parseBitbucketPRPayload({
      pullrequest: {
        id: 7,
        title: 'BB PR',
        state: 'OPEN',
        source: {
          branch: { name: 'feature/bb' },
          commit: { hash: 'bb-sha-789' },
        },
        destination: {
          branch: { name: 'main' },
        },
      },
      repository: {
        links: { html: { href: 'https://bitbucket.org/org/repo' } },
      },
    });

    expect(parsed).toEqual({
      action: 'opened',
      prNumber: 7,
      branch: 'feature/bb',
      baseBranch: 'main',
      commitSha: 'bb-sha-789',
      repoUrl: 'https://bitbucket.org/org/repo',
      title: 'BB PR',
    });
  });

  it('parseBitbucketPRPayload maps MERGED state to closed', () => {
    const parsed = parseBitbucketPRPayload({
      pullrequest: {
        id: 8,
        title: 'Merged',
        state: 'MERGED',
        source: {
          branch: { name: 'feature/done' },
          commit: { hash: 'merged-sha' },
        },
        destination: { branch: { name: 'main' } },
      },
      repository: { links: { html: { href: 'https://bitbucket.org/org/repo' } } },
    });

    expect(parsed?.action).toBe('closed');
  });

  it('parseBitbucketPRPayload returns null when pullrequest is missing', () => {
    const parsed = parseBitbucketPRPayload({ some: 'data' });
    expect(parsed).toBeNull();
  });

  it('isPREvent returns false for push events', () => {
    expect(isPREvent('github', { 'x-github-event': 'push' })).toBe(false);
    expect(isPREvent('gitlab', { 'x-gitlab-event': 'Push Hook' })).toBe(false);
  });

  it('isPREvent detects Bitbucket pullrequest events', () => {
    expect(isPREvent('bitbucket', { 'x-event-key': 'pullrequest:created' })).toBe(true);
    expect(isPREvent('bitbucket', { 'x-event-key': 'pullrequest:updated' })).toBe(true);
    expect(isPREvent('bitbucket', { 'x-event-key': 'repo:push' })).toBe(false);
  });
});

describe('webhook push environment routing', () => {
  it('routes main branch push to production environment', async () => {
    const { manager, deployEnvironment, redeploy } = createPushWebhookManager({
      environments: [
        { id: 'env-prod', type: 'production', branch: 'main' },
        { id: 'env-staging', type: 'staging', branch: 'develop' },
        { id: 'env-dev', type: 'development', branch: 'feature/cool' },
      ],
    });
    const body = githubPushBody('main');

    const result = await manager.handleWebhook(
      'github',
      {
        'x-openlander-project-id': 'project-1',
        'x-github-event': 'push',
        'x-hub-signature-256': githubSignature(body, 'test-secret'),
      },
      body,
    );

    expect(result.accepted).toBe(true);
    expect(deployEnvironment).toHaveBeenCalledWith('project-1', 'env-prod', { trigger: 'webhook' });
    expect(redeploy).not.toHaveBeenCalled();
  });

  it('routes develop branch push to staging environment', async () => {
    const { manager, deployEnvironment, redeploy } = createPushWebhookManager({
      branchFilter: 'develop',
      environments: [
        { id: 'env-prod', type: 'production', branch: 'main' },
        { id: 'env-staging', type: 'staging', branch: 'develop' },
        { id: 'env-dev', type: 'development', branch: 'feature/cool' },
      ],
    });
    const body = githubPushBody('develop');

    const result = await manager.handleWebhook(
      'github',
      {
        'x-openlander-project-id': 'project-1',
        'x-github-event': 'push',
        'x-hub-signature-256': githubSignature(body, 'test-secret'),
      },
      body,
    );

    expect(result.accepted).toBe(true);
    expect(deployEnvironment).toHaveBeenCalledWith('project-1', 'env-staging', {
      trigger: 'webhook',
    });
    expect(redeploy).not.toHaveBeenCalled();
  });

  it('allows environment auto-match even when branch filter differs', async () => {
    const { manager, deployEnvironment, redeploy } = createPushWebhookManager({
      branchFilter: 'main',
      environments: [
        { id: 'env-prod', type: 'production', branch: 'main' },
        { id: 'env-staging', type: 'staging', branch: 'develop' },
        { id: 'env-dev', type: 'development', branch: 'feature/cool' },
      ],
    });
    const body = githubPushBody('develop');

    const result = await manager.handleWebhook(
      'github',
      {
        'x-openlander-project-id': 'project-1',
        'x-github-event': 'push',
        'x-hub-signature-256': githubSignature(body, 'test-secret'),
      },
      body,
    );

    expect(result.accepted).toBe(true);
    expect(deployEnvironment).toHaveBeenCalledWith('project-1', 'env-staging', {
      trigger: 'webhook',
    });
    expect(redeploy).not.toHaveBeenCalled();
  });

  it('routes feature branch push to matching development environment', async () => {
    const { manager, deployEnvironment, redeploy } = createPushWebhookManager({
      branchFilter: 'feature/cool',
      environments: [
        { id: 'env-prod', type: 'production', branch: 'main' },
        { id: 'env-staging', type: 'staging', branch: 'develop' },
        { id: 'env-dev', type: 'development', branch: 'feature/cool' },
      ],
    });
    const body = githubPushBody('feature/cool');

    const result = await manager.handleWebhook(
      'github',
      {
        'x-openlander-project-id': 'project-1',
        'x-github-event': 'push',
        'x-hub-signature-256': githubSignature(body, 'test-secret'),
      },
      body,
    );

    expect(result.accepted).toBe(true);
    expect(deployEnvironment).toHaveBeenCalledWith('project-1', 'env-dev', { trigger: 'webhook' });
    expect(redeploy).not.toHaveBeenCalled();
  });

  it('falls back to project redeploy when no environment matches branch', async () => {
    const { manager, deployEnvironment, redeploy } = createPushWebhookManager({
      branchFilter: 'feature/missing',
      environments: [
        { id: 'env-prod', type: 'production', branch: 'main' },
        { id: 'env-staging', type: 'staging', branch: 'develop' },
      ],
    });
    const body = githubPushBody('feature/missing');

    const result = await manager.handleWebhook(
      'github',
      {
        'x-openlander-project-id': 'project-1',
        'x-github-event': 'push',
        'x-hub-signature-256': githubSignature(body, 'test-secret'),
      },
      body,
    );

    expect(result.accepted).toBe(true);
    expect(deployEnvironment).not.toHaveBeenCalled();
    expect(redeploy).toHaveBeenCalledWith('project-1');
  });

  it('preserves branch filter behavior when no environment matches', async () => {
    const { manager, deployEnvironment, redeploy } = createPushWebhookManager({
      branchFilter: 'main',
      environments: [{ id: 'env-prod', type: 'production', branch: 'main' }],
    });
    const body = githubPushBody('develop');

    const result = await manager.handleWebhook(
      'github',
      {
        'x-openlander-project-id': 'project-1',
        'x-github-event': 'push',
        'x-hub-signature-256': githubSignature(body, 'test-secret'),
      },
      body,
    );

    expect(result).toEqual({
      accepted: false,
      projectId: 'project-1',
      message: "Ignored push to 'develop' (filter 'main').",
    });
    expect(deployEnvironment).not.toHaveBeenCalled();
    expect(redeploy).not.toHaveBeenCalled();
  });
});
