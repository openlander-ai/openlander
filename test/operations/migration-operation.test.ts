import { describe, expect, it, vi } from 'vitest';

import type { AppContext } from '../../src/app.js';
import {
  getMigrationSnapshotOperation,
  projectMigrationSnapshotSchema,
} from '../../src/operations/definitions/migration.js';
import {
  compareMigrationTargetsOperation,
  projectMigrationTargetComparisonSchema,
} from '../../src/operations/definitions/migration-targets.js';
import { createProjectMigrationTargetComparison } from '../../src/migration/target-mapping.js';
import { createPostgresMigrationRunbook } from '../../src/migration/postgres-runbook.js';
import {
  getMigrationRunbookOperation,
  postgresMigrationRunbookSchema,
} from '../../src/operations/definitions/migration-runbook.js';
import { getMigrationPreflightOperation } from '../../src/operations/definitions/migration-preflight.js';

const snapshot = {
  schema_version: 'openlander.project-migration/v1' as const,
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
    status: 'unavailable' as const,
    checked_at: '2026-08-22T00:00:00.000Z',
    container_count: 0,
    matched_container_count: 0,
    volume_count: 0,
    warnings: [{ code: 'DOCKER_UNAVAILABLE', message: 'Docker unavailable.' }],
  },
  readiness: {
    status: 'blocked' as const,
    checks: [
      {
        code: 'NO_DEPLOYABLE_SERVICE',
        level: 'blocker' as const,
        message: 'No workload.',
        service_id: null,
      },
    ],
  },
  export_policy: {
    secret_values_included: false as const,
    global_secrets_included: false as const,
    secret_file_contents_included: false as const,
    data_payloads_included: false as const,
  },
};

describe('get_migration_snapshot operation', () => {
  it('is a read-only Project-scoped query with a JSON-only response', async () => {
    const createSnapshot = vi.fn(async () => snapshot);
    const result = await getMigrationSnapshotOperation.execute(
      { project_id: 'project-1' },
      {
        appCtx: { projectMigrationService: { createSnapshot } } as unknown as AppContext,
        actor: {
          source: 'mcp',
          scope: 'project',
          instanceId: 'instance-1',
          projectId: 'project-1',
          label: 'test-agent',
        },
        operationId: null,
      },
    );

    expect(getMigrationSnapshotOperation.kind).toBe('query');
    expect(getMigrationSnapshotOperation.idempotency).toBe('none');
    expect(getMigrationSnapshotOperation.activity).toEqual({
      recordsActivity: false,
      recordsEvidence: false,
    });
    expect(result).toMatchObject({
      status: 'generated',
      project_id: 'project-1',
      snapshot,
      _agent_guidance: { next_steps: expect.any(Array) },
    });
    expect(result).not.toHaveProperty('document_markdown');
    expect(getMigrationSnapshotOperation.outputSchema.safeParse(result).success).toBe(true);
    expect(projectMigrationSnapshotSchema.safeParse(snapshot).success).toBe(true);
  });

  it('returns a scoped target comparison without Markdown or a duplicated snapshot', async () => {
    const comparison = createProjectMigrationTargetComparison(snapshot);
    const createTargetComparison = vi.fn(async () => comparison);
    const result = await compareMigrationTargetsOperation.execute(
      { project_id: 'project-1' },
      {
        appCtx: {
          projectMigrationService: { createTargetComparison },
        } as unknown as AppContext,
        actor: {
          source: 'mcp',
          scope: 'project',
          instanceId: 'instance-1',
          projectId: 'project-1',
          label: 'test-agent',
        },
        operationId: null,
      },
    );

    expect(compareMigrationTargetsOperation.kind).toBe('query');
    expect(compareMigrationTargetsOperation.activity).toEqual({
      recordsActivity: false,
      recordsEvidence: false,
    });
    expect(result).toMatchObject({
      status: 'generated',
      project_id: 'project-1',
      comparison,
      _agent_guidance: { next_steps: expect.any(Array) },
    });
    expect(result).not.toHaveProperty('snapshot');
    expect(result).not.toHaveProperty('target_document_markdown');
    expect(compareMigrationTargetsOperation.outputSchema.safeParse(result).success).toBe(true);
    expect(projectMigrationTargetComparisonSchema.safeParse(comparison).success).toBe(true);
  });

  it('returns a JSON-only PostgreSQL runbook as a read-only Project-scoped query', async () => {
    const source = {
      id: 'postgres-1',
      project_id: 'project-1',
      ownership: 'project' as const,
      name: 'primary-db',
      kind: 'postgres' as const,
      runtime_role: 'resource' as const,
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
        image_reference: 'postgres:16',
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
        container_port: 5432,
        health_check_strategy: 'tcp' as const,
        health_check_path: null,
        public_url: null,
      },
      last_deploy: null,
    };
    const sourceSnapshot = { ...snapshot, services: [source] };
    const runbook = createPostgresMigrationRunbook(sourceSnapshot, source, 'aws_rds_postgresql');
    const createRunbook = vi.fn(async () => runbook);

    const result = await getMigrationRunbookOperation.execute(
      {
        project_id: 'project-1',
        service_id: 'postgres-1',
        target: 'aws_rds_postgresql',
      },
      {
        appCtx: {
          projectMigrationService: { createPostgresMigrationRunbook: createRunbook },
        } as unknown as AppContext,
        actor: {
          source: 'mcp',
          scope: 'project',
          instanceId: 'instance-1',
          projectId: 'project-1',
          label: 'test-agent',
        },
        operationId: null,
      },
    );

    expect(getMigrationRunbookOperation.kind).toBe('query');
    expect(getMigrationRunbookOperation.allowedScopes).not.toContain('service');
    expect(getMigrationRunbookOperation.activity).toEqual({
      recordsActivity: false,
      recordsEvidence: false,
    });
    expect(result).toMatchObject({
      status: 'generated',
      project_id: 'project-1',
      service_id: 'postgres-1',
      runbook,
      _agent_guidance: { next_steps: expect.any(Array) },
    });
    expect(result).not.toHaveProperty('document_markdown');
    expect(getMigrationRunbookOperation.outputSchema.safeParse(result).success).toBe(true);
    expect(postgresMigrationRunbookSchema.safeParse(runbook).success).toBe(true);
  });

  it('returns a compact read-only PostgreSQL preflight without credentials or Markdown', async () => {
    const preflight = {
      schema_version: 'openlander.postgresql-preflight/v1' as const,
      generated_at: '2026-08-22T00:00:00.000Z',
      project: { id: 'project-1', name: 'example', display_name: 'Example' },
      source_service: {
        id: 'postgres-1',
        name: 'primary-db',
        kind: 'postgres' as const,
        runtime_status: 'running',
      },
      metadata: {
        server_version: '16.4',
        server_version_num: 160004,
        server_major_version: 16,
        database_name: 'app',
        database_size_bytes: 4096,
        encoding: 'UTF8',
        collate: 'C.UTF-8',
        ctype: 'C.UTF-8',
        schema_count: 1,
        relation_count: 4,
        table_count: 3,
        sequence_count: 1,
        estimated_row_count: 42,
        extensions: [{ name: 'plpgsql', version: '1.0' }],
        roles: [
          {
            name: 'app',
            can_login: true,
            superuser: false,
            create_role: false,
            create_database: false,
          },
        ],
        roles_truncated: false,
      },
      readiness: {
        status: 'ready_for_rehearsal' as const,
        checks: [{ code: 'ROW_CONTENTS_EXCLUDED', level: 'pass' as const, message: 'Safe.' }],
      },
      inspection_policy: {
        read_only: true as const,
        row_contents_read: false as const,
        credentials_included: false as const,
        secret_values_included: false as const,
      },
    };
    const createPostgresMigrationPreflight = vi.fn(async () => preflight);

    const result = await getMigrationPreflightOperation.execute(
      { project_id: 'project-1', service_id: 'postgres-1' },
      {
        appCtx: {
          projectMigrationService: { createPostgresMigrationPreflight },
        } as unknown as AppContext,
        actor: {
          source: 'mcp',
          scope: 'project',
          instanceId: 'instance-1',
          projectId: 'project-1',
          label: 'test-agent',
        },
        operationId: null,
      },
    );

    expect(getMigrationPreflightOperation.kind).toBe('query');
    expect(getMigrationPreflightOperation.allowedScopes).not.toContain('service');
    expect(getMigrationPreflightOperation.activity).toEqual({
      recordsActivity: false,
      recordsEvidence: false,
    });
    expect(result).toMatchObject({
      status: 'inspected',
      project_id: 'project-1',
      service_id: 'postgres-1',
      preflight,
      _agent_guidance: { next_steps: expect.any(Array) },
    });
    expect(result).not.toHaveProperty('document_markdown');
    expect(result).not.toHaveProperty('logs');
    expect(JSON.stringify(result)).not.toContain('password');
    expect(getMigrationPreflightOperation.outputSchema.safeParse(result).success).toBe(true);
  });
});
