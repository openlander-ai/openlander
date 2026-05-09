/**
 * Behavioral tests for the pure helpers exported by
 * `src/web/api/git-providers-routes.ts`. The matrix below was driven by
 * Codex CCG round 1 P1 + P2 — the original regex over-matched and the
 * tri-state validation contract was not actually wired.
 */
import { describe, expect, it } from 'vitest';

import {
  canonicalRepoKey,
  classifyValidationError,
  parseGitHubRepo,
} from '../../src/web/api/git-providers-routes.js';

describe('parseGitHubRepo', () => {
  it.each([
    ['https://github.com/openlander-ai/openlander.git', 'openlander-ai', 'openlander'],
    ['https://github.com/openlander-ai/openlander', 'openlander-ai', 'openlander'],
    ['git@github.com:openlander-ai/openlander.git', 'openlander-ai', 'openlander'],
    ['git@github.com:openlander-ai/openlander', 'openlander-ai', 'openlander'],
    ['ssh://git@github.com/openlander-ai/openlander.git', 'openlander-ai', 'openlander'],
    ['HTTPS://GitHub.com/Owner/Repo', 'Owner', 'Repo'],
  ])('accepts %s', (url, owner, repo) => {
    expect(parseGitHubRepo(url)).toEqual({ owner, repo });
  });

  it.each([
    // Subdomain spoofs and GitHub-adjacent hosts must NOT count as repo URLs.
    ['https://gist.github.com/user/id'],
    ['https://api.github.com/repos/openlander-ai/openlander'],
    ['https://raw.github.com/user/repo'],
    ['https://user.github.io/repo'],
    // Path-traversal / embedded-URL bypass attempts.
    ['https://github.com.evil.com/user/repo'],
    ['https://evil.com/https://github.com/user/repo'],
    // FQDN trailing-dot ('github.com.') is a different host string than
    // 'github.com'; treating them as equal would let an attacker bypass
    // the host check by appending a dot.
    ['https://github.com./user/repo'],
    // IPv6 / numeric host literals must not be treated as GitHub.
    ['https://[::1]/user/repo'],
    // Junk
    [''],
    ['https://github.com'],
    ['https://github.com/owner-only'],
    ['not a url at all'],
    [null],
    [undefined],
  ])('rejects %s', (url) => {
    expect(parseGitHubRepo(url)).toBeNull();
  });

  it.each([
    // Percent-encoded host forms normalize to github.com under WHATWG URL
    // parsing (Node + browsers + fetch all agree). They are not bypass
    // attempts — the actual fetch / clone would resolve to github.com —
    // so the parser correctly accepts them. Pinned by test so a future
    // refactor that accidentally narrows the host check (e.g. with a raw
    // string compare on the input) does not silently break valid links.
    ['https://%67ithub.com/owner/repo', 'owner', 'repo'],
    ['https://github%2ecom/owner/repo', 'owner', 'repo'],
  ])('accepts URL-normalized %s', (url, owner, repo) => {
    expect(parseGitHubRepo(url)).toEqual({ owner, repo });
  });

  it('classifyValidationError matches the 404 provider string emitted from /user', () => {
    // The provider's request() throws "GitHub resource not found" for any
    // 404, including hypothetical /user 404s. That should land as
    // "rejected" (4xx → GitHub said no), not "unreachable".
    expect(classifyValidationError('GitHub resource not found')).toBe('rejected');
  });

  it('canonicalRepoKey dedupes case + transport variants of the same repo', () => {
    const variants = [
      'https://github.com/openlander-ai/openlander.git',
      'https://github.com/openlander-ai/openlander',
      'git@github.com:openlander-ai/openlander.git',
      'git@github.com:OPENLANDER-AI/openlander',
      'ssh://git@github.com/openlander-ai/openlander',
    ];
    const keys = new Set<string>();
    for (const variant of variants) {
      const parsed = parseGitHubRepo(variant);
      expect(parsed).not.toBeNull();
      if (parsed) keys.add(canonicalRepoKey(parsed));
    }
    expect(keys.size).toBe(1);
    expect([...keys][0]).toBe('openlander-ai/openlander');
  });
});

describe('classifyValidationError', () => {
  it.each([
    'Invalid or expired GitHub token',
    'GitHub token lacks required permissions',
    'GitHub API error 401: Bad credentials',
    'GitHub API error 403: forbidden',
    'GitHub API error 404: Not Found',
  ])('classifies %s as rejected', (msg) => {
    expect(classifyValidationError(msg)).toBe('rejected');
  });

  it.each([
    'GitHub API error 500: server error',
    'GitHub API error 502: bad gateway',
    'GitHub API error 503: service unavailable',
    'GitHub API error 504: timeout',
    'fetch failed',
    'request timed out',
    'Unknown error',
    '',
  ])('classifies %s as unreachable', (msg) => {
    expect(classifyValidationError(msg)).toBe('unreachable');
  });
});
