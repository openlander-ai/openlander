import { describe, expect, it } from 'vitest';
import type { GitCredential, GitCredentialStatus } from '../api/git-credentials';
import { selectMatchingGitCredential } from '../git-credential-selection';

function credential(id: string, status: GitCredentialStatus): GitCredential {
  return {
    id,
    name: id,
    provider: 'github',
    auth_type: 'deploy_key',
    repository_url: 'https://github.com/Team-SpaceY/incar-app',
    repository_key: 'github.com/team-spacey/incar-app',
    public_key: `ssh-ed25519 ${id}`,
    fingerprint: `SHA256:${id}`,
    status,
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
}

describe('selectMatchingGitCredential', () => {
  it('automatically selects the unique verified repository key', () => {
    expect(selectMatchingGitCredential([credential('key-1', 'verified')], '')).toBe('key-1');
  });

  it('does not arbitrarily select when multiple verified keys match', () => {
    expect(
      selectMatchingGitCredential(
        [credential('key-1', 'verified'), credential('key-2', 'verified')],
        '',
      ),
    ).toBe('');
  });

  it('keeps the user-selected verified key across a refresh', () => {
    expect(
      selectMatchingGitCredential(
        [credential('key-1', 'verified'), credential('key-2', 'verified')],
        'key-2',
      ),
    ).toBe('key-2');
  });

  it('never selects pending or failed keys', () => {
    expect(
      selectMatchingGitCredential(
        [credential('pending', 'pending'), credential('failed', 'failed')],
        'pending',
      ),
    ).toBe('');
  });
});
