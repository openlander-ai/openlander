import { writeFile } from 'node:fs/promises';

import { describe, expect, it, vi } from 'vitest';

import type { ServiceRow } from '../../src/db/types.js';
import { PostgresMigrationExecutionService } from '../../src/migration/postgres-migration-execution.js';
import type { PostgresMigrationRehearsalV1 } from '../../src/migration/postgres-preflight-types.js';
import type { RuntimeBackend } from '../../src/pipeline/runtime/index.js';

const SOURCE_PASSWORD = 'source-secret-value';
const TARGET_PASSWORD = 'target-secret-value';

function postgresService(): ServiceRow {
  return {
    id: 'postgres-1',
    project_id: 'project-1',
    name: 'primary-db',
    kind: 'postgres',
    parent_service_id: null,
    runtime_role: 'resource',
    status: 'running',
    visibility: 'internal',
    assigned_port: 15432,
    container_id: 'container-postgres',
    container_name: 'ol-svc-primary-db',
    container_port: 5432,
    image_tag: 'postgres:16',
    previous_image_tag: null,
    public_url: null,
    dockerfile_path: null,
    docker_target: null,
    build_context: null,
    build_method: null,
    source: 'image',
    repo_url: null,
    git_credential_id: null,
    branch: null,
    image_url: 'postgres:16',
    image_cmd: null,
    pending_fix: null,
    access_code: null,
    access_code_iv: null,
    is_preview: 0,
    pr_number: null,
    project_type: 'worker',
    health_check_strategy: 'tcp',
    health_check_path: null,
    recovering_started_at: null,
    credentials: JSON.stringify({
      user: 'source_user',
      password: SOURCE_PASSWORD,
      database: 'source_db',
      connectionString: `postgresql://source_user:${SOURCE_PASSWORD}@localhost:5432/source_db`,
    }),
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
    archived_at: null,
    server_id: 'local',
  };
}

function database(service = postgresService()) {
  return {
    getProject: vi.fn(async (id: string) =>
      id === 'project-1'
        ? {
            id: 'project-1',
            name: 'example',
            display_name: 'Example',
            archived_at: null,
            created_at: '2026-08-01T00:00:00.000Z',
            updated_at: '2026-08-01T00:00:00.000Z',
            server_id: 'local',
            deploy_lock_session: null,
            deploy_lock_at: null,
            container_id: null,
          }
        : undefined,
    ),
    getServices: vi.fn(async () => [service]),
    getSetting: vi.fn(async () => null),
  };
}

function sourceMetadata() {
  return {
    server_version: '16.4',
    server_version_num: 160004,
    database_name: 'source_db',
    database_size_bytes: 4096,
    encoding: 'UTF8',
    collate: 'C.UTF-8',
    ctype: 'C.UTF-8',
    schema_count: 2,
    relation_count: 5,
    table_count: 3,
    sequence_count: 1,
    estimated_row_count: 42,
    extensions: [
      { name: 'pgcrypto', version: '1.3' },
      { name: 'plpgsql', version: '1.0' },
    ],
    roles: [
      {
        name: 'source_user',
        can_login: true,
        superuser: true,
        create_role: true,
        create_database: true,
      },
    ],
  };
}

function targetMetadata(empty: boolean) {
  return {
    server_version: '16.4',
    server_version_num: 160004,
    database_size_bytes: empty ? 8192 : 12288,
    schema_count: empty ? 1 : 2,
    custom_schema_count: empty ? 0 : 1,
    relation_count: empty ? 0 : 5,
    table_count: empty ? 0 : 3,
    sequence_count: empty ? 0 : 1,
    installed_extensions: empty ? ['plpgsql'] : ['pgcrypto', 'plpgsql'],
    non_default_extension_count: empty ? 0 : 1,
    routine_count: 0,
    enum_domain_count: 0,
    available_extensions: ['pgcrypto', 'plpgsql'],
  };
}

function runtime(options: { targetInitiallyEmpty?: boolean } = {}) {
  let targetMetadataReads = 0;
  const execSimple = vi.fn(
    async (_containerId: string, command: string[], execOptions?: { env?: string[] }) => {
      const isTarget = command.some((entry) => entry === '--host=db.example.com');
      const isSystemIdentity = command.some((entry) => entry.includes('pg_control_system'));
      if (isSystemIdentity) {
        return {
          exitCode: 0,
          stdout: isTarget ? 'target-system\n' : 'source-system\n',
          stderr: '',
        };
      }
      if (isTarget) {
        targetMetadataReads += 1;
        const empty = targetMetadataReads === 1 ? options.targetInitiallyEmpty !== false : false;
        expect(execOptions?.env).toContain(`PGPASSWORD=${TARGET_PASSWORD}`);
        return { exitCode: 0, stdout: JSON.stringify(targetMetadata(empty)), stderr: '' };
      }
      expect(execOptions?.env).toContain(`PGPASSWORD=${SOURCE_PASSWORD}`);
      return { exitCode: 0, stdout: JSON.stringify(sourceMetadata()), stderr: '' };
    },
  );
  const execToFile = vi.fn(
    async (
      _containerId: string,
      _command: string[],
      outputPath: string,
      execOptions?: { env?: string[] },
    ) => {
      expect(execOptions?.env).toContain(`PGPASSWORD=${SOURCE_PASSWORD}`);
      await writeFile(outputPath, Buffer.from([1, 2, 3, 4]), { mode: 0o600 });
    },
  );
  const execFromFile = vi.fn(
    async (
      _containerId: string,
      _command: string[],
      _inputPath: string,
      execOptions?: { env?: string[] },
    ) => {
      expect(execOptions?.env).toContain(`PGPASSWORD=${TARGET_PASSWORD}`);
    },
  );
  return {
    backend: { execSimple, execToFile, execFromFile } as unknown as RuntimeBackend,
    execSimple,
    execToFile,
    execFromFile,
  };
}

async function waitForTerminal(
  service: PostgresMigrationExecutionService,
  runId: string,
): Promise<PostgresMigrationRehearsalV1> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const run = service.getRehearsal('project-1', runId);
    if (run.status === 'succeeded' || run.status === 'failed') return run;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('rehearsal did not finish');
}

const target = {
  provider: 'aws_rds_postgresql' as const,
  host: 'db.example.com',
  port: 5432,
  database: 'target_db',
  user: 'target_user',
  password: TARGET_PASSWORD,
  ssl_mode: 'require' as const,
  confirm_empty_target: true as const,
};

describe('PostgresMigrationExecutionService', () => {
  it('returns read-only source metadata without credentials or row contents', async () => {
    const fakeRuntime = runtime();
    const service = new PostgresMigrationExecutionService(database() as never, fakeRuntime.backend);

    const preflight = await service.createPreflight('project-1', 'postgres-1');
    const serialized = JSON.stringify(preflight);

    expect(preflight.metadata).toMatchObject({
      server_major_version: 16,
      database_size_bytes: 4096,
      table_count: 3,
      sequence_count: 1,
    });
    expect(preflight.inspection_policy).toEqual({
      read_only: true,
      row_contents_read: false,
      credentials_included: false,
      secret_values_included: false,
    });
    expect(serialized).not.toContain(SOURCE_PASSWORD);
    expect(serialized).not.toContain('connectionString');
    expect(fakeRuntime.execToFile).not.toHaveBeenCalled();
  });

  it('dumps read-only, restores an actually empty target, verifies objects, and redacts passwords', async () => {
    const fakeRuntime = runtime();
    const service = new PostgresMigrationExecutionService(database() as never, fakeRuntime.backend);

    const started = await service.startRehearsal('project-1', 'postgres-1', target);
    const finished = await waitForTerminal(service, started.run_id);
    const serialized = JSON.stringify(finished);

    expect(finished.status).toBe('succeeded');
    expect(finished.phase).toBe('completed');
    expect(finished.execution_policy).toMatchObject({
      source_mutated: false,
      target_changes_started: true,
      credentials_stored: false,
      credentials_returned: false,
      persisted: false,
    });
    expect(finished.result?.verification).toEqual({
      schema_count_matches: true,
      relation_count_matches: true,
      table_count_matches: true,
      sequence_count_matches: true,
      extensions_restored: true,
    });
    expect(fakeRuntime.execToFile).toHaveBeenCalledOnce();
    expect(fakeRuntime.execFromFile).toHaveBeenCalledOnce();
    expect(serialized).not.toContain(SOURCE_PASSWORD);
    expect(serialized).not.toContain(TARGET_PASSWORD);
    expect(serialized).not.toContain('target_user');
  });

  it('stops before dump or restore when the target is not empty', async () => {
    const fakeRuntime = runtime({ targetInitiallyEmpty: false });
    const service = new PostgresMigrationExecutionService(database() as never, fakeRuntime.backend);

    const started = await service.startRehearsal('project-1', 'postgres-1', target);
    const finished = await waitForTerminal(service, started.run_id);

    expect(finished.status).toBe('failed');
    expect(finished.error?.code).toBe('POSTGRES_MIGRATION_TARGET_NOT_EMPTY');
    expect(finished.execution_policy.target_changes_started).toBe(false);
    expect(fakeRuntime.execToFile).not.toHaveBeenCalled();
    expect(fakeRuntime.execFromFile).not.toHaveBeenCalled();
  });

  it('fails closed before dump when cluster identity cannot be verified', async () => {
    const fakeRuntime = runtime();
    fakeRuntime.execSimple.mockImplementationOnce(async () => ({
      exitCode: 0,
      stdout: JSON.stringify(sourceMetadata()),
      stderr: '',
    }));
    fakeRuntime.execSimple.mockImplementationOnce(async () => ({
      exitCode: 0,
      stdout: JSON.stringify(targetMetadata(true)),
      stderr: '',
    }));
    fakeRuntime.execSimple.mockImplementationOnce(async () => ({
      exitCode: 1,
      stdout: '',
      stderr: 'permission denied',
    }));
    const service = new PostgresMigrationExecutionService(database() as never, fakeRuntime.backend);

    const started = await service.startRehearsal('project-1', 'postgres-1', target);
    const finished = await waitForTerminal(service, started.run_id);

    expect(finished.status).toBe('failed');
    expect(finished.error?.code).toBe('POSTGRES_MIGRATION_CLUSTER_IDENTITY_CHECK_FAILED');
    expect(finished.execution_policy.target_changes_started).toBe(false);
    expect(fakeRuntime.execToFile).not.toHaveBeenCalled();
    expect(fakeRuntime.execFromFile).not.toHaveBeenCalled();
  });

  it('rejects loopback targets and missing human confirmation before starting', async () => {
    const fakeRuntime = runtime();
    const service = new PostgresMigrationExecutionService(database() as never, fakeRuntime.backend);

    await expect(
      service.startRehearsal('project-1', 'postgres-1', {
        ...target,
        host: '127.0.0.1',
      }),
    ).rejects.toMatchObject({ code: 'POSTGRES_MIGRATION_REHEARSAL_INPUT_INVALID' });
    await expect(
      service.startRehearsal('project-1', 'postgres-1', {
        ...target,
        confirm_empty_target: false,
      } as never),
    ).rejects.toMatchObject({ code: 'POSTGRES_MIGRATION_REHEARSAL_INPUT_INVALID' });
    expect(fakeRuntime.execSimple).not.toHaveBeenCalled();
  });
});
