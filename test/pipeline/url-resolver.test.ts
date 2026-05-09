import { afterEach, describe, expect, it } from 'vitest';
import {
  resolveContainerUrl,
  resolveContainerHost,
  resolveContainerName,
} from '../../src/pipeline/url-resolver.js';

const originalContainerized = process.env.OPENLANDER_CONTAINERIZED;
const originalContainerHost = process.env.OPENLANDER_CONTAINER_HOST;

afterEach(() => {
  if (originalContainerized === undefined) {
    delete process.env.OPENLANDER_CONTAINERIZED;
  } else {
    process.env.OPENLANDER_CONTAINERIZED = originalContainerized;
  }

  if (originalContainerHost === undefined) {
    delete process.env.OPENLANDER_CONTAINER_HOST;
  } else {
    process.env.OPENLANDER_CONTAINER_HOST = originalContainerHost;
  }
});

describe('resolveContainerUrl', () => {
  it('returns localhost URL for default server', () => {
    expect(resolveContainerUrl(3000)).toBe('http://localhost:3000');
  });

  it('returns localhost URL when serverId is local', () => {
    expect(resolveContainerUrl(8080, 'local')).toBe('http://localhost:8080');
  });

  it('returns localhost URL even for unknown serverId (single-server mode)', () => {
    expect(resolveContainerUrl(443, 'some-server')).toBe('http://localhost:443');
  });

  it('handles various port numbers correctly', () => {
    expect(resolveContainerUrl(5432)).toBe('http://localhost:5432');
    expect(resolveContainerUrl(6379)).toBe('http://localhost:6379');
    expect(resolveContainerUrl(27017)).toBe('http://localhost:27017');
  });
});

describe('resolveContainerHost', () => {
  it('returns localhost for no serverId', () => {
    expect(resolveContainerHost()).toBe('localhost');
  });

  it('returns localhost for local serverId', () => {
    expect(resolveContainerHost('local')).toBe('localhost');
  });

  it('returns localhost for unknown serverId (single-server mode)', () => {
    expect(resolveContainerHost('remote-server')).toBe('localhost');
  });

  it('returns host.docker.internal for containerized runtime', () => {
    process.env.OPENLANDER_CONTAINERIZED = 'true';

    expect(resolveContainerHost()).toBe('host.docker.internal');
    expect(resolveContainerUrl(3000)).toBe('http://host.docker.internal:3000');
  });

  it('uses OPENLANDER_CONTAINER_HOST override for containerized runtime', () => {
    process.env.OPENLANDER_CONTAINERIZED = 'true';
    process.env.OPENLANDER_CONTAINER_HOST = 'docker-host.internal';

    expect(resolveContainerHost()).toBe('docker-host.internal');
    expect(resolveContainerUrl(8080)).toBe('http://docker-host.internal:8080');
  });

  it('falls back to localhost when OPENLANDER_CONTAINERIZED is unset', () => {
    delete process.env.OPENLANDER_CONTAINERIZED;
    process.env.OPENLANDER_CONTAINER_HOST = 'ignored-host.internal';

    expect(resolveContainerHost()).toBe('localhost');
  });
});

describe('resolveContainerName', () => {
  it('returns ol-prefixed name for project', () => {
    expect(resolveContainerName('myapp')).toBe('ol-myapp');
  });

  it('ignores serverId in single-server mode', () => {
    expect(resolveContainerName('myapp', 'local')).toBe('ol-myapp');
  });

  it('handles various project names correctly', () => {
    expect(resolveContainerName('my-project')).toBe('ol-my-project');
    expect(resolveContainerName('test_app')).toBe('ol-test_app');
    expect(resolveContainerName('app123')).toBe('ol-app123');
  });
});
