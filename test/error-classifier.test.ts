/**
 * Unit tests for `classifyDeployError` — covers each row in the
 * indicative classification map (Phase E_NEW plan, Architect iteration-4).
 *
 * Co-located in `test/` rather than `src/pipeline/__tests__/` to match
 * this repo's vitest config (`test/**\/*.test.{ts,tsx}`).
 */
import { describe, expect, it } from 'vitest';
import {
  classifyDeployError,
  ERROR_CLASS_VALUES,
  type ErrorClass,
} from '../src/pipeline/error-classifier.js';

describe('classifyDeployError — indicative map', () => {
  it('OOM_KILLED — Docker dockerReason=OOMKilled', () => {
    expect(classifyDeployError({ dockerReason: 'OOMKilled', message: 'killed' })).toBe(
      'OOM_KILLED',
    );
  });

  it('OOM_KILLED — exitCode 137', () => {
    expect(classifyDeployError({ exitCode: 137, message: 'container exited' })).toBe('OOM_KILLED');
  });

  it('PORT_CONFLICT — EADDRINUSE', () => {
    expect(classifyDeployError(new Error('listen tcp :3000: bind: EADDRINUSE'))).toBe(
      'PORT_CONFLICT',
    );
  });

  it('PORT_CONFLICT — port is already allocated (Docker)', () => {
    expect(
      classifyDeployError(
        new Error('Bind for 0.0.0.0:3000 failed: port is already allocated'),
      ),
    ).toBe('PORT_CONFLICT');
  });

  it('GIT_ACCESS_DENIED — SSH publickey rejected', () => {
    expect(classifyDeployError(new Error('git@github.com: Permission denied (publickey).'))).toBe(
      'GIT_ACCESS_DENIED',
    );
  });

  it('GIT_ACCESS_DENIED — HTTP 404 repo not found', () => {
    expect(
      classifyDeployError(
        new Error("fatal: repository 'https://github.com/x/y' not found (404)"),
      ),
    ).toBe('GIT_ACCESS_DENIED');
  });

  it('GIT_ACCESS_DENIED — HTTP 401 authentication failed', () => {
    expect(
      classifyDeployError(
        new Error("fatal: Authentication failed for 'https://github.com/foo/bar.git'"),
      ),
    ).toBe('GIT_ACCESS_DENIED');
  });

  it('DEPENDENCY_UNHEALTHY — compose dependency health timeout', () => {
    expect(
      classifyDeployError(
        new Error('dependency failed to start: container postgres is unhealthy'),
      ),
    ).toBe('DEPENDENCY_UNHEALTHY');
  });

  it('DB_EXTENSION_MISSING — Postgres extension', () => {
    expect(classifyDeployError(new Error('ERROR: extension "vector" is not available'))).toBe(
      'DB_EXTENSION_MISSING',
    );
  });

  it('DOCKER_DAEMON_UNREACHABLE — docker.sock connection refused', () => {
    expect(
      classifyDeployError(
        new Error('Get http://%2Fvar%2Frun%2Fdocker.sock/v1.41/info: connection refused'),
      ),
    ).toBe('DOCKER_DAEMON_UNREACHABLE');
  });

  it('DOCKER_DAEMON_UNREACHABLE — generic daemon unreachable string', () => {
    expect(
      classifyDeployError(new Error('Cannot connect to the Docker daemon at unix:///var/run/...')),
    ).toBe('DOCKER_DAEMON_UNREACHABLE');
  });

  it('DISK_EXHAUSTED — ENOSPC', () => {
    expect(classifyDeployError(new Error('write /var/lib/docker/x: ENOSPC: no space left'))).toBe(
      'DISK_EXHAUSTED',
    );
  });

  it('NETWORK_DEPENDENCY_UNREACHABLE — registry pull i/o timeout', () => {
    expect(
      classifyDeployError(
        new Error(
          'failed to pull image node:20-alpine: net/http: i/o timeout while contacting registry',
        ),
      ),
    ).toBe('NETWORK_DEPENDENCY_UNREACHABLE');
  });

  it('HEALTHCHECK_TIMEOUT — own healthcheck timed out', () => {
    expect(
      classifyDeployError(
        new Error('Container web did not become healthy within start_period+retries window'),
      ),
    ).toBe('HEALTHCHECK_TIMEOUT');
  });

  it('BUILD_TIMEOUT — explicit build timeout', () => {
    expect(classifyDeployError(new Error('Build exceeded 20m timeout'))).toBe('BUILD_TIMEOUT');
  });

  it('BUILD_CONTEXT_MISMATCH — Dockerfile COPY missing path', () => {
    expect(
      classifyDeployError(
        new Error(
          'failed to solve: failed to compute cache key: COPY apps/web ./apps/web: not found in build context',
        ),
      ),
    ).toBe('BUILD_CONTEXT_MISMATCH');
  });

  it('IMAGE_WRONG_STAGE — multi-stage target not found', () => {
    expect(
      classifyDeployError(new Error('failed to solve: target stage builder could not be found')),
    ).toBe('IMAGE_WRONG_STAGE');
  });

  it('CONFIG_MISSING — Prisma DATABASE_URL not set', () => {
    expect(
      classifyDeployError(
        new Error('Environment variable not found: DATABASE_URL during prisma generate'),
      ),
    ).toBe('CONFIG_MISSING');
  });

  it('CLI_OVERRIDE_SYNTAX — leading docker docker', () => {
    expect(classifyDeployError(new Error('exec: "docker docker compose": no such file'))).toBe(
      'CLI_OVERRIDE_SYNTAX',
    );
  });

  it('INFRA_UNAVAILABLE — agent unreachable', () => {
    expect(
      classifyDeployError(new Error('OpenLander agent unreachable: 3 retries × 30s')),
    ).toBe('INFRA_UNAVAILABLE');
  });

  it('RUNTIME_CRASH — default fallback for unknown signal', () => {
    expect(classifyDeployError(new Error('something blew up'))).toBe('RUNTIME_CRASH');
  });

  it('RUNTIME_CRASH — non-Error input falls through', () => {
    expect(classifyDeployError(undefined)).toBe('RUNTIME_CRASH');
    expect(classifyDeployError(null)).toBe('RUNTIME_CRASH');
    expect(classifyDeployError(42)).toBe('RUNTIME_CRASH');
  });

  it('every key returned by the classifier is in the union', () => {
    const set = new Set<ErrorClass>(ERROR_CLASS_VALUES);
    expect(set.size).toBe(16);
    // Smoke: classifier never returns a string outside the union.
    const sampled: unknown = classifyDeployError(new Error('weird'));
    expect(typeof sampled).toBe('string');
    expect(set.has(sampled as ErrorClass)).toBe(true);
  });
});
