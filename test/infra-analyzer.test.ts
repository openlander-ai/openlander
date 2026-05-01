import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { ServiceRow } from '../src/db/index.js';
import { analyzeInfrastructure } from '../src/lib/infra-analyzer.js';

const fixturesRoot = join(process.cwd(), 'test', 'fixtures', 'infra-analyzer');

/**
 * Build a partial ServiceRow for fixture use. Post-0012 the canonical
 * field is `kind` (postgres/mysql/redis/mongo) — the legacy `type` field
 * (postgresql/mongodb) is no longer read by infra-analyzer. Test inputs
 * specify `type` for backward compat with older fixtures; we map to
 * `kind` here so the seam stays minimal.
 */
function legacyTypeToKind(legacy: string | undefined): ServiceRow['kind'] {
  switch (legacy) {
    case 'postgresql':
      return 'postgres';
    case 'mongodb':
      return 'mongo';
    case 'mysql':
      return 'mysql';
    case 'redis':
      return 'redis';
    default:
      return 'image';
  }
}

function service(partial: Partial<ServiceRow> & { type?: string }): ServiceRow {
  const legacyType = partial.type ?? 'postgresql';
  return {
    id: partial.id ?? 'svc-1',
    project_id: partial.project_id ?? '__orphan_managed',
    name: partial.name ?? 'shared-svc',
    kind: partial.kind ?? legacyTypeToKind(legacyType),
    parent_service_id: partial.parent_service_id ?? null,
    status: partial.status ?? 'running',
    visibility: partial.visibility ?? null,
    assigned_port: partial.assigned_port ?? null,
    container_id: partial.container_id ?? 'container-1',
    container_name: partial.container_name ?? 'ol-svc-shared',
    container_port: partial.container_port ?? (partial.port ?? 5432),
    image_tag: partial.image_tag ?? null,
    previous_image_tag: partial.previous_image_tag ?? null,
    public_url: partial.public_url ?? null,
    dockerfile_path: partial.dockerfile_path ?? null,
    docker_target: partial.docker_target ?? null,
    build_context: partial.build_context ?? null,
    build_method: partial.build_method ?? null,
    source: partial.source ?? 'image',
    image_url: partial.image_url ?? 'postgres:16-alpine',
    image_cmd: partial.image_cmd ?? null,
    pending_fix: partial.pending_fix ?? null,
    access_code: partial.access_code ?? null,
    access_code_iv: partial.access_code_iv ?? null,
    is_preview: partial.is_preview ?? null,
    pr_number: partial.pr_number ?? null,
    project_type: partial.project_type ?? 'web',
    health_check_strategy: partial.health_check_strategy ?? null,
    health_check_path: partial.health_check_path ?? null,
    recovering_started_at: partial.recovering_started_at ?? null,
    credentials: partial.credentials ?? null,
    created_at: partial.created_at ?? '2026-01-01T00:00:00.000Z',
    updated_at: partial.updated_at ?? '2026-01-01T00:00:00.000Z',
    archived_at: partial.archived_at ?? null,
    server_id: partial.server_id ?? 'local',
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

  it('detects dependencies in monorepo subdirectories', () => {
    const fixturePath = join(fixturesRoot, 'monorepo-python-api');

    const result = analyzeInfrastructure(fixturePath, []);
    const types = new Set(result.needs.map((need) => need.type));

    expect(types).toContain('postgresql');
    expect(types).toContain('redis');
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
