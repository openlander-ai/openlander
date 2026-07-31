import { createHash } from 'node:crypto';
import { createModuleLogger } from '../lib/logger.js';
import {
  compareSemVer,
  inferReleaseChannel,
  isReleaseAllowedForChannel,
  isVersionAtLeast,
  parseSemVer,
} from './semver.js';
import type { OpenLanderUpdateManifest, PlatformReleaseSummary, ReleaseChannel } from './types.js';

const log = createModuleLogger('platform-update:release-checker');
const DEFAULT_CACHE_MS = 30 * 60 * 1000;
const RELEASES_URL = 'https://api.github.com/repos/openlander-ai/openlander/releases?per_page=30';
const OFFICIAL_IMAGE_PREFIX = 'ghcr.io/openlander-ai/openlander:';
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const HEX_SHA256_PATTERN = /^[a-f0-9]{64}$/;

interface GitHubReleaseAsset {
  name?: unknown;
  browser_download_url?: unknown;
}

interface GitHubRelease {
  tag_name?: unknown;
  draft?: unknown;
  prerelease?: unknown;
  published_at?: unknown;
  html_url?: unknown;
  body?: unknown;
  assets?: unknown;
}

interface ReleaseCacheEntry {
  checkedAt: number;
  releases: PlatformReleaseSummary[];
}

export interface ReleaseCheckResult {
  release: PlatformReleaseSummary | null;
  stale: boolean;
  checkedAt: number;
}

export interface PlatformReleaseCheckerOptions {
  fetchImpl?: typeof fetch;
  now?: () => number;
  cacheMs?: number;
  currentVersion: string;
}

function releaseNotes(body: string): string[] {
  return body
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+\S/.test(line))
    .map((line) => line.replace(/^[-*]\s+/, ''))
    .slice(0, 5);
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function validateUpdateManifest(
  value: unknown,
  expectedVersion: string,
): { manifest: OpenLanderUpdateManifest | null; reason: string | null } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { manifest: null, reason: 'manifest_invalid' };
  }
  const record = value as Record<string, unknown>;
  const version = readString(record.version);
  const minimumSourceVersion = readString(record.minimum_source_version);
  const image = readString(record.image);
  const imageDigest = readString(record.image_digest);
  const composeSha256 = readString(record.compose_sha256);
  if (
    record.schema_version !== 1 ||
    version !== expectedVersion ||
    !minimumSourceVersion ||
    !parseSemVer(minimumSourceVersion) ||
    image !== `${OFFICIAL_IMAGE_PREFIX}${expectedVersion}` ||
    !imageDigest ||
    !SHA256_PATTERN.test(imageDigest) ||
    !composeSha256 ||
    !HEX_SHA256_PATTERN.test(composeSha256) ||
    typeof record.rollback_safe !== 'boolean'
  ) {
    return { manifest: null, reason: 'manifest_invalid' };
  }
  const manifest: OpenLanderUpdateManifest = {
    schema_version: 1,
    version,
    minimum_source_version: minimumSourceVersion,
    image,
    image_digest: imageDigest,
    compose_sha256: composeSha256,
    rollback_safe: record.rollback_safe,
  };
  return {
    manifest,
    reason: manifest.rollback_safe ? null : 'rollback_not_supported',
  };
}

export function sha256Hex(content: string | Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}

export class PlatformReleaseChecker {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly cacheMs: number;
  private readonly currentVersion: string;
  private cache: ReleaseCacheEntry | null = null;

  constructor(options: PlatformReleaseCheckerOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
    this.cacheMs = options.cacheMs ?? DEFAULT_CACHE_MS;
    this.currentVersion = options.currentVersion;
  }

  async check(options: { refresh?: boolean } = {}): Promise<ReleaseCheckResult> {
    const channel = inferReleaseChannel(this.currentVersion);
    if (channel === 'development') {
      return { release: null, stale: false, checkedAt: this.now() };
    }
    if (!options.refresh && this.cache && this.now() - this.cache.checkedAt < this.cacheMs) {
      return {
        release: this.selectLatest(this.cache.releases, channel),
        stale: false,
        checkedAt: this.cache.checkedAt,
      };
    }
    try {
      const releases = await this.fetchReleases(channel);
      const checkedAt = this.now();
      this.cache = { checkedAt, releases };
      return { release: this.selectLatest(releases, channel), stale: false, checkedAt };
    } catch (error) {
      const checkedAt = this.now();
      if (this.cache) {
        log.warn({ error }, 'Release check failed; using the last successful result');
        return {
          release: this.selectLatest(this.cache.releases, channel),
          stale: true,
          checkedAt,
        };
      }
      log.warn({ error }, 'Release check failed without a cached result');
      return { release: null, stale: true, checkedAt };
    }
  }

  clearCache(): void {
    this.cache = null;
  }

  private selectLatest(
    releases: PlatformReleaseSummary[],
    channel: ReleaseChannel,
  ): PlatformReleaseSummary | null {
    return (
      releases
        .filter((release) => isReleaseAllowedForChannel(release.version, channel))
        .sort((left, right) => {
          const leftVersion = parseSemVer(left.version);
          const rightVersion = parseSemVer(right.version);
          if (!leftVersion || !rightVersion) return 0;
          return compareSemVer(rightVersion, leftVersion);
        })[0] ?? null
    );
  }

  private async fetchReleases(channel: ReleaseChannel): Promise<PlatformReleaseSummary[]> {
    const response = await this.fetchImpl(RELEASES_URL, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'OpenLander-Updater' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new TypeError(`GitHub Releases returned HTTP ${String(response.status)}`);
    }
    const payload: unknown = await response.json();
    if (!Array.isArray(payload)) throw new TypeError('GitHub Releases response is not an array');
    const candidates = payload
      .map((release) => release as GitHubRelease)
      .filter((release) => release.draft !== true)
      .filter((release) => {
        const tag = readString(release.tag_name);
        const parsed = tag ? parseSemVer(tag) : null;
        return Boolean(
          tag &&
          parsed &&
          isReleaseAllowedForChannel(tag, channel) &&
          !(parsed.prerelease.length === 0 && release.prerelease === true),
        );
      })
      .sort((left, right) => {
        const leftVersion = parseSemVer(readString(left.tag_name) ?? '');
        const rightVersion = parseSemVer(readString(right.tag_name) ?? '');
        if (!leftVersion || !rightVersion) return 0;
        return compareSemVer(rightVersion, leftVersion);
      });
    const selected = candidates[0];
    if (!selected) return [];
    const summary = await this.parseRelease(selected);
    return summary ? [summary] : [];
  }

  private async parseRelease(release: GitHubRelease): Promise<PlatformReleaseSummary | null> {
    if (release.draft === true) return null;
    const tag = readString(release.tag_name);
    const publishedAt = readString(release.published_at);
    const url = readString(release.html_url);
    if (!tag || !publishedAt || !url) return null;
    const parsed = parseSemVer(tag);
    if (!parsed) return null;
    if (release.prerelease === true && parsed.prerelease.length === 0) return null;
    const version = parsed.raw;
    const assets = Array.isArray(release.assets) ? (release.assets as GitHubReleaseAsset[]) : [];
    const manifestAsset = assets.find((asset) => asset.name === 'openlander-update.json');
    const manifestUrl = readString(manifestAsset?.browser_download_url);
    let manifest: OpenLanderUpdateManifest | null = null;
    let oneClickBlockReason: string | null = 'manifest_missing';
    if (manifestUrl) {
      try {
        const parsedManifestUrl = new URL(manifestUrl);
        if (
          parsedManifestUrl.protocol !== 'https:' ||
          parsedManifestUrl.hostname !== 'github.com' ||
          !parsedManifestUrl.pathname.startsWith(
            `/openlander-ai/openlander/releases/download/v${version}/`,
          )
        ) {
          return {
            version,
            tag,
            publishedAt,
            notes: releaseNotes(readString(release.body) ?? ''),
            url,
            manifest: null,
            oneClickBlockReason: 'manifest_untrusted_url',
          };
        }
        const manifestResponse = await this.fetchImpl(manifestUrl, {
          headers: { Accept: 'application/octet-stream', 'User-Agent': 'OpenLander-Updater' },
          signal: AbortSignal.timeout(10_000),
        });
        if (manifestResponse.ok) {
          const validation = validateUpdateManifest(await manifestResponse.json(), version);
          manifest = validation.manifest;
          oneClickBlockReason = validation.reason;
          if (manifest && !isVersionAtLeast(this.currentVersion, manifest.minimum_source_version)) {
            oneClickBlockReason = 'source_version_too_old';
          }
        } else {
          oneClickBlockReason = 'manifest_unavailable';
        }
      } catch (error) {
        log.warn({ error, version }, 'Update manifest could not be loaded');
        oneClickBlockReason = 'manifest_unavailable';
      }
    }
    return {
      version,
      tag,
      publishedAt,
      notes: releaseNotes(readString(release.body) ?? ''),
      url,
      manifest,
      oneClickBlockReason,
    };
  }
}
