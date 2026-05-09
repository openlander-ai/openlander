import { describe, it, expect } from 'vitest';
import { createDeployPlanSchema } from '../../src/tools/defs/schemas.js';

describe('createDeployPlanSchema - image deployment validation', () => {
  it('accepts valid image params with source=image', () => {
    const input = {
      source: 'image',
      image: 'nginx:latest',
      name: 'my-nginx',
      port: 80,
    };

    const result = createDeployPlanSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.source).toBe('image');
      expect(result.data.image).toBe('nginx:latest');
      expect(result.data.name).toBe('my-nginx');
      expect(result.data.port).toBe(80);
    }
  });

  it('rejects source=image without image field', () => {
    const input = {
      source: 'image',
      name: 'my-app',
      port: 80,
    };

    const result = createDeployPlanSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toContain('image is required');
    }
  });

  it('accepts source=git with repo_url (backward compatible)', () => {
    const input = {
      source: 'git',
      repo_url: 'https://github.com/user/repo',
      branch: 'main',
    };

    const result = createDeployPlanSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.source).toBe('git');
      expect(result.data.repo_url).toBe('https://github.com/user/repo');
      expect(result.data.branch).toBe('main');
    }
  });

  it('accepts no source with repo_url (defaults to git behavior)', () => {
    const input = {
      repo_url: 'https://github.com/user/repo',
      name: 'my-project',
    };

    const result = createDeployPlanSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.repo_url).toBe('https://github.com/user/repo');
      expect(result.data.name).toBe('my-project');
    }
  });

  it('accepts cmd field with string array', () => {
    const input = {
      source: 'image',
      image: 'python:3.11',
      cmd: ['--model-id', 'BAAI/bge-m3'],
      port: 8000,
    };

    const result = createDeployPlanSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.cmd).toEqual(['--model-id', 'BAAI/bge-m3']);
    }
  });

  it('rejects port with negative value', () => {
    const input = {
      source: 'image',
      image: 'nginx:latest',
      port: -1,
    };

    const result = createDeployPlanSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('rejects port with zero value', () => {
    const input = {
      source: 'image',
      image: 'nginx:latest',
      port: 0,
    };

    const result = createDeployPlanSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('accepts valid combination of all optional fields', () => {
    const input = {
      source: 'image',
      image: 'node:22-alpine',
      name: 'api-server',
      port: 3000,
      cmd: ['node', 'server.js'],
      env_vars: '{"NODE_ENV":"production","DEBUG":"false"}',
    };

    const result = createDeployPlanSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.source).toBe('image');
      expect(result.data.image).toBe('node:22-alpine');
      expect(result.data.name).toBe('api-server');
      expect(result.data.port).toBe(3000);
      expect(result.data.cmd).toEqual(['node', 'server.js']);
      expect(result.data.env_vars).toBe('{"NODE_ENV":"production","DEBUG":"false"}');
    }
  });

  it('rejects when source=image but image is empty string', () => {
    const input = {
      source: 'image',
      image: '',
      port: 80,
    };

    const result = createDeployPlanSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('rejects when no source and no repo_url provided', () => {
    const input = {
      name: 'my-app',
      port: 8080,
    };

    const result = createDeployPlanSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toContain('repo_url is required');
    }
  });
});
