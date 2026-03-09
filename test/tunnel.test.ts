import { describe, expect, it } from 'vitest';

import {
  extractHostname,
  generateQuickShareYaml,
  generateSharedYaml,
} from '../src/pipeline/tunnel.js';

describe('tunnel YAML generation', () => {
  it('generateQuickShareYaml produces valid Traefik YAML', () => {
    const yaml = generateQuickShareYaml('myapp', 'shy-tiger-abc123.trycloudflare.com');

    expect(yaml).toContain('qs-myapp');
    expect(yaml).toContain('Host(`shy-tiger-abc123.trycloudflare.com`)');
    expect(yaml).toContain('ol-myapp@docker');
    expect(yaml).toContain('entryPoints');
    expect(yaml).toContain('web');
    expect(yaml).not.toContain('middlewares');
    expect(yaml).not.toContain('basicAuth');
  });

  it('generateSharedYaml includes BasicAuth middleware', () => {
    const yaml = generateSharedYaml('myapp', 'shy-tiger-abc123.trycloudflare.com', 'secret123');

    expect(yaml).toContain('qs-myapp');
    expect(yaml).toContain('Host(`shy-tiger-abc123.trycloudflare.com`)');
    expect(yaml).toContain('ol-myapp@docker');
    expect(yaml).toContain('middlewares');
    expect(yaml).toContain('qs-auth-myapp');
    expect(yaml).toContain('basicAuth');
    expect(yaml).toContain('viewer:');
    expect(yaml).toMatch(/\$2[aby]\$/);
    expect(yaml).not.toContain('secret123');
  });

  it('generateSharedYaml produces different hashes for different codes', () => {
    const yaml1 = generateSharedYaml('app', 'host.com', 'code1');
    const yaml2 = generateSharedYaml('app', 'host.com', 'code2');

    const hash1 = yaml1.match(/viewer:(\$2[^\s"]+)/)?.[1];
    const hash2 = yaml2.match(/viewer:(\$2[^\s"]+)/)?.[1];

    expect(hash1).toBeDefined();
    expect(hash2).toBeDefined();
    expect(hash1).not.toBe(hash2);
  });

  it('extractHostname extracts hostname from URL', () => {
    expect(extractHostname('https://shy-tiger-abc123.trycloudflare.com')).toBe(
      'shy-tiger-abc123.trycloudflare.com',
    );
    expect(extractHostname('https://example.com/path')).toBe('example.com');
  });

  it('generateQuickShareYaml handles special characters in project name', () => {
    const yaml = generateQuickShareYaml('my-app-2', 'host.trycloudflare.com');

    expect(yaml).toContain('qs-my-app-2');
    expect(yaml).toContain('ol-my-app-2@docker');
  });
});
