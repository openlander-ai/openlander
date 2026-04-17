import { describe, expect, it } from 'vitest';
import {
  RESOURCE_PROFILES,
  DEFAULT_RESOURCE_PROFILE,
  parseMemoryString,
  buildResourceLimitConfig,
} from '../../src/pipeline/docker/types.js';
import {
  PERSISTED_FIELDS,
  deserializeConfig,
  serializeConfig,
} from '../../src/pipeline/config-snapshot.js';

describe('resource-limits', () => {
  describe('RESOURCE_PROFILES constants', () => {
    it('micro profile has correct byte values', () => {
      const micro = RESOURCE_PROFILES.micro;
      expect(micro.memoryLimitBytes).toBe(268435456);
      expect(micro.memoryReservationBytes).toBe(134217728);
      expect(micro.memorySwapBytes).toBe(268435456);
      expect(micro.cpuShares).toBe(256);
    });

    it('small profile has correct byte values', () => {
      const small = RESOURCE_PROFILES.small;
      expect(small.memoryLimitBytes).toBe(536870912);
      expect(small.memoryReservationBytes).toBe(268435456);
      expect(small.memorySwapBytes).toBe(536870912);
      expect(small.cpuShares).toBe(512);
    });

    it('medium profile has correct byte values', () => {
      const medium = RESOURCE_PROFILES.medium;
      expect(medium.memoryLimitBytes).toBe(1073741824);
      expect(medium.memoryReservationBytes).toBe(536870912);
      expect(medium.memorySwapBytes).toBe(1073741824);
      expect(medium.cpuShares).toBe(1024);
    });

    it('large profile has correct byte values', () => {
      const large = RESOURCE_PROFILES.large;
      expect(large.memoryLimitBytes).toBe(2147483648);
      expect(large.memoryReservationBytes).toBe(1073741824);
      expect(large.memorySwapBytes).toBe(2147483648);
      expect(large.cpuShares).toBe(2048);
    });

    it('swap equals limit for every profile (swap disabled)', () => {
      for (const [, profile] of Object.entries(RESOURCE_PROFILES)) {
        expect(profile.memorySwapBytes).toBe(profile.memoryLimitBytes);
      }
    });

    it('reservation is 50% of limit for every profile', () => {
      for (const [, profile] of Object.entries(RESOURCE_PROFILES)) {
        expect(profile.memoryReservationBytes).toBe(profile.memoryLimitBytes / 2);
      }
    });
  });

  describe('DEFAULT_RESOURCE_PROFILE', () => {
    it('equals small', () => {
      expect(DEFAULT_RESOURCE_PROFILE).toBe('small');
    });
  });

  describe('parseMemoryString', () => {
    it('parses megabyte shorthand "256m"', () => {
      expect(parseMemoryString('256m')).toBe(256 * 1024 * 1024);
    });

    it('parses megabyte full "512mb"', () => {
      expect(parseMemoryString('512mb')).toBe(512 * 1024 * 1024);
    });

    it('parses gigabyte shorthand "1g"', () => {
      expect(parseMemoryString('1g')).toBe(1024 * 1024 * 1024);
    });

    it('parses gigabyte full "2gb"', () => {
      expect(parseMemoryString('2gb')).toBe(2 * 1024 * 1024 * 1024);
    });

    it('is case insensitive', () => {
      expect(parseMemoryString('512M')).toBe(512 * 1024 * 1024);
      expect(parseMemoryString('1G')).toBe(1024 * 1024 * 1024);
      expect(parseMemoryString('256MB')).toBe(256 * 1024 * 1024);
    });

    it('handles plain bytes', () => {
      expect(parseMemoryString('1024b')).toBe(1024);
    });

    it('handles kilobytes', () => {
      expect(parseMemoryString('512kb')).toBe(512 * 1024);
    });

    it('handles bare number as bytes', () => {
      expect(parseMemoryString('65536')).toBe(65536);
    });

    it('handles leading/trailing whitespace', () => {
      expect(parseMemoryString('  512m  ')).toBe(512 * 1024 * 1024);
    });

    it('throws on invalid format', () => {
      expect(() => parseMemoryString('abc')).toThrow('Invalid memory string');
    });

    it('throws on empty string', () => {
      expect(() => parseMemoryString('')).toThrow('Invalid memory string');
    });
  });

  describe('buildResourceLimitConfig', () => {
    it('returns null for null profile', () => {
      expect(buildResourceLimitConfig(null)).toBeNull();
    });

    it('returns null for undefined profile', () => {
      expect(buildResourceLimitConfig(undefined)).toBeNull();
    });

    it('returns correct config for "small" profile', () => {
      const config = buildResourceLimitConfig('small');
      expect(config).not.toBeNull();
      expect(config!.profile).toBe('small');
      expect(config!.memoryLimitBytes).toBe(536870912);
      expect(config!.memoryReservationBytes).toBe(268435456);
      expect(config!.memorySwapBytes).toBe(536870912);
      expect(config!.cpuShares).toBe(512);
    });

    it('returns correct config for each named profile', () => {
      const profiles = ['micro', 'small', 'medium', 'large'] as const;
      for (const name of profiles) {
        const config = buildResourceLimitConfig(name);
        expect(config).not.toBeNull();
        expect(config!.profile).toBe(name);
        expect(config!.memoryLimitBytes).toBe(RESOURCE_PROFILES[name].memoryLimitBytes);
        expect(config!.cpuShares).toBe(RESOURCE_PROFILES[name].cpuShares);
      }
    });

    it('returns correct config for "custom" with bytes', () => {
      const bytes = 768 * 1024 * 1024;
      const config = buildResourceLimitConfig('custom', bytes);
      expect(config).not.toBeNull();
      expect(config!.profile).toBe('custom');
      expect(config!.memoryLimitBytes).toBe(bytes);
      expect(config!.memoryReservationBytes).toBe(Math.floor(bytes * 0.5));
      expect(config!.memorySwapBytes).toBe(bytes);
      expect(config!.cpuShares).toBe(RESOURCE_PROFILES.small.cpuShares);
    });

    it('returns null for "custom" without bytes', () => {
      expect(buildResourceLimitConfig('custom')).toBeNull();
      expect(buildResourceLimitConfig('custom', null)).toBeNull();
    });
  });

  describe('PERSISTED_FIELDS includes resource fields', () => {
    it('contains resourceProfile', () => {
      expect(PERSISTED_FIELDS).toContain('resourceProfile');
    });

    it('contains memoryLimitBytes', () => {
      expect(PERSISTED_FIELDS).toContain('memoryLimitBytes');
    });
  });

  describe('config round-trip with resource fields', () => {
    it('preserves resourceProfile and memoryLimitBytes through serialize/deserialize', () => {
      const snapshot = {
        resourceProfile: 'medium' as const,
        memoryLimitBytes: 1073741824,
        environment: 'production',
      };

      const json = serializeConfig(snapshot);
      const result = deserializeConfig(json);

      expect(result).not.toBeNull();
      expect(result!.snapshot.resourceProfile).toBe('medium');
      expect(result!.snapshot.memoryLimitBytes).toBe(1073741824);
      expect(result!.snapshot.environment).toBe('production');
    });

    it('preserves custom profile with arbitrary bytes', () => {
      const snapshot = {
        resourceProfile: 'custom' as const,
        memoryLimitBytes: 768 * 1024 * 1024,
      };

      const json = serializeConfig(snapshot);
      const result = deserializeConfig(json);

      expect(result).not.toBeNull();
      expect(result!.snapshot.resourceProfile).toBe('custom');
      expect(result!.snapshot.memoryLimitBytes).toBe(768 * 1024 * 1024);
    });

    it('preserves null resource fields through round-trip', () => {
      const snapshot: { resourceProfile: null; memoryLimitBytes: null } = {
        resourceProfile: null,
        memoryLimitBytes: null,
      };

      const json = serializeConfig(snapshot);
      const result = deserializeConfig(json);

      expect(result).not.toBeNull();
      expect(result!.snapshot.resourceProfile).toBeNull();
      expect(result!.snapshot.memoryLimitBytes).toBeNull();
    });
  });

  describe('backward compatibility', () => {
    it('deserializes old config JSON without resource fields', () => {
      const oldConfig = JSON.stringify({
        version: 1,
        snapshot: {
          sshKeyPath: '/home/user/.ssh/id_rsa',
          environment: 'production',
        },
        savedAt: new Date().toISOString(),
      });

      const result = deserializeConfig(oldConfig);

      expect(result).not.toBeNull();
      expect(result!.snapshot.resourceProfile).toBeUndefined();
      expect(result!.snapshot.memoryLimitBytes).toBeUndefined();
      expect(result!.snapshot.sshKeyPath).toBe('/home/user/.ssh/id_rsa');
      expect(result!.snapshot.environment).toBe('production');
    });
  });
});
