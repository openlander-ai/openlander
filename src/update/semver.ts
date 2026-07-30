import type { ReleaseChannel } from './types.js';

export interface ParsedSemVer {
  raw: string;
  major: number;
  minor: number;
  patch: number;
  prerelease: Array<string | number>;
}

const SEMVER_PATTERN =
  /^(?:v)?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export function parseSemVer(value: string): ParsedSemVer | null {
  const match = SEMVER_PATTERN.exec(value.trim());
  if (!match) return null;
  const prereleaseParts = match[4]?.split('.') ?? [];
  if (prereleaseParts.some((part) => /^\d+$/.test(part) && !/^(0|[1-9]\d*)$/.test(part))) {
    return null;
  }
  const prerelease = prereleaseParts.map((part) =>
    /^(0|[1-9]\d*)$/.test(part) ? Number(part) : part,
  );
  return {
    raw: value.trim().replace(/^v/, ''),
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease,
  };
}

export function compareSemVer(left: ParsedSemVer, right: ParsedSemVer): number {
  for (const key of ['major', 'minor', 'patch'] as const) {
    const difference = left[key] - right[key];
    if (difference !== 0) return difference > 0 ? 1 : -1;
  }
  if (left.prerelease.length === 0 && right.prerelease.length === 0) return 0;
  if (left.prerelease.length === 0) return 1;
  if (right.prerelease.length === 0) return -1;
  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = left.prerelease[index];
    const rightPart = right.prerelease[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;
    if (typeof leftPart === 'number' && typeof rightPart === 'number') {
      return leftPart > rightPart ? 1 : -1;
    }
    if (typeof leftPart === 'number') return -1;
    if (typeof rightPart === 'number') return 1;
    return leftPart > rightPart ? 1 : -1;
  }
  return 0;
}

export function inferReleaseChannel(version: string): ReleaseChannel {
  const parsed = parseSemVer(version);
  if (!parsed) return 'development';
  if (parsed.prerelease.length === 0) return 'stable';
  return parsed.prerelease[0] === 'rc' ? 'rc' : 'development';
}

export function isReleaseAllowedForChannel(version: string, channel: ReleaseChannel): boolean {
  const parsed = parseSemVer(version);
  if (!parsed || channel === 'development') return false;
  if (channel === 'stable') return parsed.prerelease.length === 0;
  if (parsed.prerelease.length === 0) return true;
  return parsed.prerelease[0] === 'rc';
}

export function isVersionAtLeast(version: string, minimumVersion: string): boolean {
  const parsedVersion = parseSemVer(version);
  const parsedMinimum = parseSemVer(minimumVersion);
  return Boolean(
    parsedVersion && parsedMinimum && compareSemVer(parsedVersion, parsedMinimum) >= 0,
  );
}
