import { describe, expect, it, vi } from 'vitest';
import {
  PlatformReleaseChecker,
  validateUpdateManifest,
} from '../../src/update/release-checker.js';

const digest = `sha256:${'a'.repeat(64)}`;
const composeSha = 'b'.repeat(64);

function manifest(version: string, overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 1,
    version,
    minimum_source_version: '0.2.13-rc.1',
    image: `ghcr.io/openlander-ai/openlander:${version}`,
    image_digest: digest,
    compose_sha256: composeSha,
    rollback_safe: true,
    ...overrides,
  };
}

function release(
  tag: string,
  options: { draft?: boolean; prerelease?: boolean; asset?: boolean } = {},
) {
  return {
    tag_name: `v${tag}`,
    draft: options.draft ?? false,
    prerelease: options.prerelease ?? tag.includes('-'),
    published_at: '2026-07-30T00:00:00.000Z',
    html_url: `https://github.com/openlander-ai/openlander/releases/tag/v${tag}`,
    body: '- First change\n- Second change\n- Third change\n- Fourth change\n- Fifth change\n- Sixth change',
    assets:
      options.asset === false
        ? []
        : [
            {
              name: 'openlander-update.json',
              browser_download_url: `https://github.com/openlander-ai/openlander/releases/download/v${tag}/openlander-update.json`,
            },
          ],
  };
}

function releaseFetch(releases: ReturnType<typeof release>[]) {
  return vi.fn<typeof fetch>(async (input) => {
    const url = String(input);
    if (url.includes('/releases?')) return Response.json(releases);
    const version = /\/download\/v([^/]+)\//.exec(url)?.[1] ?? '0.2.14';
    return Response.json(manifest(version));
  });
}

describe('PlatformReleaseChecker', () => {
  it('selects only stable releases for a stable installation', async () => {
    const fetchImpl = releaseFetch([release('0.2.15-rc.1'), release('0.2.14'), release('0.2.13')]);
    const checker = new PlatformReleaseChecker({ currentVersion: '0.2.13', fetchImpl });
    const result = await checker.check();
    expect(result.release?.version).toBe('0.2.14');
    expect(result.release?.notes).toHaveLength(5);
    expect(result.release?.manifest?.image_digest).toBe(digest);
  });

  it('selects a newer RC and prefers a stable promotion at the same version', async () => {
    const rcChecker = new PlatformReleaseChecker({
      currentVersion: '0.2.13-rc.7',
      fetchImpl: releaseFetch([release('0.2.14-rc.2'), release('0.2.14-rc.1')]),
    });
    await expect(rcChecker.check()).resolves.toMatchObject({
      release: { version: '0.2.14-rc.2' },
    });

    const promotedChecker = new PlatformReleaseChecker({
      currentVersion: '0.2.14-rc.1',
      fetchImpl: releaseFetch([release('0.2.14-rc.2'), release('0.2.14')]),
    });
    await expect(promotedChecker.check()).resolves.toMatchObject({
      release: { version: '0.2.14' },
    });
  });

  it('caches for six hours and uses the last success after a network failure', async () => {
    let now = 1_000;
    const fetchImpl = releaseFetch([release('0.2.14')]);
    const checker = new PlatformReleaseChecker({
      currentVersion: '0.2.13',
      fetchImpl,
      now: () => now,
    });
    await expect(checker.check()).resolves.toMatchObject({ stale: false });
    await expect(checker.check()).resolves.toMatchObject({ stale: false });
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    now += 6 * 60 * 60 * 1000 + 1;
    fetchImpl.mockRejectedValueOnce(new TypeError('network unavailable'));
    await expect(checker.check()).resolves.toMatchObject({
      stale: true,
      release: { version: '0.2.14' },
    });
  });

  it('ignores drafts and blocks a release with no manifest', async () => {
    const checker = new PlatformReleaseChecker({
      currentVersion: '0.2.13-rc.7',
      fetchImpl: releaseFetch([
        release('0.2.15-rc.1', { draft: true }),
        release('0.2.14-rc.1', { asset: false }),
      ]),
    });
    const result = await checker.check();
    expect(result.release).toMatchObject({
      version: '0.2.14-rc.1',
      manifest: null,
      oneClickBlockReason: 'manifest_missing',
    });
  });

  it('blocks one-click execution when the current version is below the manifest minimum', async () => {
    const fetchImpl = releaseFetch([release('0.2.14-rc.1')]);
    fetchImpl.mockImplementation(async (input) => {
      if (String(input).includes('/releases?')) {
        return Response.json([release('0.2.14-rc.1')]);
      }
      return Response.json(manifest('0.2.14-rc.1', { minimum_source_version: '0.2.14-rc.1' }));
    });
    const checker = new PlatformReleaseChecker({ currentVersion: '0.2.13-rc.7', fetchImpl });
    await expect(checker.check()).resolves.toMatchObject({
      release: { oneClickBlockReason: 'source_version_too_old' },
    });
  });
});

describe('validateUpdateManifest', () => {
  it('rejects digest, checksum, version, and rollback policy violations', () => {
    expect(validateUpdateManifest(manifest('0.2.14'), '0.2.14').reason).toBeNull();
    expect(
      validateUpdateManifest(manifest('0.2.14', { image_digest: 'sha256:nope' }), '0.2.14').reason,
    ).toBe('manifest_invalid');
    expect(
      validateUpdateManifest(manifest('0.2.14', { compose_sha256: 'bad' }), '0.2.14').reason,
    ).toBe('manifest_invalid');
    expect(validateUpdateManifest(manifest('0.2.15'), '0.2.14').reason).toBe('manifest_invalid');
    expect(
      validateUpdateManifest(manifest('0.2.14', { rollback_safe: false }), '0.2.14').reason,
    ).toBe('rollback_not_supported');
  });
});
