import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { ProjectRow, ServiceRow } from '../../src/db/types.js';
import { PostgresMigrationExecutionService } from '../../src/migration/postgres-migration-execution.js';
import type { PostgresMigrationRehearsalV1 } from '../../src/migration/postgres-preflight-types.js';
import { Docker } from '../../src/pipeline/docker.js';

const execFileAsync = promisify(execFile);
const runDockerRehearsal = process.env['OPENLANDER_DOCKER_MIGRATION_E2E'] === '1';
const describeDockerRehearsal = runDockerRehearsal ? describe : describe.skip;

const POSTGRES_IMAGE = process.env['OPENLANDER_POSTGRES_E2E_IMAGE'] ?? 'postgres:16-alpine';
const SOURCE_USER = 'source_user';
const SOURCE_PASSWORD = 'source-password-for-e2e';
const SOURCE_DATABASE = 'source_db';
const TARGET_USER = 'target_user';
const TARGET_PASSWORD = 'target-password-for-e2e';
const TARGET_DATABASE = 'target_db';

interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

async function commandResult(command: string, args: string[]): Promise<CommandResult> {
  try {
    const result = await execFileAsync(command, args, {
      encoding: 'utf8',
      maxBuffer: 4 * 1024 * 1024,
    });
    return { exitCode: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const failed = error as Error & {
      code?: number;
      stdout?: string;
      stderr?: string;
    };
    return {
      exitCode: typeof failed.code === 'number' ? failed.code : 1,
      stdout: failed.stdout ?? '',
      stderr: failed.stderr ?? failed.message,
    };
  }
}

async function command(commandName: string, args: string[]): Promise<string> {
  const result = await commandResult(commandName, args);
  if (result.exitCode !== 0) {
    throw new Error(
      `${commandName} ${args.join(' ')} failed (${String(result.exitCode)}): ${result.stderr}`,
    );
  }
  return result.stdout.trim();
}

async function docker(args: string[]): Promise<string> {
  return await command('docker', args);
}

async function waitForPostgres(containerName: string): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const result = await commandResult('docker', [
      'exec',
      containerName,
      'pg_isready',
      '--quiet',
      '--timeout=1',
    ]);
    if (result.exitCode === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`PostgreSQL container ${containerName} did not become ready`);
}

async function psql(
  containerName: string,
  credentials: { user: string; password: string; database: string },
  sql: string,
): Promise<string> {
  return await docker([
    'exec',
    '--env',
    `PGPASSWORD=${credentials.password}`,
    containerName,
    'psql',
    '--no-psqlrc',
    '--no-password',
    '--tuples-only',
    '--no-align',
    '--set=ON_ERROR_STOP=1',
    `--username=${credentials.user}`,
    `--dbname=${credentials.database}`,
    '--command',
    sql,
  ]);
}

async function waitForTerminal(
  service: PostgresMigrationExecutionService,
  runId: string,
): Promise<PostgresMigrationRehearsalV1> {
  for (let attempt = 0; attempt < 600; attempt += 1) {
    const run = service.getRehearsal('project-docker-e2e', runId);
    if (run.status === 'succeeded' || run.status === 'failed') return run;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('PostgreSQL migration rehearsal did not finish within 60 seconds');
}

function sourceService(containerName: string): ServiceRow {
  return {
    id: 'postgres-docker-e2e',
    project_id: 'project-docker-e2e',
    name: 'primary-db',
    kind: 'postgres',
    parent_service_id: null,
    runtime_role: 'resource',
    status: 'running',
    visibility: 'internal',
    assigned_port: null,
    container_id: containerName,
    container_name: containerName,
    container_port: 5432,
    image_tag: POSTGRES_IMAGE,
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
    image_url: POSTGRES_IMAGE,
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
      user: SOURCE_USER,
      password: SOURCE_PASSWORD,
      database: SOURCE_DATABASE,
      connectionString: `postgresql://${SOURCE_USER}:${SOURCE_PASSWORD}@localhost:5432/${SOURCE_DATABASE}`,
    }),
    created_at: '2026-08-22T00:00:00.000Z',
    updated_at: '2026-08-22T00:00:00.000Z',
    archived_at: null,
    server_id: 'local',
  };
}

function database(service: ServiceRow) {
  const project: ProjectRow = {
    id: 'project-docker-e2e',
    name: 'postgres-docker-e2e',
    display_name: 'PostgreSQL Docker E2E',
    archived_at: null,
    created_at: '2026-08-22T00:00:00.000Z',
    updated_at: '2026-08-22T00:00:00.000Z',
    server_id: 'local',
    deploy_lock_session: null,
    deploy_lock_at: null,
    container_id: null,
  };
  return {
    getProject: async (id: string) => (id === project.id ? project : undefined),
    getServices: async () => [service],
    getSetting: async () => null,
  };
}

describeDockerRehearsal('PostgreSQL migration rehearsal with Docker', () => {
  const suffix = randomUUID().slice(0, 8);
  const networkName = `ol-pg-rehearsal-${suffix}`;
  const sourceContainer = `ol-pg-source-${suffix}`;
  const targetContainer = `ol-pg-target-${suffix}`;
  const createdContainers = new Set<string>();
  let networkCreated = false;
  let certificateDirectory: string | null = null;

  beforeAll(async () => {
    certificateDirectory = await mkdtemp(join(tmpdir(), 'openlander-pg-tls-e2e-'));
    const certificatePath = join(certificateDirectory, 'server.crt');
    const keyPath = join(certificateDirectory, 'server.key');
    await command('openssl', [
      'req',
      '-x509',
      '-nodes',
      '-newkey',
      'rsa:2048',
      '-keyout',
      keyPath,
      '-out',
      certificatePath,
      '-days',
      '1',
      '-subj',
      `/CN=${targetContainer}`,
    ]);

    await docker(['network', 'create', networkName]);
    networkCreated = true;

    await docker([
      'run',
      '--detach',
      '--name',
      sourceContainer,
      '--network',
      networkName,
      '--env',
      `POSTGRES_USER=${SOURCE_USER}`,
      '--env',
      `POSTGRES_PASSWORD=${SOURCE_PASSWORD}`,
      '--env',
      `POSTGRES_DB=${SOURCE_DATABASE}`,
      POSTGRES_IMAGE,
    ]);
    createdContainers.add(sourceContainer);

    await docker([
      'run',
      '--detach',
      '--name',
      targetContainer,
      '--network',
      networkName,
      '--env',
      `POSTGRES_USER=${TARGET_USER}`,
      '--env',
      `POSTGRES_PASSWORD=${TARGET_PASSWORD}`,
      '--env',
      `POSTGRES_DB=${TARGET_DATABASE}`,
      POSTGRES_IMAGE,
    ]);
    createdContainers.add(targetContainer);

    await Promise.all([waitForPostgres(sourceContainer), waitForPostgres(targetContainer)]);

    await docker(['cp', certificatePath, `${targetContainer}:/var/lib/postgresql/server.crt`]);
    await docker(['cp', keyPath, `${targetContainer}:/var/lib/postgresql/server.key`]);
    await docker([
      'exec',
      '--user=root',
      targetContainer,
      'chown',
      'postgres:postgres',
      '/var/lib/postgresql/server.crt',
      '/var/lib/postgresql/server.key',
    ]);
    await docker([
      'exec',
      '--user=root',
      targetContainer,
      'chmod',
      '600',
      '/var/lib/postgresql/server.key',
    ]);
    await psql(
      targetContainer,
      { user: TARGET_USER, password: TARGET_PASSWORD, database: TARGET_DATABASE },
      "ALTER SYSTEM SET ssl = 'on'",
    );
    await psql(
      targetContainer,
      { user: TARGET_USER, password: TARGET_PASSWORD, database: TARGET_DATABASE },
      "ALTER SYSTEM SET ssl_cert_file = '/var/lib/postgresql/server.crt'",
    );
    await psql(
      targetContainer,
      { user: TARGET_USER, password: TARGET_PASSWORD, database: TARGET_DATABASE },
      "ALTER SYSTEM SET ssl_key_file = '/var/lib/postgresql/server.key'",
    );
    await docker(['restart', targetContainer]);
    await waitForPostgres(targetContainer);
    await expect(
      psql(
        targetContainer,
        { user: TARGET_USER, password: TARGET_PASSWORD, database: TARGET_DATABASE },
        'SHOW ssl',
      ),
    ).resolves.toBe('on');

    await psql(
      sourceContainer,
      { user: SOURCE_USER, password: SOURCE_PASSWORD, database: SOURCE_DATABASE },
      `
        CREATE EXTENSION pgcrypto;
        CREATE SCHEMA app;
        CREATE TYPE app.item_state AS ENUM ('new', 'done');
        CREATE SEQUENCE app.ticket_seq START 100;
        CREATE TABLE app.items (
          id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
          name text NOT NULL,
          state app.item_state NOT NULL,
          token uuid NOT NULL DEFAULT gen_random_uuid()
        );
        INSERT INTO app.items (name, state) VALUES ('alpha', 'new'), ('beta', 'done');
        CREATE FUNCTION app.item_count() RETURNS bigint
          LANGUAGE sql STABLE AS $$ SELECT count(*) FROM app.items $$;
        ANALYZE app.items;
      `,
    );
  }, 120_000);

  afterAll(async () => {
    const cleanupErrors: unknown[] = [];
    for (const containerName of createdContainers) {
      try {
        await docker(['rm', '--force', containerName]);
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (networkCreated) {
      try {
        await docker(['network', 'rm', networkName]);
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (certificateDirectory) {
      try {
        await rm(certificateDirectory, { recursive: true, force: true });
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (cleanupErrors.length > 0) {
      throw new AggregateError(cleanupErrors, 'PostgreSQL Docker E2E cleanup failed');
    }
  }, 60_000);

  it('streams dump and restore, verifies copied data, and rejects a non-empty retry', async () => {
    const service = new PostgresMigrationExecutionService(
      database(sourceService(sourceContainer)) as never,
      new Docker(undefined, networkName),
    );
    const target = {
      provider: 'aws_rds_postgresql' as const,
      host: targetContainer,
      port: 5432,
      database: TARGET_DATABASE,
      user: TARGET_USER,
      password: TARGET_PASSWORD,
      ssl_mode: 'require' as const,
      confirm_empty_target: true as const,
    };

    const started = await service.startRehearsal(
      'project-docker-e2e',
      'postgres-docker-e2e',
      target,
    );
    const finished = await waitForTerminal(service, started.run_id);

    expect(finished.status, finished.error?.message).toBe('succeeded');
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
    const serialized = JSON.stringify(finished);
    expect(serialized).not.toContain(SOURCE_PASSWORD);
    expect(serialized).not.toContain(TARGET_PASSWORD);

    const targetEvidence = await psql(
      targetContainer,
      { user: TARGET_USER, password: TARGET_PASSWORD, database: TARGET_DATABASE },
      `SELECT json_build_object(
        'row_count', count(*),
        'function_count', app.item_count(),
        'names', array_agg(name ORDER BY id),
        'states', enum_range(NULL::app.item_state)::text,
        'non_null_tokens', count(token)
      )::text FROM app.items`,
    );
    expect(JSON.parse(targetEvidence)).toEqual({
      row_count: 2,
      function_count: 2,
      names: ['alpha', 'beta'],
      states: '{new,done}',
      non_null_tokens: 2,
    });

    const retry = await service.startRehearsal('project-docker-e2e', 'postgres-docker-e2e', target);
    const rejected = await waitForTerminal(service, retry.run_id);
    expect(rejected).toMatchObject({
      status: 'failed',
      phase: 'failed',
      error: { code: 'POSTGRES_MIGRATION_TARGET_NOT_EMPTY' },
      execution_policy: { source_mutated: false, target_changes_started: false },
    });
  }, 120_000);
});
