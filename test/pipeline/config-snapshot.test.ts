import { describe, expect, it } from 'vitest';
import type { ProjectConfig } from '../../src/pipeline/deploy-core.js';
import {
  CONFIG_VERSION,
  PERSISTED_FIELDS,
  createSnapshot,
  deserializeConfig,
  serializeConfig,
  validateStoredConfig,
} from '../../src/pipeline/config-snapshot.js';

describe('config-snapshot', () => {
  describe('CONFIG_VERSION', () => {
    it('is set to 1', () => {
      expect(CONFIG_VERSION).toBe(1);
    });
  });

  describe('PERSISTED_FIELDS', () => {
    it('contains expected fields', () => {
      expect(PERSISTED_FIELDS).toContain('sshKeyPath');
      expect(PERSISTED_FIELDS).toContain('composeServices');
      expect(PERSISTED_FIELDS).toContain('preferDockerfile');
      expect(PERSISTED_FIELDS).toContain('environment');
      expect(PERSISTED_FIELDS).toContain('dockerfilePath');
      expect(PERSISTED_FIELDS).toContain('dockerTarget');
      expect(PERSISTED_FIELDS).toContain('buildContext');
    });

    it('does not contain runtime fields', () => {
      expect(PERSISTED_FIELDS).not.toContain('_retryCount');
      expect(PERSISTED_FIELDS).not.toContain('_noCacheBuild');
      expect(PERSISTED_FIELDS).not.toContain('_preferredPort');
      expect(PERSISTED_FIELDS).not.toContain('_projectId');
    });

    it('does not contain per-invocation fields', () => {
      expect(PERSISTED_FIELDS).not.toContain('trigger');
      expect(PERSISTED_FIELDS).not.toContain('force');
      expect(PERSISTED_FIELDS).not.toContain('dryRun');
    });

    it('does not contain database-managed fields', () => {
      expect(PERSISTED_FIELDS).not.toContain('repoUrl');
      expect(PERSISTED_FIELDS).not.toContain('branch');
      expect(PERSISTED_FIELDS).not.toContain('name');
      expect(PERSISTED_FIELDS).not.toContain('visibility');
      expect(PERSISTED_FIELDS).not.toContain('envVars');
    });
  });

  describe('createSnapshot', () => {
    it('extracts allowlisted fields from ProjectConfig', () => {
      const config: ProjectConfig = {
        repoUrl: 'https://github.com/user/repo',
        sshKeyPath: '/home/user/.ssh/id_rsa',
        composeServices: ['web', 'db'],
        preferDockerfile: true,
        environment: 'production',
        dockerfilePath: 'docker/Dockerfile.prod',
        dockerTarget: 'production',
        buildContext: './app',
      };

      const snapshot = createSnapshot(config);

      expect(snapshot.sshKeyPath).toBe('/home/user/.ssh/id_rsa');
      expect(snapshot.composeServices).toEqual(['web', 'db']);
      expect(snapshot.preferDockerfile).toBe(true);
      expect(snapshot.environment).toBe('production');
      expect(snapshot.dockerfilePath).toBe('docker/Dockerfile.prod');
      expect(snapshot.dockerTarget).toBe('production');
      expect(snapshot.buildContext).toBe('./app');
    });

    it('excludes runtime fields', () => {
      const config: ProjectConfig = {
        repoUrl: 'https://github.com/user/repo',
        _retryCount: 3,
        _noCacheBuild: true,
        _preferredPort: 3000,
        _projectId: 'proj-123',
      };

      const snapshot = createSnapshot(config);

      expect(snapshot).not.toHaveProperty('_retryCount');
      expect(snapshot).not.toHaveProperty('_noCacheBuild');
      expect(snapshot).not.toHaveProperty('_preferredPort');
      expect(snapshot).not.toHaveProperty('_projectId');
    });

    it('excludes per-invocation fields', () => {
      const config: ProjectConfig = {
        repoUrl: 'https://github.com/user/repo',
        trigger: 'webhook',
        force: true,
        dryRun: true,
      };

      const snapshot = createSnapshot(config);

      expect(snapshot).not.toHaveProperty('trigger');
      expect(snapshot).not.toHaveProperty('force');
      expect(snapshot).not.toHaveProperty('dryRun');
    });

    it('excludes database-managed fields', () => {
      const config: ProjectConfig = {
        repoUrl: 'https://github.com/user/repo',
        branch: 'main',
        name: 'my-project',
        visibility: 'production',
        envVars: { API_KEY: 'secret' },
      };

      const snapshot = createSnapshot(config);

      expect(snapshot).not.toHaveProperty('repoUrl');
      expect(snapshot).not.toHaveProperty('branch');
      expect(snapshot).not.toHaveProperty('name');
      expect(snapshot).not.toHaveProperty('visibility');
      expect(snapshot).not.toHaveProperty('envVars');
    });

    it('returns empty snapshot when no allowlisted fields are present', () => {
      const config: ProjectConfig = {
        repoUrl: 'https://github.com/user/repo',
      };

      const snapshot = createSnapshot(config);

      expect(snapshot).toEqual({});
    });

    it('includes only defined allowlisted fields', () => {
      const config: ProjectConfig = {
        repoUrl: 'https://github.com/user/repo',
        sshKeyPath: '/home/user/.ssh/id_rsa',
        environment: 'staging',
      };

      const snapshot = createSnapshot(config);

      expect(Object.keys(snapshot)).toEqual(['sshKeyPath', 'environment']);
      expect(snapshot.sshKeyPath).toBe('/home/user/.ssh/id_rsa');
      expect(snapshot.environment).toBe('staging');
    });
  });

  describe('serializeConfig', () => {
    it('wraps snapshot with version and savedAt', () => {
      const snapshot = {
        sshKeyPath: '/home/user/.ssh/id_rsa',
        environment: 'production',
      };

      const json = serializeConfig(snapshot);
      const parsed = JSON.parse(json);

      expect(parsed.version).toBe(CONFIG_VERSION);
      expect(parsed.snapshot).toEqual(snapshot);
      expect(typeof parsed.savedAt).toBe('string');
    });

    it('produces valid ISO timestamp for savedAt', () => {
      const snapshot = { environment: 'staging' };
      const json = serializeConfig(snapshot);
      const parsed = JSON.parse(json);

      const date = new Date(parsed.savedAt);
      expect(date.getTime()).toBeGreaterThan(0);
      expect(date.toISOString()).toBe(parsed.savedAt);
    });

    it('serializes empty snapshot', () => {
      const snapshot = {};
      const json = serializeConfig(snapshot);
      const parsed = JSON.parse(json);

      expect(parsed.version).toBe(CONFIG_VERSION);
      expect(parsed.snapshot).toEqual({});
      expect(typeof parsed.savedAt).toBe('string');
    });
  });

  describe('deserializeConfig', () => {
    it('deserializes valid JSON', () => {
      const snapshot = {
        sshKeyPath: '/home/user/.ssh/id_rsa',
        environment: 'production',
      };
      const json = serializeConfig(snapshot);

      const result = deserializeConfig(json);

      expect(result).not.toBeNull();
      expect(result?.version).toBe(CONFIG_VERSION);
      expect(result?.snapshot).toEqual(snapshot);
      expect(typeof result?.savedAt).toBe('string');
    });

    it('returns null for invalid JSON', () => {
      const result = deserializeConfig('not valid json');
      expect(result).toBeNull();
    });

    it('returns null for non-object JSON', () => {
      const result = deserializeConfig('"string"');
      expect(result).toBeNull();
    });

    it('returns null for null JSON', () => {
      const result = deserializeConfig('null');
      expect(result).toBeNull();
    });

    it('returns null when version is missing', () => {
      const json = JSON.stringify({
        snapshot: {},
        savedAt: new Date().toISOString(),
      });

      const result = deserializeConfig(json);
      expect(result).toBeNull();
    });

    it('returns null when version is not a number', () => {
      const json = JSON.stringify({
        version: '1',
        snapshot: {},
        savedAt: new Date().toISOString(),
      });

      const result = deserializeConfig(json);
      expect(result).toBeNull();
    });

    it('returns null for unsupported version', () => {
      const json = JSON.stringify({
        version: 999,
        snapshot: {},
        savedAt: new Date().toISOString(),
      });

      const result = deserializeConfig(json);
      expect(result).toBeNull();
    });

    it('returns null when snapshot is missing', () => {
      const json = JSON.stringify({
        version: CONFIG_VERSION,
        savedAt: new Date().toISOString(),
      });

      const result = deserializeConfig(json);
      expect(result).toBeNull();
    });

    it('returns null when snapshot is not an object', () => {
      const json = JSON.stringify({
        version: CONFIG_VERSION,
        snapshot: 'not an object',
        savedAt: new Date().toISOString(),
      });

      const result = deserializeConfig(json);
      expect(result).toBeNull();
    });

    it('returns null when savedAt is missing', () => {
      const json = JSON.stringify({
        version: CONFIG_VERSION,
        snapshot: {},
      });

      const result = deserializeConfig(json);
      expect(result).toBeNull();
    });

    it('returns null when savedAt is not a string', () => {
      const json = JSON.stringify({
        version: CONFIG_VERSION,
        snapshot: {},
        savedAt: 12345,
      });

      const result = deserializeConfig(json);
      expect(result).toBeNull();
    });

    it('allows empty snapshot', () => {
      const json = serializeConfig({});
      const result = deserializeConfig(json);

      expect(result).not.toBeNull();
      expect(result?.snapshot).toEqual({});
    });
  });

  describe('validateStoredConfig', () => {
    it('is an alias for deserializeConfig', () => {
      const snapshot = { environment: 'production' };
      const json = serializeConfig(snapshot);

      const result = validateStoredConfig(json);

      expect(result).not.toBeNull();
      expect(result?.snapshot).toEqual(snapshot);
    });

    it('returns null for invalid JSON', () => {
      const result = validateStoredConfig('invalid');
      expect(result).toBeNull();
    });

    it('returns null for unsupported version', () => {
      const json = JSON.stringify({
        version: 999,
        snapshot: {},
        savedAt: new Date().toISOString(),
      });

      const result = validateStoredConfig(json);
      expect(result).toBeNull();
    });
  });

  describe('round-trip serialization', () => {
    it('preserves snapshot through serialize/deserialize cycle', () => {
      const original = {
        sshKeyPath: '/home/user/.ssh/id_rsa',
        composeServices: ['web', 'db', 'cache'],
        preferDockerfile: false,
        environment: 'staging',
        dockerfilePath: 'docker/Dockerfile.staging',
        dockerTarget: 'staging',
        buildContext: './services',
      };

      const json = serializeConfig(original);
      const result = deserializeConfig(json);

      expect(result?.snapshot).toEqual(original);
    });

    it('preserves partial snapshot through round-trip', () => {
      const original = {
        sshKeyPath: '/home/user/.ssh/id_rsa',
        environment: 'production',
      };

      const json = serializeConfig(original);
      const result = deserializeConfig(json);

      expect(result?.snapshot).toEqual(original);
    });

    it('preserves empty snapshot through round-trip', () => {
      const original = {};

      const json = serializeConfig(original);
      const result = deserializeConfig(json);

      expect(result?.snapshot).toEqual(original);
    });
  });
});
