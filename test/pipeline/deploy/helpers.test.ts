import { describe, expect, it } from 'vitest';
import {
  parsePendingFix,
  detectFailStep,
  resolveDockerfilePath,
  deriveServiceName,
  getRouteName,
} from '../../../src/pipeline/deploy/helpers.js';

describe('parsePendingFix', () => {
  it('parses valid JSON with filePath and content', () => {
    const result = parsePendingFix('{"filePath":"Dockerfile","content":"FROM node:20"}');
    expect(result).toEqual({
      filePath: 'Dockerfile',
      content: 'FROM node:20',
    });
  });

  it('returns null for invalid JSON', () => {
    const result = parsePendingFix('not json');
    expect(result).toBeNull();
  });

  it('returns null when filePath is missing', () => {
    const result = parsePendingFix('{"content":"FROM node:20"}');
    expect(result).toBeNull();
  });

  it('returns null when content is missing', () => {
    const result = parsePendingFix('{"filePath":"Dockerfile"}');
    expect(result).toBeNull();
  });

  it('parses valid JSON with filePath and patches', () => {
    const result = parsePendingFix(
      JSON.stringify({
        filePath: 'Dockerfile',
        patches: [{ pattern: 'FROM node:22-alpine', replacement: 'FROM node:22-bookworm-slim' }],
      }),
    );

    expect(result).toEqual({
      filePath: 'Dockerfile',
      patches: [
        {
          pattern: 'FROM node:22-alpine',
          replacement: 'FROM node:22-bookworm-slim',
          flags: 'gm',
        },
      ],
    });
  });

  it('parses patch flags when provided', () => {
    const result = parsePendingFix(
      JSON.stringify({
        filePath: 'Dockerfile',
        patches: [
          {
            pattern: '^CMD',
            replacement: 'ENV NODE_OPTIONS="--max-old-space-size=4096"\n$&',
            flags: 'm',
          },
        ],
      }),
    );

    expect(result).toEqual({
      filePath: 'Dockerfile',
      patches: [
        {
          pattern: '^CMD',
          replacement: 'ENV NODE_OPTIONS="--max-old-space-size=4096"\n$&',
          flags: 'm',
        },
      ],
    });
  });

  it('returns null when patches array exists but no valid patches', () => {
    const result = parsePendingFix(
      JSON.stringify({
        filePath: 'Dockerfile',
        patches: [{ pattern: 123, replacement: false }],
      }),
    );
    expect(result).toBeNull();
  });

  it('returns null when filePath is not a string', () => {
    const result = parsePendingFix('{"filePath":123,"content":"FROM node:20"}');
    expect(result).toBeNull();
  });

  it('returns null when content is not a string', () => {
    const result = parsePendingFix('{"filePath":"Dockerfile","content":123}');
    expect(result).toBeNull();
  });
});

describe('detectFailStep', () => {
  it('returns clone when [clone] is missing', () => {
    const result = detectFailStep('[dockerfile] step\n[build] step');
    expect(result).toBe('clone');
  });

  it('returns dockerfile when [dockerfile] is missing', () => {
    const result = detectFailStep('[clone] step\n[build] step');
    expect(result).toBe('dockerfile');
  });

  it('returns build when [build] is missing', () => {
    const result = detectFailStep('[clone] step\n[dockerfile] step\n[run] step');
    expect(result).toBe('build');
  });

  it('returns run when [run] is missing', () => {
    const result = detectFailStep('[clone] step\n[dockerfile] step\n[build] step');
    expect(result).toBe('run');
  });

  it('returns runtime when Container crashed after start is present', () => {
    const result = detectFailStep(
      '[clone] step\n[dockerfile] step\n[build] step\n[run] step\nContainer crashed after start',
    );
    expect(result).toBe('runtime');
  });

  it('returns clone for empty log (first missing step)', () => {
    const result = detectFailStep('');
    expect(result).toBe('clone');
  });

  it('returns unknown when all steps are present and no crash', () => {
    const result = detectFailStep('[clone] step\n[dockerfile] step\n[build] step\n[run] step');
    expect(result).toBe('unknown');
  });
});

describe('resolveDockerfilePath', () => {
  it('returns default Dockerfile path when dockerfilePath is undefined', () => {
    const result = resolveDockerfilePath('/repo');
    expect(result).toBe('/repo/Dockerfile');
  });

  it('returns default Dockerfile path when dockerfilePath is empty string', () => {
    const result = resolveDockerfilePath('/repo', '');
    expect(result).toBe('/repo/Dockerfile');
  });

  it('returns default Dockerfile path when dockerfilePath is whitespace', () => {
    const result = resolveDockerfilePath('/repo', '   ');
    expect(result).toBe('/repo/Dockerfile');
  });

  it('resolves relative path correctly', () => {
    const result = resolveDockerfilePath('/repo', 'services/api/Dockerfile');
    expect(result).toContain('services/api/Dockerfile');
  });

  it('throws error for absolute path', () => {
    expect(() => {
      resolveDockerfilePath('/repo', '/Dockerfile');
    }).toThrow('Dockerfile path must be relative');
  });

  it('throws error when path escapes repository root', () => {
    expect(() => {
      resolveDockerfilePath('/repo', '../../etc/passwd');
    }).toThrow('Dockerfile path escaped repository root');
  });

  it('normalizes backslashes to forward slashes', () => {
    const result = resolveDockerfilePath('/repo', 'services\\api\\Dockerfile');
    expect(result).toContain('services/api/Dockerfile');
  });
});

describe('deriveServiceName', () => {
  it('returns app for root Dockerfile', () => {
    const result = deriveServiceName('Dockerfile');
    expect(result).toBe('app');
  });

  it('returns app for current directory', () => {
    const result = deriveServiceName('./Dockerfile');
    expect(result).toBe('app');
  });

  it('returns first directory component for nested path', () => {
    const result = deriveServiceName('services/api/Dockerfile');
    expect(result).toBe('services');
  });

  it('returns app when dirname is dot', () => {
    const result = deriveServiceName('');
    expect(result).toBe('app');
  });

  it('extracts service name from single-level subdirectory', () => {
    const result = deriveServiceName('web/Dockerfile');
    expect(result).toBe('web');
  });
});

describe('getRouteName', () => {
  it('returns projectName for production environment', () => {
    const result = getRouteName('myapp', 'production');
    expect(result).toBe('myapp');
  });

  it('returns projectName-dev for development environment', () => {
    const result = getRouteName('myapp', 'development');
    expect(result).toBe('myapp-dev');
  });

  it('returns projectName-staging for staging environment', () => {
    const result = getRouteName('myapp', 'staging');
    expect(result).toBe('myapp-staging');
  });

  it('returns projectName-custom for custom environment type', () => {
    const result = getRouteName('myapp', 'custom');
    expect(result).toBe('myapp-custom');
  });

  it('handles projectName with hyphens', () => {
    const result = getRouteName('my-app', 'development');
    expect(result).toBe('my-app-dev');
  });
});
