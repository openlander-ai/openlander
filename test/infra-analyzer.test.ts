import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { ServiceRow } from '../src/db/index.js';
import { analyzeInfrastructure } from '../src/lib/infra-analyzer.js';

const fixturesRoot = join(process.cwd(), 'test', 'fixtures', 'infra-analyzer');

function service(partial: Partial<ServiceRow>): ServiceRow {
  return {
    id: partial.id ?? 'svc-1',
    name: partial.name ?? 'shared-svc',
    type: partial.type ?? 'postgresql',
    image: partial.image ?? 'postgres:16-alpine',
    status: partial.status ?? 'running',
    container_id: partial.container_id ?? 'container-1',
    container_name: partial.container_name ?? 'ol-svc-shared',
    port: partial.port ?? 5432,
    env_vars: partial.env_vars ?? null,
    credentials: partial.credentials ?? null,
    created_at: partial.created_at ?? '2026-01-01T00:00:00.000Z',
    updated_at: partial.updated_at ?? '2026-01-01T00:00:00.000Z',
  };
}

describe('analyzeInfrastructure', () => {
  it('detects dependency and env-based needs with detectedFrom values', () => {
    const fixturePath = join(fixturesRoot, 'node-multi-needs');

    const result = analyzeInfrastructure(fixturePath, []);

    expect(result.needs).toEqual(
      expect.arrayContaining([
        { type: 'postgresql', detectedFrom: 'pg' },
        { type: 'redis', detectedFrom: 'ioredis' },
        { type: 'mysql', detectedFrom: 'MYSQL_URL' },
      ]),
    );
  });

  it('returns available and missing arrays with the required contract shape', () => {
    const fixturePath = join(fixturesRoot, 'node-multi-needs');
    const existingServices = [
      service({ id: 'svc-pg', name: 'shared-pg', type: 'postgresql' }),
      service({ id: 'svc-redis', name: 'shared-redis', type: 'redis', port: 6379 }),
      service({ id: 'svc-mongo', name: 'shared-mongo', type: 'mongodb', port: 27017 }),
    ];

    const result = analyzeInfrastructure(fixturePath, existingServices);

    expect(result.available).toEqual(
      expect.arrayContaining([
        { id: 'svc-pg', name: 'shared-pg', type: 'postgresql' },
        { id: 'svc-redis', name: 'shared-redis', type: 'redis' },
      ]),
    );
    expect(result.missing).toEqual([
      {
        type: 'mysql',
        suggestion: 'Create a mysql service to satisfy the detected dependency',
      },
    ]);
  });

  it('detects needs from .env.sample when package.json is missing', () => {
    const fixturePath = join(fixturesRoot, 'env-sample-only');

    const result = analyzeInfrastructure(fixturePath, []);

    expect(result.needs).toEqual([{ type: 'mongodb', detectedFrom: 'MONGODB_URI' }]);
    expect(result.available).toEqual([]);
    expect(result.missing).toEqual([
      {
        type: 'mongodb',
        suggestion: 'Create a mongodb service to satisfy the detected dependency',
      },
    ]);
  });

  it('detects python dependency needs from requirements.txt', () => {
    const fixturePath = join(fixturesRoot, 'python-requirements-postgres');

    const result = analyzeInfrastructure(fixturePath, []);

    expect(result.needs.map((need) => need.type)).toEqual(['postgresql']);
    expect(result.available).toEqual([]);
    expect(result.missing).toEqual([
      {
        type: 'postgresql',
        suggestion: 'Create a postgresql service to satisfy the detected dependency',
      },
    ]);
  });

  it('detects python dependency needs from pyproject.toml', () => {
    const fixturePath = join(fixturesRoot, 'python-pyproject-postgres-redis');

    const result = analyzeInfrastructure(fixturePath, []);

    expect(new Set(result.needs.map((need) => need.type))).toEqual(
      new Set(['postgresql', 'redis']),
    );
    expect(result.available).toEqual([]);
    expect(result.missing).toEqual(
      expect.arrayContaining([
        {
          type: 'postgresql',
          suggestion: 'Create a postgresql service to satisfy the detected dependency',
        },
        {
          type: 'redis',
          suggestion: 'Create a redis service to satisfy the detected dependency',
        },
      ]),
    );
  });

  it('returns empty analysis for an empty repository input', () => {
    const fixturePath = join(fixturesRoot, 'empty-repo');

    const result = analyzeInfrastructure(fixturePath, []);

    expect(result).toEqual({
      needs: [],
      available: [],
      missing: [],
    });
  });
});
