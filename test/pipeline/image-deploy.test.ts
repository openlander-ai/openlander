import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Database } from '../../src/db/index.js';
import { buildDeployConfig } from '../../src/pipeline/build-deploy-config.js';
import { getImageExposedPort, mapPullError } from '../../src/pipeline/image-utils.js';
import type { Docker } from '../../src/pipeline/docker.js';

describe('image deployment branching', () => {
  let tempDir: string;
  let db: Database;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'openlander-image-deploy-'));
    db = new Database(join(tempDir, 'test.db'));
  });

  afterEach(() => {
    db.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns image deployment config when project source is image', () => {
    db.createProject({
      id: 'img-1',
      name: 'image-service',
      repoUrl: 'https://github.com/example/ignored-for-image',
      source: 'image',
      imageUrl: 'ghcr.io/openlander/image-service:v1',
      imageCmd: ['node', 'server.js'],
      containerPort: 8080,
    });

    const config = buildDeployConfig({ projectId: 'img-1', db });

    expect(config.source).toBe('image');
    expect(config.imageUrl).toBe('ghcr.io/openlander/image-service:v1');
    expect(config.imageCmd).toEqual(['node', 'server.js']);
    expect(config.containerPort).toBe(8080);
    expect(config.preferDockerfile).toBe(true);
  });

  it('preserves image_url, image_cmd, and container_port from DB columns', () => {
    db.createProject({
      id: 'img-2',
      name: 'preserve-image-fields',
      repoUrl: 'https://github.com/example/preserve-image-fields',
      source: 'image',
      imageUrl: 'docker.io/library/nginx:1.27-alpine',
      imageCmd: ['nginx', '-g', 'daemon off;'],
      containerPort: 80,
    });

    const config = buildDeployConfig({ projectId: 'img-2', db });

    expect(config.imageUrl).toBe('docker.io/library/nginx:1.27-alpine');
    expect(config.imageCmd).toEqual(['nginx', '-g', 'daemon off;']);
    expect(config.containerPort).toBe(80);
  });

  it('parses image_cmd JSON stored in DB into string[]', () => {
    db.createProject({
      id: 'img-3',
      name: 'json-image-cmd',
      repoUrl: 'https://github.com/example/json-image-cmd',
      source: 'image',
      imageUrl: 'ghcr.io/openlander/json-image-cmd:latest',
      imageCmd: ['python', '-m', 'app.main'],
    });

    const config = buildDeployConfig({ projectId: 'img-3', db });

    expect(config.imageCmd).toEqual(['python', '-m', 'app.main']);
  });

  it('detects lowest non-management EXPOSE port from inspect result', async () => {
    const mockDocker = {
      inspectImage: vi.fn().mockResolvedValue({
        Config: {
          ExposedPorts: {
            '9090/tcp': {},
            '3000/tcp': {},
            '8080/tcp': {},
          },
        },
      }),
    } as unknown as Docker;

    const port = await getImageExposedPort(mockDocker, 'ghcr.io/openlander/web:v2');

    expect(port).toBe(3000);
  });

  it('maps image pull failures to user-friendly messages', () => {
    expect(mapPullError(new Error('repository does not exist'))).toBe(
      'Image not found. Check the image name and try again.',
    );

    expect(mapPullError(new Error('unauthorized: authentication required'))).toBe(
      'This appears to be a private image. Only public images are supported in the current version.',
    );

    expect(mapPullError(new Error('no such host'))).toBe(
      'Cannot reach the registry. Check your network connection.',
    );
  });

  it('keeps git flow unchanged when source is explicitly git', () => {
    db.createProject({
      id: 'git-1',
      name: 'git-explicit',
      repoUrl: 'https://github.com/example/git-explicit',
      source: 'git',
      dockerfilePath: 'apps/api/Dockerfile',
    });

    const config = buildDeployConfig({ projectId: 'git-1', db });

    expect(config.source).toBe('git');
    expect(config.repoUrl).toBe('https://github.com/example/git-explicit');
    expect(config.imageUrl).toBeUndefined();
    expect(config.imageCmd).toBeUndefined();
  });

  it('keeps git flow unchanged when source is omitted (defaults to git)', () => {
    db.createProject({
      id: 'git-2',
      name: 'git-default',
      repoUrl: 'https://github.com/example/git-default',
    });

    const config = buildDeployConfig({ projectId: 'git-2', db });

    expect(config.source).toBe('git');
    expect(config.repoUrl).toBe('https://github.com/example/git-default');
    expect(config.imageUrl).toBeUndefined();
    expect(config.containerPort).toBeUndefined();
  });
});
