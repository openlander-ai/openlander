import { describe, expect, it } from 'vitest';
import {
  resolveContainerUrl,
  resolveContainerHost,
  resolveContainerName,
} from '../../src/pipeline/url-resolver.js';

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
