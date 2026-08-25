import { describe, expect, it, vi } from 'vitest';

import type { ServiceRow } from '../../src/db/types.js';
import {
  PostgresMigrationSelectionRequiredError,
  PostgresMigrationSourceNotFoundError,
} from '../../src/errors.js';
import { renderProjectMigrationMarkdown } from '../../src/migration/markdown.js';
import { ProjectMigrationService } from '../../src/migration/project-migration-service.js';
import type { RuntimeBackend } from '../../src/pipeline/runtime/index.js';

function service(
  overrides: Partial<ServiceRow> & Pick<ServiceRow, 'id' | 'name' | 'kind'>,
): ServiceRow {
  return {
    id: overrides.id,
    project_id: 'project-1',
    name: overrides.name,
    kind: overrides.kind,
    parent_service_id: null,
    runtime_role:
      overrides.kind === 'git' || overrides.kind === 'image' ? 'application' : 'resource',
    status: 'running',
    visibility: 'internal',
    assigned_port: null,
    container_id: null,
    container_name: null,
    container_port: null,
    image_tag: null,
    previous_image_tag: null,
    public_url: null,
    dockerfile_path: null,
    docker_target: null,
    build_context: null,
    build_method: null,
    source: overrides.kind === 'image' ? 'image' : 'git',
    repo_url: null,
    git_credential_id: null,
    branch: null,
    image_url: null,
    image_cmd: null,
    pending_fix: null,
    access_code: null,
    access_code_iv: null,
    is_preview: 0,
    pr_number: null,
    project_type: 'web',
    health_check_strategy: 'http',
    health_check_path: '/health',
    recovering_started_at: null,
    credentials: null,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
    archived_at: null,
    server_id: 'local',
    ...overrides,
  };
}

function database(services: ServiceRow[]) {
  const byId = new Map(services.map((entry) => [entry.id, entry]));
  return {
    getProject: vi.fn(async () => ({
      id: 'project-1',
      name: 'example',
      display_name: 'Example',
      description: 'Migration fixture',
      tags: '["api","demo"]',
      archived_at: null,
      created_at: '2026-08-01T00:00:00.000Z',
      updated_at: '2026-08-01T00:00:00.000Z',
      server_id: 'local',
      deploy_lock_session: null,
      deploy_lock_at: null,
      container_id: null,
    })),
    getServices: vi.fn(async (options?: { project_id?: string; ids?: readonly string[] }) => {
      if (options?.ids) return options.ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
      return services.filter((entry) => entry.project_id === options?.project_id);
    }),
    listServiceConnectionsByProject: vi.fn(async () => []),
    listDomainMappings: vi.fn(async () => []),
    listEnvVarMetadataByProject: vi.fn(async () => []),
    listSecretFileMetadataByProject: vi.fn(async () => []),
    listProjectEnvironments: vi.fn(async () => []),
    getEnvironmentsByServiceIds: vi.fn(async () => []),
    getLastDeployLogsForServices: vi.fn(async () => new Map()),
  };
}

function runtime(
  overrides: {
    ping?: boolean;
    containers?: unknown[];
    volumes?: unknown[];
    diskUsage?: unknown;
  } = {},
): RuntimeBackend {
  return {
    ping: vi.fn(async () => overrides.ping ?? true),
    listAllContainers: vi.fn(async () => overrides.containers ?? []),
    listVolumes: vi.fn(async () => overrides.volumes ?? []),
    getDiskUsage: vi.fn(async () => overrides.diskUsage ?? { Volumes: [] }),
  } as unknown as RuntimeBackend;
}

describe('ProjectMigrationService', () => {
  it('builds a project graph without reading or emitting environment and secret values', async () => {
    const app = service({
      id: 'app-1',
      name: 'api',
      kind: 'git',
      repo_url: 'https://token@example.com/acme/api.git',
      branch: 'main',
      container_id: 'container-app',
      container_name: 'api',
      container_port: 3000,
    });
    const postgres = service({
      id: 'db-1',
      name: 'postgres',
      kind: 'postgres',
      source: 'image',
      image_url: 'postgres:16',
      container_id: 'container-db',
      container_name: 'ol-svc-postgres',
    });
    const redis = service({ id: 'cache-1', name: 'redis', kind: 'redis', image_url: 'redis:7' });
    const neo4j = service({
      id: 'graph-1',
      name: 'graph',
      kind: 'neo4j',
      image_url: 'neo4j:2026.07.1',
    });
    const minio = service({
      id: 'storage-1',
      name: 'objects',
      kind: 'minio',
      image_url: 'minio:latest',
    });
    const db = database([minio, neo4j, redis, postgres, app]);
    db.listServiceConnectionsByProject.mockResolvedValueOnce([
      {
        id: 'connection-1',
        service_id_consumer: app.id,
        service_id_provider: postgres.id,
        environment_id: null,
        auto_injected_env_keys: '["DATABASE_URL"]',
        created_at: '2026-08-01T00:00:00.000Z',
      },
    ]);
    db.listDomainMappings.mockResolvedValueOnce([
      {
        id: 'domain-1',
        service_id: app.id,
        domain: 'api.example.com',
        cloudflare_zone_id: null,
        cloudflare_dns_record_id: null,
        status: 'active' as const,
        path_prefix: '/',
        strip_prefix: false,
        upstream_path_prefix: null,
        target_port: 3000,
        tls_enabled: true,
        tls_resolver: null,
        created_at: '2026-08-01T00:00:00.000Z',
        updated_at: null,
      },
    ]);
    db.listEnvVarMetadataByProject.mockResolvedValueOnce([
      { project_id: 'project-1', service_id: app.id, environment_id: null, key: 'API_TOKEN' },
      { project_id: 'project-1', service_id: app.id, environment_id: null, key: 'PUBLIC_ORIGIN' },
    ]);
    db.listSecretFileMetadataByProject.mockResolvedValueOnce([
      { project_id: 'project-1', filename: 'service-account.json', mount_path: '/run/secrets' },
    ]);
    db.getLastDeployLogsForServices.mockResolvedValueOnce(
      new Map([
        [
          app.id,
          {
            id: 'deploy-1',
            service_id: app.id,
            environment_id: null,
            status: 'success' as const,
            trigger: 'api' as const,
            trigger_detail: null,
            commit_sha: 'abc123',
            commit_message: null,
            build_log: 'must-not-appear',
            runtime_log: null,
            representative_traffic_json: null,
            duration_ms: null,
            created_at: '2026-08-02T00:00:00.000Z',
          },
        ],
      ]),
    );
    const docker = runtime({
      containers: [
        {
          id: 'container-app',
          name: 'api',
          image: 'openlander/api:abc123',
          imageId: 'sha256:application',
          state: 'running',
          status: 'Up 1 hour',
          ports: [],
          mounts: [
            {
              type: 'volume',
              name: 'api-data',
              source: '/var/lib/docker/volumes/api-data/_data',
              destination: '/data',
              driver: 'local',
              mode: 'rw',
              readOnly: false,
              propagation: '',
            },
          ],
          labels: { 'openlander.managed': 'true', 'openlander.service': app.id },
          managedByOpenLander: true,
          composeProject: null,
          created: 1,
        },
        {
          id: 'unrelated-container',
          name: 'other-project-api',
          image: 'other/api:latest',
          imageId: 'sha256:other',
          state: 'running',
          status: 'Up 1 hour',
          ports: [],
          mounts: [],
          labels: { 'openlander.project': 'other-project' },
          managedByOpenLander: true,
          composeProject: null,
          created: 1,
        },
      ],
      volumes: [{ Name: 'api-data', Driver: 'local', Labels: {} }],
      diskUsage: { Volumes: [{ Name: 'api-data', UsageData: { Size: 4096 } }] },
    });

    const snapshot = await new ProjectMigrationService(db as never, docker).createSnapshot(
      'project-1',
    );
    const serialized = JSON.stringify(snapshot);

    expect(snapshot.services.map((entry) => entry.kind)).toEqual([
      'git',
      'minio',
      'neo4j',
      'postgres',
      'redis',
    ]);
    expect(snapshot.service_connections[0]?.auto_injected_env_keys).toEqual(['DATABASE_URL']);
    expect(snapshot.environment_variables).toEqual([
      expect.objectContaining({ key: 'API_TOKEN', sensitive: true, public: false }),
      expect.objectContaining({ key: 'PUBLIC_ORIGIN', sensitive: false, public: true }),
    ]);
    expect(snapshot.volumes[0]).toEqual(
      expect.objectContaining({ name: 'api-data', size_bytes: 4096, service_ids: ['app-1'] }),
    );
    expect(snapshot.runtime_inspection.container_count).toBe(1);
    expect(snapshot.runtime_inspection.matched_container_count).toBe(1);
    expect(snapshot.services.find((entry) => entry.id === app.id)?.source.repo_url).toBe(
      'https://example.com/acme/api.git',
    );
    expect(snapshot.readiness.status).toBe('needs_attention');
    expect(serialized).not.toContain('must-not-appear');
    expect(serialized).not.toContain('token@example.com');
    expect(serialized).not.toContain('encrypted_content');
  });

  it('returns a blocked document when the workload source is missing', async () => {
    const db = database([service({ id: 'app-1', name: 'api', kind: 'git', repo_url: null })]);
    const migration = new ProjectMigrationService(db as never, runtime());

    const bundle = await migration.createBundle('project-1');

    expect(bundle.snapshot.readiness.status).toBe('blocked');
    expect(bundle.snapshot.readiness.checks).toContainEqual(
      expect.objectContaining({ code: 'SOURCE_REFERENCE_MISSING', level: 'blocker' }),
    );
    expect(bundle.document_markdown).toContain('## 8. Provider-neutral migration sequence');
    expect(bundle.document_markdown).toContain('## 9. Unknowns and limitations');
    expect(bundle.target_comparison.generated_at).toBe(bundle.snapshot.generated_at);
    expect(bundle.target_comparison.targets).toHaveLength(2);
    expect(bundle.target_document_markdown).toContain('## Comparison summary');
  });

  it('keeps generating the snapshot when Docker is unavailable', async () => {
    const db = database([
      service({ id: 'app-1', name: 'api', kind: 'git', repo_url: 'https://example.com/api.git' }),
    ]);
    const docker = runtime({ ping: false });

    const snapshot = await new ProjectMigrationService(db as never, docker).createSnapshot(
      'project-1',
    );

    expect(snapshot.runtime_inspection.status).toBe('unavailable');
    expect(snapshot.readiness.checks).toContainEqual(
      expect.objectContaining({ code: 'DOCKER_UNAVAILABLE', level: 'warning' }),
    );
    expect(docker.listAllContainers).not.toHaveBeenCalled();
  });

  it('renders Compose children deterministically and flags definition review', async () => {
    const compose = service({
      id: 'compose-1',
      name: 'stack',
      kind: 'compose',
      runtime_role: 'application',
      repo_url: 'https://example.com/stack.git',
      build_method: 'compose',
    });
    const worker = service({
      id: 'compose-worker',
      name: 'stack/worker',
      kind: 'compose-child',
      parent_service_id: compose.id,
      runtime_role: 'job',
    });
    const db = database([worker, compose]);

    const snapshot = await new ProjectMigrationService(db as never, runtime()).createSnapshot(
      'project-1',
    );
    const markdown = renderProjectMigrationMarkdown(snapshot);

    expect(snapshot.services.map((entry) => entry.id)).toEqual(['compose-1', 'compose-worker']);
    expect(snapshot.readiness.checks).toContainEqual(
      expect.objectContaining({ code: 'COMPOSE_DEFINITION_REVIEW_REQUIRED' }),
    );
    expect(markdown).toContain('stack/worker');
  });

  it('normalizes legacy Compose roots and retains stopped Compose volume metadata', async () => {
    const compose = service({
      id: 'compose-1',
      name: 'stack',
      kind: 'git',
      runtime_role: 'application',
      repo_url: 'https://example.com/stack.git',
      build_method: 'compose',
    });
    const child = service({
      id: 'compose-db',
      name: 'stack/postgres',
      kind: 'compose-child',
      parent_service_id: compose.id,
      runtime_role: 'resource',
    });
    const docker = runtime({
      volumes: [
        {
          Name: 'stack-postgres-data',
          Driver: 'local',
          Labels: { 'com.docker.compose.project': 'example' },
        },
      ],
      diskUsage: {
        Volumes: [{ Name: 'stack-postgres-data', UsageData: { Size: 8192 } }],
      },
    });

    const snapshot = await new ProjectMigrationService(
      database([child, compose]) as never,
      docker,
    ).createSnapshot('project-1');

    expect(snapshot.services.map((entry) => entry.kind)).toEqual(['compose', 'compose-child']);
    expect(snapshot.volumes).toContainEqual(
      expect.objectContaining({
        name: 'stack-postgres-data',
        size_bytes: 8192,
        service_ids: ['compose-1'],
      }),
    );
    expect(snapshot.readiness.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'COMPOSE_DEFINITION_REVIEW_REQUIRED' }),
        expect.objectContaining({ code: 'RUNTIME_METADATA_INCOMPLETE' }),
        expect.objectContaining({ code: 'PERSISTENT_VOLUME_TRANSFER_REQUIRED' }),
      ]),
    );
  });

  it('requires an explicit Project-owned PostgreSQL selection when multiple exist', async () => {
    const first = service({
      id: 'postgres-a',
      name: 'accounts-db',
      kind: 'postgres',
      source: 'image',
      image_url: 'postgres:16',
    });
    const second = service({
      id: 'postgres-b',
      name: 'events-db',
      kind: 'postgres',
      source: 'image',
      image_url: 'postgres:17',
    });
    const migration = new ProjectMigrationService(database([second, first]) as never, runtime());

    await expect(
      migration.createPostgresMigrationRunbook('project-1', 'aws_rds_postgresql'),
    ).rejects.toBeInstanceOf(PostgresMigrationSelectionRequiredError);

    const runbook = await migration.createPostgresMigrationRunbook(
      'project-1',
      'gcp_cloud_sql_postgresql',
      second.id,
    );
    expect(runbook.source_service).toMatchObject({
      id: second.id,
      ownership: 'project',
      postgres_major_version: 17,
    });
  });

  it('does not accept a PostgreSQL resource owned by another Project', async () => {
    const app = service({
      id: 'app-1',
      name: 'api',
      kind: 'git',
      repo_url: 'https://example.com/api.git',
    });
    const connectedPostgres = service({
      id: 'postgres-shared',
      project_id: 'project-2',
      name: 'shared-db',
      kind: 'postgres',
      source: 'image',
      image_url: 'postgres:16',
    });
    const db = database([app, connectedPostgres]);
    db.listServiceConnectionsByProject.mockResolvedValueOnce([
      {
        id: 'connection-1',
        service_id_consumer: app.id,
        service_id_provider: connectedPostgres.id,
        environment_id: null,
        auto_injected_env_keys: '["DATABASE_URL"]',
        created_at: '2026-08-01T00:00:00.000Z',
      },
    ]);
    const migration = new ProjectMigrationService(db as never, runtime());

    await expect(
      migration.createPostgresMigrationRunbook(
        'project-1',
        'aws_rds_postgresql',
        connectedPostgres.id,
      ),
    ).rejects.toBeInstanceOf(PostgresMigrationSourceNotFoundError);
  });
});
