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

  it('treats compose parent as the user-addressable resource and keeps compose children internal', () => {
    const source = readFileSync('src/db/repos/service.repo.ts', 'utf8');
    const method = source.slice(
      source.indexOf('async getDeployablesByGroup'),
      source.indexOf('\n  }\n}', source.indexOf('async getDeployablesByGroup')),
    );

    expect(source).toContain(
      "export const NON_DEPLOYABLE_SERVICE_KINDS = [...MANAGED_SERVICE_KINDS, 'compose-child'] as const;",
    );
    expect(method).toContain('deployableServiceKindFilter(sql`${services.kind}`)');
    expect(method).not.toContain("coalesce(${services.build_method}, '') = 'compose'");
  });

  it('keeps service status typing aligned with the recovering lifecycle state', () => {
    const schema = readFileSync('src/db/schema.drizzle.ts', 'utf8');
    const types = readFileSync('src/db/types.ts', 'utf8');

    expect(schema).toContain("enum: ['running', 'stopped', 'building', 'error', 'recovering']");
    expect(types).toContain("'running' | 'stopped' | 'building' | 'error' | 'recovering' | null");
  });
});

describe('ProjectRepo.getDeployableServiceCountsByProjectIds', () => {
  it('counts compose parents and excludes compose-child internal nodes', () => {
    const source = readFileSync('src/db/repos/project.repo.ts', 'utf8');
    const method = source.slice(
      source.indexOf('async getDeployableServiceCountsByProjectIds'),
      source.indexOf(
        '\n  private async getConnectedManagedServiceCountsByProjectIds',
        source.indexOf('async getDeployableServiceCountsByProjectIds'),
      ),
    );

    expect(method).not.toContain("coalesce(${services.build_method}, '') = 'compose'");
    expect(method).not.toContain('${services.parent_service_id} IS NULL');
  });

  it('keeps deployable counts limited to Project-level workload resources', () => {
    const source = readFileSync('src/db/repos/project.repo.ts', 'utf8');
    const method = source.slice(
      source.indexOf('async getDeployableServiceCountsByProjectIds'),
      source.indexOf(
        '\n  private async getConnectedManagedServiceCountsByProjectIds',
        source.indexOf('async getDeployableServiceCountsByProjectIds'),
      ),
    );

    expect(source).toContain('NON_DEPLOYABLE_SERVICE_KINDS');
    expect(source).toContain('deployableServiceKindFilter');
    expect(source).not.toContain("const MANAGED_SERVICE_KINDS: ServiceKind[] = ['postgres'");
    expect(method).toContain('deployableServiceKindFilter(sql`${services.kind}`)');
    expect(method).not.toContain('serviceConnections');
    expect(method).not.toContain('directManagedRows');
  });

  it('tracks connected managed services separately for total list-card service counts', () => {
    const source = readFileSync('src/db/repos/project.repo.ts', 'utf8');
    const method = source.slice(
      source.indexOf('private async getConnectedManagedServiceCountsByProjectIds'),
      source.indexOf(
        '\n  }\n\n  /**',
        source.indexOf('private async getConnectedManagedServiceCountsByProjectIds'),
      ),
    );

    expect(method).toContain('serviceConnections');
    expect(method).toContain('service_id_consumer');
    expect(method).toContain('service_id_provider');
    expect(method).toContain("alias(services, 'consumer_services')");
    expect(method).toContain('consumerProjectId');
    expect(method).toContain('consumerServices.project_id');
    expect(method).toContain('deployableServiceIdToProjectId(row.consumerId)');
    expect(method).toContain('directManagedRows');
    expect(method).toContain('managedServiceIdsByProject');
    expect(method).toContain('serviceIds.size');
  });
});

describe('ProjectRepo.listProjectsWithMetadata', () => {
  it('derives list-card status from Project-level workload resources', () => {
    const source = readFileSync('src/db/repos/project.repo.ts', 'utf8');
    const method = source.slice(
      source.indexOf('async listProjectsWithMetadata'),
      source.indexOf('\n  }\n\n  /**', source.indexOf('async listProjectsWithMetadata')),
    );

    expect(method).toContain('deriveGroupStatusFromServices');
    expect(method).toContain('servicesByProject');
    expect(method).toContain('aggregateStatus ? { ...project, status: aggregateStatus } : project');
    expect(source).toContain('NON_DEPLOYABLE_SERVICE_KINDS');
    expect(source).toContain('deployableServiceKindFilter');
    expect(source).not.toContain(
      "const NON_DEPLOYABLE_SERVICE_KINDS = [...MANAGED_SERVICE_KINDS, 'compose'] as const;",
    );
    expect(source).not.toContain('function deployableServiceKindFilter(kindColumn: SQL): SQL');
    expect(source).not.toContain(
      "s.kind NOT IN ('postgres', 'mysql', 'redis', 'mongo', 'minio', 'compose')",
    );
  });
});

describe('service-scoped project id helpers', () => {
  it('uses the canonical deployable service id helper for connection and deploy log rows', () => {
    const serviceConnectionSource = readFileSync('src/db/repos/service-connection.repo.ts', 'utf8');
    const deployLogSource = readFileSync('src/db/repos/deploy-log.repo.ts', 'utf8');

    expect(serviceConnectionSource).toContain(
      "import { projectIdToDeployableServiceId } from '../service-ids.js'",
    );
    expect(deployLogSource).toContain(
      "import { projectIdToDeployableServiceId } from '../service-ids.js'",
    );
    expect(serviceConnectionSource).not.toContain('function projectIdToServiceId');
    expect(deployLogSource).not.toContain('function projectIdToServiceId');
  });
});
