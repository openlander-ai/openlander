import { describe, expect, it } from 'vitest';

import { renderPostgresMigrationRunbookMarkdown } from '../../src/migration/postgres-runbook-markdown.js';
import { createPostgresMigrationRunbook } from '../../src/migration/postgres-runbook.js';
import type { MigrationService, ProjectMigrationSnapshotV1 } from '../../src/migration/types.js';

function postgres(overrides: Partial<MigrationService> = {}): MigrationService {
  return {
    id: 'postgres-1',
    project_id: 'project-1',
    ownership: 'project',
    name: 'primary-db',
    kind: 'postgres',
    runtime_role: 'resource',
    parent_service_id: null,
    archived_at: null,
    source: {
      type: 'image',
      repo_url: null,
      branch: null,
      dockerfile_path: null,
      docker_target: null,
      build_context: null,
      build_method: null,
      image_reference: 'postgres:16.4-alpine',
      image_id: 'sha256:postgres',
      image_command: null,
    },
    runtime: {
      status: 'running',
      container_id: 'container-postgres',
      container_name: 'primary-db',
      container_state: 'running',
      container_status: 'Up 1 hour',
      assigned_port: null,
      container_port: 5432,
      health_check_strategy: 'tcp',
      health_check_path: null,
      public_url: null,
    },
    last_deploy: null,
    ...overrides,
  };
}

function snapshot(source = postgres()): ProjectMigrationSnapshotV1 {
  return {
    schema_version: 'openlander.project-migration/v1',
    generated_at: '2026-08-22T00:00:00.000Z',
    project: {
      id: 'project-1',
      name: 'example',
      display_name: 'Example',
      description: 'password=hunter2 must not flow into the runbook',
      tags: [],
      archived_at: null,
    },
    environments: [],
    services: [source],
    service_connections: [
      {
        id: 'connection-1',
        service_id_consumer: 'app-1',
        service_id_provider: source.id,
        environment_id: null,
        auto_injected_env_keys: ['DATABASE_URL'],
      },
    ],
    volumes: [
      {
        id: 'volume:postgres-data',
        name: 'postgres-data',
        type: 'volume',
        source: 'postgres-data',
        destination: '/var/lib/postgresql/data',
        driver: 'local',
        read_only: false,
        size_bytes: 4096,
        service_ids: [source.id],
      },
    ],
    domain_routes: [],
    environment_variables: [
      {
        key: 'DATABASE_URL',
        scope: 'service',
        service_id: 'app-1',
        environment_id: null,
        sensitive: true,
        public: false,
      },
    ],
    secret_files: [
      { filename: 'database.env', mount_path: '/run/secrets/database.env', scope: 'project' },
    ],
    runtime_inspection: {
      status: 'complete',
      checked_at: '2026-08-22T00:00:00.000Z',
      container_count: 1,
      matched_container_count: 1,
      volume_count: 1,
      warnings: [],
    },
    readiness: { status: 'needs_attention', checks: [] },
    export_policy: {
      secret_values_included: false,
      global_secrets_included: false,
      secret_file_contents_included: false,
      data_payloads_included: false,
    },
  };
}

describe('PostgreSQL migration runbook', () => {
  it('creates a deterministic AWS native-tool plan with rehearsal, freeze, verification, and rollback', () => {
    const runbook = createPostgresMigrationRunbook(snapshot(), postgres(), 'aws_rds_postgresql');

    expect(runbook).toMatchObject({
      schema_version: 'openlander.postgresql-migration-runbook/v1',
      generated_at: '2026-08-22T00:00:00.000Z',
      source_service: {
        id: 'postgres-1',
        ownership: 'project',
        postgres_major_version: 16,
        connection_consumer_ids: ['app-1'],
        volume_ids: ['volume:postgres-data'],
      },
      target: { id: 'aws_rds_postgresql', provider: 'aws' },
      strategy: {
        method: 'native_pg_dump_pg_restore',
        write_freeze_required: true,
        online_replication_included: false,
        database_size_bytes: null,
      },
      execution_policy: {
        commands_executed: false,
        credentials_included: false,
        cloud_changes_made: false,
        data_copied: false,
        dns_changed: false,
      },
    });
    expect(runbook.phases.map((phase) => phase.id)).toEqual([
      'preflight',
      'prepare-target',
      'rehearsal',
      'final-export',
      'final-restore',
      'cutover',
      'closeout',
    ]);
    expect(runbook.phases.find((phase) => phase.id === 'final-export')?.downtime).toBe('required');
    const shells = runbook.phases.flatMap((phase) => phase.commands.map((entry) => entry.shell));
    expect(shells.join('\n')).toContain('${SOURCE_PGPASSFILE}');
    expect(shells.join('\n')).toContain('--format=custom');
    expect(shells.join('\n')).toContain('--jobs="${RESTORE_JOBS}"');
    expect(JSON.stringify(runbook)).not.toContain('hunter2');
  });

  it('keeps an unknown version and incomplete runtime as explicit warnings', () => {
    const source = postgres({
      source: { ...postgres().source, image_reference: 'registry.example/db@sha256:abc' },
    });
    const sourceSnapshot = snapshot(source);
    sourceSnapshot.runtime_inspection.status = 'unavailable';

    const runbook = createPostgresMigrationRunbook(
      sourceSnapshot,
      source,
      'gcp_cloud_sql_postgresql',
    );

    expect(runbook.source_service.postgres_major_version).toBeNull();
    expect(runbook.readiness.status).toBe('needs_input');
    expect(runbook.readiness.checks.map((check) => check.code)).toEqual(
      expect.arrayContaining([
        'POSTGRES_MAJOR_VERSION_UNCONFIRMED',
        'RUNTIME_INSPECTION_INCOMPLETE',
        'DATABASE_SIZE_MUST_BE_MEASURED',
      ]),
    );
    expect(runbook.references.some((reference) => reference.url.includes('cloud.google.com'))).toBe(
      true,
    );
    expect(runbook.required_inputs.map((input) => input.key)).toEqual(
      expect.arrayContaining(['REHEARSAL_TOC_PATH', 'FINAL_TOC_PATH']),
    );
    expect(
      runbook.phases.flatMap((phase) => phase.commands.map((entry) => entry.shell)).join('\n'),
    ).toContain('--use-list="${REHEARSAL_TOC_PATH}"');
  });

  it('renders only the redacted runbook into Markdown', () => {
    const runbook = createPostgresMigrationRunbook(snapshot(), postgres(), 'aws_rds_postgresql');
    const markdown = renderPostgresMigrationRunbookMarkdown(runbook);

    expect(markdown).toContain('# PostgreSQL Migration Runbook');
    expect(markdown).toContain('## 3. Run a rehearsal dump and restore');
    expect(markdown).toContain('## 6. Switch the application and observe');
    expect(markdown).toContain('```sh');
    expect(markdown).toContain('${TARGET_PGPASSFILE}');
    expect(markdown).not.toContain('hunter2');
    expect(markdown).not.toContain('database.env');
  });
});
