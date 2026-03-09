import { describe, expect, it } from 'vitest';

import {
  isPREvent,
  parseBitbucketPRPayload,
  parseGitHubPRPayload,
  parseGitLabPRPayload,
} from '../src/webhook/index.js';

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
