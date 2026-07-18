/**
 * Day 13 M3: `assertSafeRepoUrl` is the SSRF guard at the front of the git
 * clone path. The agent and HTTP API both call into `cloneRepo`, so anyone
 * who can submit a project URL can otherwise force the daemon to talk to
 * cloud-metadata endpoints, internal services, or the local filesystem.
 *
 * These tests pin the allow-list (legitimate hosts continue to clone) and
 * the deny-list (loopback, private IPs, file://, javascript:, embedded
 * credentials, etc. throw `UnsafeRepoUrlError`).
 */
import { describe, expect, it } from 'vitest';

import { assertSafeRepoUrl } from '../../src/pipeline/git.js';
import { UnsafeRepoUrlError } from '../../src/errors.js';

describe('Day 13 M3: assertSafeRepoUrl SSRF guard', () => {
  describe('allows legitimate public hosts', () => {
    it.each([
      'https://github.com/openlander/openlander.git',
      'https://gitlab.com/openlander/openlander.git',
      'https://bitbucket.org/openlander/openlander.git',
      'http://example.com/repo.git', // http is permitted; we don't try to upgrade
      'ssh://git@github.com/openlander/openlander.git',
      'git@github.com:openlander/openlander.git', // SCP-style SSH
      'git@gitlab.example.com:team/repo.git',
    ])('passes for %s', (url) => {
      expect(() => assertSafeRepoUrl(url)).not.toThrow();
    });
  });

  describe('refuses loopback / private hosts', () => {
    it.each([
      'http://localhost/repo.git',
      'http://127.0.0.1/repo.git',
      'http://0.0.0.0/repo.git',
      'http://169.254.169.254/latest/meta-data', // AWS IMDS
      'http://metadata.google.internal/v1/project',
      'http://10.0.0.5/repo.git',
      'http://192.168.1.10/repo.git',
      'http://172.16.0.4/repo.git',
      'http://172.31.255.255/repo.git',
      'https://my-internal.local/repo.git',
      'http://router.localhost/repo.git',
    ])('throws UnsafeRepoUrlError for %s', (url) => {
      expect(() => assertSafeRepoUrl(url)).toThrow(UnsafeRepoUrlError);
    });
  });

  describe('refuses non-network schemes', () => {
    it.each([
      'file:///etc/passwd',
      'javascript:alert(1)',
      'data:text/plain,hello',
      'gopher://example.com/0/etc/passwd',
      'ftp://example.com/repo',
    ])('throws UnsafeRepoUrlError for %s', (url) => {
      expect(() => assertSafeRepoUrl(url)).toThrow(UnsafeRepoUrlError);
    });
  });

  it('does not allow caller-embedded credentials in the URL', () => {
    // Token injection happens later, controlled by the daemon. Letting the
    // caller pass `https://attacker:token@github.com/...` would let them
    // overwrite our injection with their own redirect target.
    const repoUrl = 'https://user:hunter2@github.com/foo/bar.git';
    expect(() => assertSafeRepoUrl(repoUrl)).toThrow(UnsafeRepoUrlError);
    try {
      assertSafeRepoUrl(repoUrl);
    } catch (error) {
      expect(JSON.stringify(error)).not.toContain('hunter2');
      expect(error).toMatchObject({
        details: { repoUrl: 'https://***@github.com/foo/bar.git' },
      });
    }
  });

  it('throws with a descriptive 400 status code on UnsafeRepoUrlError', () => {
    try {
      assertSafeRepoUrl('http://127.0.0.1/repo.git');
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(UnsafeRepoUrlError);
      expect((err as UnsafeRepoUrlError).statusCode).toBe(400);
      expect((err as UnsafeRepoUrlError).code).toBe('UNSAFE_REPO_URL');
    }
  });

  it('rejects URLs that do not parse', () => {
    expect(() => assertSafeRepoUrl('::not a url::')).toThrow(UnsafeRepoUrlError);
  });

  it('rejects an SCP-style URL whose host is loopback', () => {
    expect(() => assertSafeRepoUrl('git@localhost:foo/bar.git')).toThrow(UnsafeRepoUrlError);
    expect(() => assertSafeRepoUrl('git@127.0.0.1:foo/bar.git')).toThrow(UnsafeRepoUrlError);
  });
});
