import { createHmac } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import {
  WebhookManager,
  isPREvent,
  parseBitbucketPRPayload,
  parseGitHubPRPayload,
  parseGitLabPRPayload,
} from '../src/webhook/index.js';
import { ProjectArchivedError } from '../src/errors.js';

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
    type: 'production' | 'development';
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
        { id: 'env-development', type: 'development', branch: 'develop' },
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

  it('routes develop branch push to development environment', async () => {
    const { manager, deployEnvironment, redeploy } = createPushWebhookManager({
      branchFilter: 'develop',
      environments: [
        { id: 'env-prod', type: 'production', branch: 'main' },
        { id: 'env-development', type: 'development', branch: 'develop' },
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
    expect(deployEnvironment).toHaveBeenCalledWith('project-1', 'env-development', {
      trigger: 'webhook',
    });
    expect(redeploy).not.toHaveBeenCalled();
  });

  it('allows environment auto-match even when branch filter differs', async () => {
    const { manager, deployEnvironment, redeploy } = createPushWebhookManager({
      branchFilter: 'main',
      environments: [
        { id: 'env-prod', type: 'production', branch: 'main' },
        { id: 'env-development', type: 'development', branch: 'develop' },
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
    expect(deployEnvironment).toHaveBeenCalledWith('project-1', 'env-development', {
      trigger: 'webhook',
    });
    expect(redeploy).not.toHaveBeenCalled();
  });

  it('routes feature branch push to matching development environment', async () => {
    const { manager, deployEnvironment, redeploy } = createPushWebhookManager({
      branchFilter: 'feature/cool',
      environments: [
        { id: 'env-prod', type: 'production', branch: 'main' },
        { id: 'env-development', type: 'development', branch: 'develop' },
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
        { id: 'env-development', type: 'development', branch: 'develop' },
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

// ---------------------------------------------------------------------------
// Day 8 Bug #4: deploy:start MUST NOT be emitted when policy rejects the
// deploy (archived / recovering / circuit-open). Previously, deploy:start
// was emitted before the policy check, leaving stale active-project state in
// questionBridge and false "started" entries in the activity feed when the
// pipeline call short-circuited.
// ---------------------------------------------------------------------------
describe('webhook deploy:start ordering (Day 8 Bug #4)', () => {
  it('does NOT emit deploy:start when redeploy is policy-rejected (archived)', async () => {
    const emit = vi.fn(async () => undefined);
    const redeploy = vi.fn(async () => {
      throw new ProjectArchivedError('project-1');
    });
    const deployEnvironment = vi.fn(async () => ({ success: true }));

    const db = {
      getProject: vi.fn(() => ({
        id: 'project-1',
        name: 'archived-app',
        repo_url: 'https://github.com/example/repo.git',
      })),
      getWebhookConfig: vi.fn(() => ({
        enabled: 1,
        secret: 'test-secret',
        branch_filter: 'main',
      })),
      // No environments — fall through to redeploy() path
      getEnvironmentsByProject: vi.fn(() => []),
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

    // Webhook still accepted (the push event is valid; only the deploy
    // action is gracefully skipped) — but no deploy:start emit should
    // have happened.
    expect(result.accepted).toBe(true);
    expect(result.message).toMatch(/archived/i);

    const startEmits = emit.mock.calls.filter(([eventName]) => eventName === 'deploy:start');
    expect(startEmits).toHaveLength(0);
  });

  it('does NOT emit deploy:start when deployEnvironment is policy-rejected', async () => {
    const emit = vi.fn(async () => undefined);
    const deployEnvironment = vi.fn(async () => {
      throw new ProjectArchivedError('project-1');
    });
    const redeploy = vi.fn(async () => ({ success: true }));

    const db = {
      getProject: vi.fn(() => ({
        id: 'project-1',
        name: 'archived-env-app',
        repo_url: 'https://github.com/example/repo.git',
      })),
      getWebhookConfig: vi.fn(() => ({
        enabled: 1,
        secret: 'test-secret',
        branch_filter: 'main',
      })),
      getEnvironmentsByProject: vi.fn(() => [
        {
          id: 'env-prod',
          type: 'production',
          branch: 'main',
          project_id: 'project-1',
          status: 'idle',
          assigned_port: null,
          container_id: null,
          image_tag: null,
          previous_image_tag: null,
          public_url: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ]),
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
    expect(result.message).toMatch(/archived/i);

    // Webhook emits NO deploy:start at all — the pipeline owns that emit
    // and only fires it after the synchronous policy check passes. When the
    // policy rejects (as here), the pipeline never reaches its own emit.
    const startEmits = emit.mock.calls.filter(([eventName]) => eventName === 'deploy:start');
    expect(startEmits).toHaveLength(0);
  });

  it('webhook itself emits no deploy:start on success path (pipeline owns it)', async () => {
    // Successful deploy: webhook still must not emit deploy:start. The
    // pipeline.redeploy() emits its own deploy:start after policy passes,
    // and the activity feed deduplicates by projectId — double-emit would
    // pollute the feed.
    const emit = vi.fn(async () => undefined);
    const redeploy = vi.fn(async () => ({ success: true }));
    const deployEnvironment = vi.fn(async () => ({ success: true }));

    const db = {
      getProject: vi.fn(() => ({
        id: 'project-1',
        name: 'happy-app',
        repo_url: 'https://github.com/example/repo.git',
      })),
      getWebhookConfig: vi.fn(() => ({
        enabled: 1,
        secret: 'test-secret',
        branch_filter: 'main',
      })),
      getEnvironmentsByProject: vi.fn(() => []),
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
    expect(redeploy).toHaveBeenCalledWith('project-1');
    const startEmits = emit.mock.calls.filter(([eventName]) => eventName === 'deploy:start');
    expect(startEmits).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Day 9 F5: webhook MUST emit `webhook:skipped` when policy gracefully refuses
// the deploy. Without this, archived/recovering/circuit-open projects produce
// silent push events ("I pushed but nothing happened") with zero activity-feed
// trace.
// ---------------------------------------------------------------------------
describe('webhook:skipped emit (Day 9 F5)', () => {
  it('emits webhook:skipped with reason=archived when redeploy is policy-rejected', async () => {
    const emit = vi.fn(async () => undefined);
    const redeploy = vi.fn(async () => {
      throw new ProjectArchivedError('project-1');
    });

    const db = {
      getProject: vi.fn(() => ({
        id: 'project-1',
        name: 'archived-app',
        repo_url: 'https://github.com/example/repo.git',
      })),
      getWebhookConfig: vi.fn(() => ({
        enabled: 1,
        secret: 'test-secret',
        branch_filter: 'main',
      })),
      getEnvironmentsByProject: vi.fn(() => []),
      getPreviewProjects: vi.fn(() => []),
    };

    const pipeline = {
      deployEnvironment: vi.fn(),
      redeploy,
      deployPreview: vi.fn(),
      remove: vi.fn(),
    };

    const manager = new WebhookManager(
      pipeline as unknown as ConstructorParameters<typeof WebhookManager>[0],
      db as unknown as ConstructorParameters<typeof WebhookManager>[1],
      { emit } as unknown as ConstructorParameters<typeof WebhookManager>[2],
    );

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
    const skippedEmits = emit.mock.calls.filter(([eventName]) => eventName === 'webhook:skipped');
    expect(skippedEmits).toHaveLength(1);
    const [, payload] = skippedEmits[0]!;
    expect(payload).toMatchObject({
      projectId: 'project-1',
      reason: 'archived',
      source: 'github',
    });
  });

  it('emits webhook:skipped with reason=recovering when env deploy is policy-rejected', async () => {
    const emit = vi.fn(async () => undefined);
    const { ProjectRecoveringError } = await import('../src/errors.js');
    const deployEnvironment = vi.fn(async () => {
      throw new ProjectRecoveringError('project-1');
    });

    const db = {
      getProject: vi.fn(() => ({
        id: 'project-1',
        name: 'recovering-app',
        repo_url: 'https://github.com/example/repo.git',
      })),
      getWebhookConfig: vi.fn(() => ({
        enabled: 1,
        secret: 'test-secret',
        branch_filter: 'main',
      })),
      getEnvironmentsByProject: vi.fn(() => [
        {
          id: 'env-prod',
          type: 'production',
          branch: 'main',
          project_id: 'project-1',
          status: 'idle',
          assigned_port: null,
          container_id: null,
          image_tag: null,
          previous_image_tag: null,
          public_url: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ]),
      getPreviewProjects: vi.fn(() => []),
    };

    const pipeline = {
      deployEnvironment,
      redeploy: vi.fn(),
      deployPreview: vi.fn(),
      remove: vi.fn(),
    };

    const manager = new WebhookManager(
      pipeline as unknown as ConstructorParameters<typeof WebhookManager>[0],
      db as unknown as ConstructorParameters<typeof WebhookManager>[1],
      { emit } as unknown as ConstructorParameters<typeof WebhookManager>[2],
    );

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
    const skippedEmits = emit.mock.calls.filter(([eventName]) => eventName === 'webhook:skipped');
    expect(skippedEmits).toHaveLength(1);
    const [, payload] = skippedEmits[0]!;
    expect(payload).toMatchObject({
      projectId: 'project-1',
      reason: 'recovering',
      source: 'github',
    });
  });

  it('does NOT emit webhook:skipped on the success path', async () => {
    const emit = vi.fn(async () => undefined);
    const redeploy = vi.fn(async () => ({ success: true }));

    const db = {
      getProject: vi.fn(() => ({
        id: 'project-1',
        name: 'happy-app',
        repo_url: 'https://github.com/example/repo.git',
      })),
      getWebhookConfig: vi.fn(() => ({
        enabled: 1,
        secret: 'test-secret',
        branch_filter: 'main',
      })),
      getEnvironmentsByProject: vi.fn(() => []),
      getPreviewProjects: vi.fn(() => []),
    };

    const pipeline = {
      deployEnvironment: vi.fn(),
      redeploy,
      deployPreview: vi.fn(),
      remove: vi.fn(),
    };

    const manager = new WebhookManager(
      pipeline as unknown as ConstructorParameters<typeof WebhookManager>[0],
      db as unknown as ConstructorParameters<typeof WebhookManager>[1],
      { emit } as unknown as ConstructorParameters<typeof WebhookManager>[2],
    );

    const body = githubPushBody('main');
    await manager.handleWebhook(
      'github',
      {
        'x-openlander-project-id': 'project-1',
        'x-github-event': 'push',
        'x-hub-signature-256': githubSignature(body, 'test-secret'),
      },
      body,
    );

    const skippedEmits = emit.mock.calls.filter(([eventName]) => eventName === 'webhook:skipped');
    expect(skippedEmits).toHaveLength(0);
  });
});
