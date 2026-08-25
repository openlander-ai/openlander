import { describe, expect, it } from 'vitest';

import { createProjectMigrationTargetComparison } from '../../src/migration/target-mapping.js';
import { renderProjectMigrationTargetMarkdown } from '../../src/migration/target-markdown.js';
import type { MigrationService, ProjectMigrationSnapshotV1 } from '../../src/migration/types.js';

function service(
  overrides: Partial<MigrationService> & Pick<MigrationService, 'id' | 'name' | 'kind'>,
): MigrationService {
  return {
    id: overrides.id,
    project_id: 'project-1',
    ownership: 'project',
    name: overrides.name,
    kind: overrides.kind,
    runtime_role: ['postgres', 'mysql', 'redis', 'mongo', 'neo4j', 'minio'].includes(overrides.kind)
      ? 'resource'
      : 'application',
    parent_service_id: null,
    archived_at: null,
    source: {
      type: overrides.kind === 'image' ? 'image' : 'git',
      repo_url: 'https://example.com/repo.git',
      branch: 'main',
      dockerfile_path: 'Dockerfile',
      docker_target: null,
      build_context: '.',
      build_method: overrides.kind === 'compose' ? 'compose' : 'dockerfile',
      image_reference: null,
      image_id: null,
      image_command: null,
    },
    runtime: {
      status: 'running',
      container_id: null,
      container_name: null,
      container_state: null,
      container_status: null,
      assigned_port: null,
      container_port: 3000,
      health_check_strategy: 'http',
      health_check_path: '/health',
      public_url: null,
    },
    last_deploy: {
      deploy_id: `deploy-${overrides.id}`,
      status: 'success',
      commit_sha: 'abc123',
      created_at: '2026-08-22T00:00:00.000Z',
    },
    ...overrides,
  };
}

function snapshot(overrides: Partial<ProjectMigrationSnapshotV1> = {}): ProjectMigrationSnapshotV1 {
  return {
    schema_version: 'openlander.project-migration/v1',
    generated_at: '2026-08-22T00:00:00.000Z',
    project: {
      id: 'project-1',
      name: 'example',
      display_name: 'Example',
      description: null,
      tags: [],
      archived_at: null,
    },
    environments: [],
    services: [],
    service_connections: [],
    volumes: [],
    domain_routes: [],
    environment_variables: [],
    secret_files: [],
    runtime_inspection: {
      status: 'complete',
      checked_at: '2026-08-22T00:00:00.000Z',
      container_count: 0,
      matched_container_count: 0,
      volume_count: 0,
      warnings: [],
    },
    readiness: {
      status: 'ready',
      checks: [
        {
          code: 'SECRET_VALUES_EXCLUDED',
          level: 'pass',
          message: 'Secret values excluded.',
          service_id: null,
        },
      ],
    },
    export_policy: {
      secret_values_included: false,
      global_secrets_included: false,
      secret_file_contents_included: false,
      data_payloads_included: false,
    },
    ...overrides,
  };
}

describe('Project migration target mapping', () => {
  it('maps the same app and data graph to AWS ECS/Fargate and Google Cloud Run', () => {
    const app = service({ id: 'app', name: 'api', kind: 'git' });
    const postgres = service({
      id: 'postgres',
      name: 'postgres',
      kind: 'postgres',
      ownership: 'connected',
    });
    const redis = service({ id: 'redis', name: 'redis', kind: 'redis' });
    const neo4j = service({ id: 'neo4j', name: 'graph', kind: 'neo4j' });
    const minio = service({ id: 'minio', name: 'objects', kind: 'minio' });
    const comparison = createProjectMigrationTargetComparison(
      snapshot({
        services: [redis, minio, neo4j, app, postgres],
        volumes: [
          {
            id: 'volume:postgres-data:/var/lib/postgresql/data',
            name: 'postgres-data',
            type: 'volume',
            source: 'postgres-data',
            destination: '/var/lib/postgresql/data',
            driver: 'local',
            read_only: false,
            size_bytes: 4096,
            service_ids: ['postgres'],
          },
        ],
        environment_variables: [
          {
            key: 'API_TOKEN',
            scope: 'service',
            service_id: 'app',
            environment_id: null,
            sensitive: true,
            public: false,
          },
        ],
      }),
    );

    expect(comparison.generated_at).toBe('2026-08-22T00:00:00.000Z');
    expect(comparison.targets.map((target) => target.id)).toEqual([
      'aws_ecs_fargate',
      'gcp_cloud_run',
    ]);
    expect(comparison.targets[0]?.resource_mappings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source_service_id: 'app',
          target_resource_type: 'aws_ecs_fargate_service',
        }),
        expect.objectContaining({
          source_service_id: 'postgres',
          target_resource_type: 'aws_rds_postgresql',
        }),
        expect.objectContaining({
          source_service_id: 'redis',
          target_resource_type: 'aws_elasticache_valkey_redis',
        }),
        expect.objectContaining({
          source_service_id: 'minio',
          target_resource_type: 'aws_s3_bucket',
          confidence: 'low',
        }),
        expect.objectContaining({
          source_service_id: 'neo4j',
          target_resource_type: 'neo4j_aura_or_self_managed_aws',
          migration_method: 'manual_replatform',
          confidence: 'low',
        }),
      ]),
    );
    expect(comparison.targets[1]?.resource_mappings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ target_resource_type: 'gcp_cloud_run_service' }),
        expect.objectContaining({ target_resource_type: 'gcp_cloud_sql_postgresql' }),
        expect.objectContaining({ target_resource_type: 'gcp_memorystore_redis' }),
        expect.objectContaining({ target_resource_type: 'gcp_cloud_storage_bucket' }),
        expect.objectContaining({
          source_service_id: 'neo4j',
          target_resource_type: 'neo4j_aura_or_self_managed_gcp',
        }),
      ]),
    );
    for (const target of comparison.targets) {
      expect(target.volume_mappings[0]).toMatchObject({
        target_resource_type: 'mapped_managed_data_service',
        migration_method: 'logical_export_import',
      });
      expect(target.supporting_resources).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ category: 'configuration', required: true }),
        ]),
      );
      expect(target.findings).toContainEqual(
        expect.objectContaining({
          code: 'CONNECTED_RESOURCE_OWNERSHIP_REVIEW_REQUIRED',
          service_id: 'postgres',
        }),
      );
    }
  });

  it('keeps blocked source snapshots blocked and flags Compose decomposition', () => {
    const compose = service({ id: 'compose', name: 'stack', kind: 'compose' });
    const child = service({
      id: 'compose-child',
      name: 'stack/postgres',
      kind: 'compose-child',
      parent_service_id: compose.id,
    });
    child.runtime.container_port = null;
    const comparison = createProjectMigrationTargetComparison(
      snapshot({
        services: [compose, child],
        readiness: {
          status: 'blocked',
          checks: [
            {
              code: 'SOURCE_REFERENCE_MISSING',
              level: 'blocker',
              message: 'Source missing.',
              service_id: compose.id,
            },
          ],
        },
      }),
    );

    for (const target of comparison.targets) {
      expect(target.status).toBe('blocked');
      expect(target.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'SOURCE_SNAPSHOT_BLOCKED', level: 'blocker' }),
          expect.objectContaining({ code: 'COMPOSE_DECOMPOSITION_REQUIRED' }),
          expect.objectContaining({
            code: 'COMPOSE_CHILD_CLASSIFICATION_REQUIRED',
            service_id: 'compose-child',
          }),
        ]),
      );
    }
  });

  it('renders a deterministic comparison document without secret or data payload fields', () => {
    const comparison = createProjectMigrationTargetComparison(
      snapshot({ services: [service({ id: 'app', name: 'api', kind: 'git' })] }),
    );
    const markdown = renderProjectMigrationTargetMarkdown(comparison);

    expect(markdown).toContain('## Comparison summary');
    expect(markdown).toContain('## AWS ECS on Fargate');
    expect(markdown).toContain('## Google Cloud Run');
    expect(markdown).toContain('## Cross-target decision checklist');
    expect(markdown).not.toContain('encrypted_content');
    expect(markdown).not.toContain('secret_file_contents');
    expect(JSON.stringify(comparison)).not.toContain('API_SECRET_VALUE');
  });
});
