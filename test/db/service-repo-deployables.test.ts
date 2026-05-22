import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { inferManagedKindAliasRepair, normalizeKind } from '../../src/db/repos/service.repo.js';

describe('ServiceRepo.getDeployablesByGroup', () => {
  it('normalizes legacy managed service type names before storing canonical kind', () => {
    expect(normalizeKind('postgresql')).toBe('postgres');
    expect(normalizeKind('mongodb')).toBe('mongo');
    expect(normalizeKind('redis')).toBe('redis');
    expect(normalizeKind('unexpected-custom-kind')).toBe('image');
  });

  it('infers repair kind only for ol-svc managed rows with DB/cache connection strings', () => {
    expect(
      inferManagedKindAliasRepair({
        kind: 'image',
        container_name: 'ol-svc-managed-pg',
        credentials: '{"connectionString":"postgresql://u:p@ol-svc-managed-pg:5432/app"}',
      }),
    ).toBe('postgres');
    expect(
      inferManagedKindAliasRepair({
        kind: 'image',
        container_name: 'ol-svc-cache',
        credentials: '{"connectionString":"redis://ol-svc-cache:6379"}',
      }),
    ).toBe('redis');
    expect(
      inferManagedKindAliasRepair({
        kind: 'image',
        container_name: 'ol-app-1',
        credentials: '{"connectionString":"postgresql://u:p@external-db:5432/app"}',
      }),
    ).toBeNull();
    expect(
      inferManagedKindAliasRepair({
        kind: 'image',
        container_name: 'ol-svc-custom-http',
        credentials: '{"connectionString":"https://example.com"}',
      }),
    ).toBeNull();
  });

  it('runs managed kind repair on database startup', () => {
    const source = readFileSync('src/db/index.ts', 'utf8');

    expect(source).toContain('repairManagedServiceKindAliases');
    expect(source).toContain('Repaired managed service rows stored with legacy image kind');
  });

  it('treats compose children as user-addressable deployables and excludes compose parent metadata', () => {
    const source = readFileSync('src/db/repos/service.repo.ts', 'utf8');
    const method = source.slice(
      source.indexOf('async getDeployablesByGroup'),
      source.indexOf('\n  }\n}', source.indexOf('async getDeployablesByGroup')),
    );

    expect(method).toContain("notInArray(services.kind, [...MANAGED_SERVICE_KINDS, 'compose'])");
    expect(method).toContain("coalesce(${services.build_method}, '') = 'compose'");
    expect(method).not.toContain("services.kind} != 'compose-child'");
  });
});

describe('ProjectRepo.getDeployableServiceCountsByProjectIds', () => {
  it('excludes compose parent metadata rows even when legacy rows have non-compose kind', () => {
    const source = readFileSync('src/db/repos/project.repo.ts', 'utf8');
    const method = source.slice(
      source.indexOf('async getDeployableServiceCountsByProjectIds'),
      source.indexOf(
        '\n  }\n\n  /**',
        source.indexOf('async getDeployableServiceCountsByProjectIds'),
      ),
    );

    expect(method).toContain("coalesce(${services.build_method}, '') = 'compose'");
    expect(method).toContain('${services.parent_service_id} IS NULL');
  });

  it('adds connected managed services to project list service counts', () => {
    const source = readFileSync('src/db/repos/project.repo.ts', 'utf8');
    const method = source.slice(
      source.indexOf('async getDeployableServiceCountsByProjectIds'),
      source.indexOf(
        '\n  }\n\n  /**',
        source.indexOf('async getDeployableServiceCountsByProjectIds'),
      ),
    );

    expect(method).toContain('serviceConnections');
    expect(method).toContain('service_id_consumer');
    expect(method).toContain('service_id_provider');
    expect(method).toContain('MANAGED_SERVICE_KINDS');
    expect(method).toContain('counts.set(projectId, (counts.get(projectId) ?? 0) + row.cnt)');
  });
});

describe('ProjectRepo.listProjectsWithMetadata', () => {
  it('derives list-card status from user-visible services, not compose parent metadata', () => {
    const source = readFileSync('src/db/repos/project.repo.ts', 'utf8');
    const method = source.slice(
      source.indexOf('async listProjectsWithMetadata'),
      source.indexOf('\n  }\n\n  /**', source.indexOf('async listProjectsWithMetadata')),
    );

    expect(method).toContain('deriveGroupStatusFromServices');
    expect(method).toContain('servicesByProject');
    expect(method).toContain('aggregateStatus ? { ...project, status: aggregateStatus } : project');
    expect(source).toContain(
      "s.kind NOT IN ('postgres', 'mysql', 'redis', 'mongo', 'minio', 'compose')",
    );
  });
});
