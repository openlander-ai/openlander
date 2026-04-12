import { describe, it, expect, vi } from 'vitest';
import {
  parseImageUrl,
  getImageExposedPort,
  mapPullError,
} from '../../src/pipeline/image-utils.js';
import type { Docker } from '../../src/pipeline/docker.js';

describe('parseImageUrl', () => {
  it('parses simple image name with default tag', () => {
    const result = parseImageUrl('nginx');
    expect(result).toEqual({ name: 'nginx', tag: 'latest' });
  });

  it('parses image with explicit tag', () => {
    const result = parseImageUrl('nginx:1.25-alpine');
    expect(result).toEqual({ name: 'nginx', tag: '1.25-alpine' });
  });

  it('parses image with registry and tag', () => {
    const result = parseImageUrl('ghcr.io/user/app:v1.0');
    expect(result).toEqual({ registry: 'ghcr.io', name: 'user/app', tag: 'v1.0' });
  });

  it('parses docker.io with library path', () => {
    const result = parseImageUrl('docker.io/library/nginx:latest');
    expect(result).toEqual({ registry: 'docker.io', name: 'library/nginx', tag: 'latest' });
  });

  it('parses localhost registry with port', () => {
    const result = parseImageUrl('localhost:5000/myapp:v1');
    expect(result).toEqual({ registry: 'localhost:5000', name: 'myapp', tag: 'v1' });
  });

  it('parses image with multiple path segments', () => {
    const result = parseImageUrl('registry.example.com/org/team/app:v2.0');
    expect(result).toEqual({ registry: 'registry.example.com', name: 'org/team/app', tag: 'v2.0' });
  });

  it('rejects empty string', () => {
    expect(parseImageUrl('')).toBeNull();
  });

  it('rejects whitespace-only string', () => {
    expect(parseImageUrl('   ')).toBeNull();
  });

  it('rejects string with spaces', () => {
    expect(parseImageUrl('nginx latest')).toBeNull();
  });

  it('rejects invalid characters in name', () => {
    expect(parseImageUrl('nginx@invalid')).toBeNull();
  });

  it('rejects image with only registry', () => {
    expect(parseImageUrl('ghcr.io/')).toBeNull();
  });

  it('handles tag with dots and hyphens', () => {
    const result = parseImageUrl('node:18.16.0-alpine3.17');
    expect(result).toEqual({ name: 'node', tag: '18.16.0-alpine3.17' });
  });

  it('treats colon in registry as part of registry, not tag', () => {
    const result = parseImageUrl('localhost:5000/app');
    expect(result).toEqual({ registry: 'localhost:5000', name: 'app', tag: 'latest' });
  });
});

describe('getImageExposedPort', () => {
  it('returns lowest exposed port from image', async () => {
    const mockDocker = {
      inspectImage: vi.fn().mockResolvedValue({
        Config: {
          ExposedPorts: {
            '80/tcp': {},
            '443/tcp': {},
            '8080/tcp': {},
          },
        },
      }),
    } as unknown as Docker;

    const result = await getImageExposedPort(mockDocker, 'nginx:latest');
    expect(result).toBe(80);
  });

  it('filters out management ports', async () => {
    const mockDocker = {
      inspectImage: vi.fn().mockResolvedValue({
        Config: {
          ExposedPorts: {
            '9090/tcp': {},
            '8080/tcp': {},
            '9091/tcp': {},
          },
        },
      }),
    } as unknown as Docker;

    const result = await getImageExposedPort(mockDocker, 'app:latest');
    expect(result).toBe(8080);
  });

  it('returns null when no exposed ports', async () => {
    const mockDocker = {
      inspectImage: vi.fn().mockResolvedValue({
        Config: {
          ExposedPorts: {},
        },
      }),
    } as unknown as Docker;

    const result = await getImageExposedPort(mockDocker, 'scratch:latest');
    expect(result).toBeNull();
  });

  it('returns null when ExposedPorts is undefined', async () => {
    const mockDocker = {
      inspectImage: vi.fn().mockResolvedValue({
        Config: {},
      }),
    } as unknown as Docker;

    const result = await getImageExposedPort(mockDocker, 'app:latest');
    expect(result).toBeNull();
  });

  it('returns null when image inspect fails', async () => {
    const mockDocker = {
      inspectImage: vi.fn().mockRejectedValue(new Error('Image not found')),
    } as unknown as Docker;

    const result = await getImageExposedPort(mockDocker, 'nonexistent:latest');
    expect(result).toBeNull();
  });

  it('handles single exposed port', async () => {
    const mockDocker = {
      inspectImage: vi.fn().mockResolvedValue({
        Config: {
          ExposedPorts: {
            '3000/tcp': {},
          },
        },
      }),
    } as unknown as Docker;

    const result = await getImageExposedPort(mockDocker, 'app:latest');
    expect(result).toBe(3000);
  });
});

describe('mapPullError', () => {
  it('maps repository not found error', () => {
    const error = new Error('repository does not exist');
    const result = mapPullError(error);
    expect(result).toBe('Image not found. Check the image name and try again.');
  });

  it('maps not found error', () => {
    const error = new Error('not found: manifest not found');
    const result = mapPullError(error);
    expect(result).toBe('Image not found. Check the image name and try again.');
  });

  it('maps denied error', () => {
    const error = new Error('denied: access denied');
    const result = mapPullError(error);
    expect(result).toBe(
      'This appears to be a private image. Only public images are supported in the current version.',
    );
  });

  it('maps unauthorized error', () => {
    const error = new Error('unauthorized: authentication required');
    const result = mapPullError(error);
    expect(result).toBe(
      'This appears to be a private image. Only public images are supported in the current version.',
    );
  });

  it('maps no such host error', () => {
    const error = new Error('no such host');
    const result = mapPullError(error);
    expect(result).toBe('Cannot reach the registry. Check your network connection.');
  });

  it('maps connection refused error', () => {
    const error = new Error('connection refused');
    const result = mapPullError(error);
    expect(result).toBe('Cannot reach the registry. Check your network connection.');
  });

  it('returns default message for unknown error', () => {
    const error = new Error('some random error');
    const result = mapPullError(error);
    expect(result).toBe('Failed to pull image: some random error');
  });

  it('handles case-insensitive matching', () => {
    const error = new Error('DENIED: Access Denied');
    const result = mapPullError(error);
    expect(result).toBe(
      'This appears to be a private image. Only public images are supported in the current version.',
    );
  });
});
