import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createDependencyCacheKey,
  hasGitDependencySpec,
  isGitDependencySpecifier,
} from '../src/pipeline/build-cache.js';

describe('git dependency cache detection', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'openlander-build-cache-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('does not treat package metadata URLs as git dependencies', () => {
    writeFileSync(
      join(tmpDir, 'package.json'),
      JSON.stringify({
        repository: { url: 'https://github.com/acme/app.git' },
        bugs: { url: 'https://github.com/acme/app/issues' },
        homepage: 'https://github.com/acme/app#readme',
        dependencies: {
          express: '^5.0.0',
        },
      }),
      'utf8',
    );

    expect(hasGitDependencySpec(tmpDir)).toBe(false);
    expect(
      createDependencyCacheKey({ repoPath: tmpDir, commitSha: 'abc123', volatileSalt: 1 }),
    ).toBe(null);
  });

  it('detects git specs only inside dependency values', () => {
    writeFileSync(
      join(tmpDir, 'package.json'),
      JSON.stringify({
        dependencies: {
          'internal-lib': 'git+https://github.com/acme/internal-lib.git#main',
        },
      }),
      'utf8',
    );

    expect(hasGitDependencySpec(tmpDir)).toBe(true);
    expect(
      createDependencyCacheKey({ repoPath: tmpDir, commitSha: 'abc123', volatileSalt: 42 }),
    ).toEqual({
      key: 'git-dependency:abc123:42',
      reason: 'git_dependency',
    });
  });

  it('detects git dependency files inside an explicit build context', () => {
    mkdirSync(join(tmpDir, 'apps', 'api'), { recursive: true });
    writeFileSync(
      join(tmpDir, 'package.json'),
      JSON.stringify({
        dependencies: {
          express: '^5.0.0',
        },
      }),
      'utf8',
    );
    writeFileSync(
      join(tmpDir, 'apps', 'api', 'package.json'),
      JSON.stringify({
        dependencies: {
          'internal-lib': 'github:acme/internal-lib#main',
        },
      }),
      'utf8',
    );

    expect(hasGitDependencySpec(tmpDir)).toBe(false);
    expect(hasGitDependencySpec(tmpDir, ['apps/api'])).toBe(true);
    expect(
      createDependencyCacheKey({
        repoPath: tmpDir,
        commitSha: 'abc123',
        volatileSalt: 7,
        dependencyPaths: ['apps/api'],
      }),
    ).toEqual({
      key: 'git-dependency:abc123:7',
      reason: 'git_dependency',
    });
  });

  it('detects git dependency files next to an explicit Dockerfile path', () => {
    mkdirSync(join(tmpDir, 'services', 'worker'), { recursive: true });
    writeFileSync(join(tmpDir, 'services', 'worker', 'Dockerfile'), 'FROM node:22\n', 'utf8');
    writeFileSync(
      join(tmpDir, 'services', 'worker', 'package.json'),
      JSON.stringify({
        dependencies: {
          'internal-lib': 'git+https://github.com/acme/internal-lib.git',
        },
      }),
      'utf8',
    );

    expect(hasGitDependencySpec(tmpDir, ['services/worker/Dockerfile'])).toBe(true);
  });

  it('ignores dependency path candidates outside the cloned repo', () => {
    const outside = mkdtempSync(join(tmpdir(), 'openlander-build-cache-outside-'));
    try {
      writeFileSync(
        join(outside, 'package.json'),
        JSON.stringify({
          dependencies: {
            'internal-lib': 'github:acme/internal-lib',
          },
        }),
        'utf8',
      );

      expect(hasGitDependencySpec(tmpDir, [outside])).toBe(false);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('detects requirements.txt git dependency lines', () => {
    writeFileSync(
      join(tmpDir, 'requirements.txt'),
      ['fastapi==0.115.0', '-e git+https://github.com/acme/internal-py.git#egg=internal_py'].join(
        '\n',
      ),
      'utf8',
    );

    expect(hasGitDependencySpec(tmpDir)).toBe(true);
  });

  it('accepts common npm git dependency specifiers', () => {
    expect(isGitDependencySpecifier('github:acme/internal-lib#main')).toBe(true);
    expect(isGitDependencySpecifier('acme/internal-lib#main')).toBe(true);
    expect(isGitDependencySpecifier('^1.2.3')).toBe(false);
    expect(isGitDependencySpecifier('./packages/internal-lib')).toBe(false);
    expect(isGitDependencySpecifier('../internal-lib')).toBe(false);
  });
});
