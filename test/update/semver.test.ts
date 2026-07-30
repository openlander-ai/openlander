import { describe, expect, it } from 'vitest';
import {
  compareSemVer,
  inferReleaseChannel,
  isReleaseAllowedForChannel,
  isVersionAtLeast,
  parseSemVer,
} from '../../src/update/semver.js';

describe('platform update SemVer policy', () => {
  it('orders RC builds before their promoted stable release', () => {
    const rc1 = parseSemVer('v0.2.14-rc.1');
    const rc2 = parseSemVer('0.2.14-rc.2');
    const stable = parseSemVer('0.2.14');
    expect(rc1).not.toBeNull();
    expect(rc2).not.toBeNull();
    expect(stable).not.toBeNull();
    expect(compareSemVer(rc2!, rc1!)).toBeGreaterThan(0);
    expect(compareSemVer(stable!, rc2!)).toBeGreaterThan(0);
  });

  it('keeps stable users on stable and lets RC users receive RC or stable promotion', () => {
    expect(isReleaseAllowedForChannel('0.2.14-rc.1', 'stable')).toBe(false);
    expect(isReleaseAllowedForChannel('0.2.14', 'stable')).toBe(true);
    expect(isReleaseAllowedForChannel('0.2.14-rc.1', 'rc')).toBe(true);
    expect(isReleaseAllowedForChannel('0.2.14', 'rc')).toBe(true);
    expect(isReleaseAllowedForChannel('0.2.14-beta.1', 'rc')).toBe(false);
  });

  it('infers development builds and enforces minimum source versions', () => {
    expect(inferReleaseChannel('0.2.13')).toBe('stable');
    expect(inferReleaseChannel('0.2.13-rc.7')).toBe('rc');
    expect(inferReleaseChannel('0.0.0-dev')).toBe('development');
    expect(isVersionAtLeast('0.2.13-rc.7', '0.2.13-rc.4')).toBe(true);
    expect(isVersionAtLeast('0.2.13-rc.3', '0.2.13-rc.4')).toBe(false);
    expect(parseSemVer('0.2.14-rc.01')).toBeNull();
  });
});
