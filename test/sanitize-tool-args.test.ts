import { describe, it, expect } from 'vitest';
import { sanitizeToolArguments } from '../web/src/lib/event-types';

describe('sanitizeToolArguments', () => {
  it('masks env_vars values to ***', () => {
    const args = {
      repo_url: 'https://github.com/user/app',
      env_vars: { DB_PASSWORD: 'secret123', API_KEY: 'sk-abc' },
      branch: 'main',
    };
    const sanitized = sanitizeToolArguments(args);
    expect(sanitized.repo_url).toBe('https://github.com/user/app');
    expect(sanitized.branch).toBe('main');
    expect(sanitized.env_vars).toEqual({ DB_PASSWORD: '***', API_KEY: '***' });
  });

  it('masks envVars values (camelCase variant)', () => {
    const args = {
      envVars: { SECRET: 'value' },
    };
    const sanitized = sanitizeToolArguments(args);
    expect(sanitized.envVars).toEqual({ SECRET: '***' });
  });

  it('redacts ssh_key_path', () => {
    const args = {
      repo_url: 'git@github.com:user/app',
      ssh_key_path: '/home/user/.ssh/id_rsa',
    };
    const sanitized = sanitizeToolArguments(args);
    expect(sanitized.ssh_key_path).toBe('[redacted]');
    expect(sanitized.repo_url).toBe('git@github.com:user/app');
  });

  it('redacts sshKeyPath (camelCase variant)', () => {
    const args = { sshKeyPath: '/path/to/key' };
    const sanitized = sanitizeToolArguments(args);
    expect(sanitized.sshKeyPath).toBe('[redacted]');
  });

  it('redacts token, api_key, password, secret', () => {
    const args = {
      token: 'ghp_abc123',
      api_key: 'sk-test',
      password: 'mypassword',
      secret: 'shh',
    };
    const sanitized = sanitizeToolArguments(args);
    expect(sanitized.token).toBe('[redacted]');
    expect(sanitized.api_key).toBe('[redacted]');
    expect(sanitized.password).toBe('[redacted]');
    expect(sanitized.secret).toBe('[redacted]');
  });

  it('passes through non-sensitive fields unchanged', () => {
    const args = {
      repo_url: 'https://github.com/user/app',
      branch: 'main',
      name: 'my-app',
      visibility: 'internal',
    };
    const sanitized = sanitizeToolArguments(args);
    expect(sanitized).toEqual(args);
  });

  it('handles empty args', () => {
    expect(sanitizeToolArguments({})).toEqual({});
  });

  it('handles env_vars that is not an object', () => {
    // Edge case: env_vars is a string (shouldn't happen but be safe)
    const args = { env_vars: 'not_an_object' };
    const sanitized = sanitizeToolArguments(args);
    expect(sanitized.env_vars).toBe('not_an_object'); // Passes through
  });
});
