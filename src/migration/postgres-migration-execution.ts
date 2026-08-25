import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, stat, statfs } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Database } from '../db/index.js';
import type { ProjectRow, ServiceRow } from '../db/types.js';
import {
  PostgresMigrationPreflightError,
  PostgresMigrationRehearsalConflictError,
  PostgresMigrationRehearsalInputError,
  PostgresMigrationRehearsalNotFoundError,
  PostgresMigrationSelectionRequiredError,
  PostgresMigrationSourceNotFoundError,
  ProjectNotFoundError,
} from '../errors.js';
import { parseServiceCredentials } from '../pipeline/service-adapters/shared.js';
import type { RuntimeBackend } from '../pipeline/runtime/index.js';
import {
  assertDatabaseAccessAllowed,
  assertDestructiveActionAllowed,
} from '../security/operation-permissions.js';
import {
  POSTGRES_MIGRATION_PREFLIGHT_SCHEMA_VERSION,
  POSTGRES_MIGRATION_REHEARSAL_SCHEMA_VERSION,
  type PostgresMigrationExtension,
  type PostgresMigrationMetadata,
  type PostgresMigrationPreflightCheck,
  type PostgresMigrationPreflightV1,
  type PostgresMigrationRehearsalPhase,
  type PostgresMigrationRehearsalTargetInput,
  type PostgresMigrationRehearsalTargetObservation,
  type PostgresMigrationRehearsalV1,
  type PostgresMigrationRole,
} from './postgres-preflight-types.js';

type PostgresMigrationDatabase = Pick<Database, 'getProject' | 'getServices' | 'getSetting'>;

interface SelectedSource {
  project: ProjectRow;
  service: ServiceRow;
}

interface TargetMetadata extends PostgresMigrationRehearsalTargetObservation {
  custom_schema_count: number;
  non_default_extension_count: number;
  routine_count: number;
  enum_domain_count: number;
  available_extensions: string[];
}

const SOURCE_METADATA_SQL = String.raw`
SELECT json_build_object(
  'server_version', current_setting('server_version'),
  'server_version_num', current_setting('server_version_num')::integer,
  'database_name', current_database(),
  'database_size_bytes', pg_database_size(current_database()),
  'encoding', pg_encoding_to_char(d.encoding),
  'collate', d.datcollate,
  'ctype', d.datctype,
  'schema_count', (
    SELECT count(*) FROM pg_namespace n
    WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
  ),
  'relation_count', (
    SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
      AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f', 'c')
  ),
  'table_count', (
    SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
      AND c.relkind IN ('r', 'p')
  ),
  'sequence_count', (
    SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema' AND c.relkind = 'S'
  ),
  'estimated_row_count', COALESCE((SELECT sum(GREATEST(n_live_tup, 0))::bigint FROM pg_stat_user_tables), 0),
  'extensions', COALESCE((
    SELECT json_agg(json_build_object('name', e.extname, 'version', e.extversion) ORDER BY e.extname)
    FROM pg_extension e
  ), '[]'::json),
  'roles', COALESCE((
    SELECT json_agg(json_build_object(
      'name', roles.rolname,
      'can_login', roles.rolcanlogin,
      'superuser', roles.rolsuper,
      'create_role', roles.rolcreaterole,
      'create_database', roles.rolcreatedb
    ) ORDER BY roles.rolname)
    FROM (SELECT * FROM pg_roles WHERE rolname !~ '^pg_' ORDER BY rolname LIMIT 101) roles
  ), '[]'::json)
)::text
FROM pg_database d
WHERE d.datname = current_database();
`;

const TARGET_METADATA_SQL = String.raw`
SELECT json_build_object(
  'server_version', current_setting('server_version'),
  'server_version_num', current_setting('server_version_num')::integer,
  'database_size_bytes', pg_database_size(current_database()),
  'schema_count', (
    SELECT count(*) FROM pg_namespace n
    WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
  ),
  'custom_schema_count', (
    SELECT count(*) FROM pg_namespace n
    WHERE n.nspname !~ '^pg_' AND n.nspname NOT IN ('information_schema', 'public')
  ),
  'relation_count', (
    SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
      AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f', 'c')
  ),
  'table_count', (
    SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
      AND c.relkind IN ('r', 'p')
  ),
  'sequence_count', (
    SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema' AND c.relkind = 'S'
  ),
  'installed_extensions', COALESCE((
    SELECT json_agg(e.extname ORDER BY e.extname) FROM pg_extension e
  ), '[]'::json),
  'non_default_extension_count', (
    SELECT count(*) FROM pg_extension e WHERE e.extname <> 'plpgsql'
  ),
  'routine_count', (
    SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
  ),
  'enum_domain_count', (
    SELECT count(*) FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
      AND t.typtype IN ('e', 'd')
  ),
  'available_extensions', COALESCE((
    SELECT json_agg(a.name ORDER BY a.name) FROM pg_available_extensions a
  ), '[]'::json)
)::text;
`;

const SYSTEM_IDENTIFIER_SQL = 'SELECT system_identifier::text FROM pg_control_system();';
const TERMINAL_RETENTION_MS = 6 * 60 * 60 * 1000;
const MINIMUM_DUMP_HEADROOM_BYTES = 64 * 1024 * 1024;

class RehearsalStepError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'RehearsalStepError';
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('invalid record');
  }
  return value as Record<string, unknown>;
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string') throw new Error(`invalid ${key}`);
  return value;
}

function requiredNumber(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`invalid ${key}`);
  }
  return value;
}

function stringArray(record: Record<string, unknown>, key: string): string[] {
  const value = record[key];
  if (!Array.isArray(value)) throw new Error(`invalid ${key}`);
  const entries = value as unknown[];
  return entries
    .map((entry) => {
      if (typeof entry !== 'string') throw new Error(`invalid ${key}`);
      return entry;
    })
    .sort((left, right) => left.localeCompare(right, 'en'));
}

function parseExtensions(value: unknown): PostgresMigrationExtension[] {
  if (!Array.isArray(value)) throw new Error('invalid extensions');
  return value
    .map((entry) => {
      const record = asRecord(entry);
      return {
        name: requiredString(record, 'name'),
        version: requiredString(record, 'version'),
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name, 'en'));
}

function parseRoles(value: unknown): { roles: PostgresMigrationRole[]; truncated: boolean } {
  if (!Array.isArray(value)) throw new Error('invalid roles');
  const roles = value.map((entry) => {
    const record = asRecord(entry);
    const boolean = (key: string): boolean => {
      const candidate = record[key];
      if (typeof candidate !== 'boolean') throw new Error(`invalid ${key}`);
      return candidate;
    };
    return {
      name: requiredString(record, 'name'),
      can_login: boolean('can_login'),
      superuser: boolean('superuser'),
      create_role: boolean('create_role'),
      create_database: boolean('create_database'),
    };
  });
  return { roles: roles.slice(0, 100), truncated: roles.length > 100 };
}

function parseSourceMetadata(stdout: string): PostgresMigrationMetadata {
  const record = asRecord(JSON.parse(stdout.trim()) as unknown);
  const serverVersionNum = requiredNumber(record, 'server_version_num');
  const parsedRoles = parseRoles(record['roles']);
  return {
    server_version: requiredString(record, 'server_version'),
    server_version_num: serverVersionNum,
    server_major_version: Math.floor(serverVersionNum / 10_000),
    database_name: requiredString(record, 'database_name'),
    database_size_bytes: requiredNumber(record, 'database_size_bytes'),
    encoding: requiredString(record, 'encoding'),
    collate: requiredString(record, 'collate'),
    ctype: requiredString(record, 'ctype'),
    schema_count: requiredNumber(record, 'schema_count'),
    relation_count: requiredNumber(record, 'relation_count'),
    table_count: requiredNumber(record, 'table_count'),
    sequence_count: requiredNumber(record, 'sequence_count'),
    estimated_row_count: requiredNumber(record, 'estimated_row_count'),
    extensions: parseExtensions(record['extensions']),
    roles: parsedRoles.roles,
    roles_truncated: parsedRoles.truncated,
  };
}

function parseTargetMetadata(stdout: string, sourceExtensions: readonly string[]): TargetMetadata {
  const record = asRecord(JSON.parse(stdout.trim()) as unknown);
  const serverVersionNum = requiredNumber(record, 'server_version_num');
  const installedExtensions = stringArray(record, 'installed_extensions');
  const availableExtensions = stringArray(record, 'available_extensions');
  const available = new Set(availableExtensions);
  const unsupported = sourceExtensions
    .filter((name) => name !== 'plpgsql' && !available.has(name))
    .sort((left, right) => left.localeCompare(right, 'en'));
  const customSchemaCount = requiredNumber(record, 'custom_schema_count');
  const relationCount = requiredNumber(record, 'relation_count');
  const tableCount = requiredNumber(record, 'table_count');
  const sequenceCount = requiredNumber(record, 'sequence_count');
  const nonDefaultExtensionCount = requiredNumber(record, 'non_default_extension_count');
  const routineCount = requiredNumber(record, 'routine_count');
  const enumDomainCount = requiredNumber(record, 'enum_domain_count');
  return {
    server_version: requiredString(record, 'server_version'),
    server_version_num: serverVersionNum,
    server_major_version: Math.floor(serverVersionNum / 10_000),
    database_size_bytes: requiredNumber(record, 'database_size_bytes'),
    schema_count: requiredNumber(record, 'schema_count'),
    relation_count: relationCount,
    table_count: tableCount,
    sequence_count: sequenceCount,
    installed_extensions: installedExtensions,
    unsupported_source_extensions: unsupported,
    empty:
      customSchemaCount === 0 &&
      relationCount === 0 &&
      nonDefaultExtensionCount === 0 &&
      routineCount === 0 &&
      enumDomainCount === 0,
    custom_schema_count: customSchemaCount,
    non_default_extension_count: nonDefaultExtensionCount,
    routine_count: routineCount,
    enum_domain_count: enumDomainCount,
    available_extensions: availableExtensions,
  };
}

function publicTargetMetadata(
  metadata: TargetMetadata,
): PostgresMigrationRehearsalTargetObservation {
  return {
    server_version: metadata.server_version,
    server_version_num: metadata.server_version_num,
    server_major_version: metadata.server_major_version,
    database_size_bytes: metadata.database_size_bytes,
    schema_count: metadata.schema_count,
    relation_count: metadata.relation_count,
    table_count: metadata.table_count,
    sequence_count: metadata.sequence_count,
    installed_extensions: metadata.installed_extensions,
    unsupported_source_extensions: metadata.unsupported_source_extensions,
    empty: metadata.empty,
  };
}

function psqlArgs(credentials: { user: string; database: string }, sql: string): string[] {
  return [
    'psql',
    '--no-psqlrc',
    '--no-password',
    '--tuples-only',
    '--no-align',
    '--set=ON_ERROR_STOP=1',
    '--host=127.0.0.1',
    '--port=5432',
    `--username=${credentials.user}`,
    `--dbname=${credentials.database}`,
    '--command',
    sql,
  ];
}

function targetPsqlArgs(target: PostgresMigrationRehearsalTargetInput, sql: string): string[] {
  return [
    'psql',
    '--no-psqlrc',
    '--no-password',
    '--tuples-only',
    '--no-align',
    '--set=ON_ERROR_STOP=1',
    `--host=${target.host}`,
    `--port=${String(target.port)}`,
    `--username=${target.user}`,
    `--dbname=${target.database}`,
    '--command',
    sql,
  ];
}

function sourceEnv(password: string): string[] {
  return [`PGPASSWORD=${password}`];
}

function targetEnv(target: PostgresMigrationRehearsalTargetInput): string[] {
  return [`PGPASSWORD=${target.password}`, 'PGSSLMODE=require', 'PGCONNECT_TIMEOUT=15'];
}

function validateTarget(input: PostgresMigrationRehearsalTargetInput): void {
  const runtimeInput: { confirm_empty_target: unknown; ssl_mode: unknown } = input;
  if (runtimeInput.confirm_empty_target !== true) {
    throw new PostgresMigrationRehearsalInputError(
      'confirm_empty_target',
      'explicit_confirmation_required',
    );
  }
  if (runtimeInput.ssl_mode !== 'require') {
    throw new PostgresMigrationRehearsalInputError('ssl_mode', 'tls_required');
  }
  const host = input.host.trim().toLowerCase();
  if (
    host.length === 0 ||
    host.length > 253 ||
    /[\s/?#@\0]/.test(host) ||
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '::1' ||
    host === '0.0.0.0' ||
    /^127\./.test(host)
  ) {
    throw new PostgresMigrationRehearsalInputError('host', 'external_target_required');
  }
  if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65_535) {
    throw new PostgresMigrationRehearsalInputError('port', 'invalid_port');
  }
  for (const [field, value] of [
    ['database', input.database],
    ['user', input.user],
  ] as const) {
    if (
      value.trim().length === 0 ||
      Buffer.byteLength(value, 'utf8') > 63 ||
      /[\n\r\0]/.test(value)
    ) {
      throw new PostgresMigrationRehearsalInputError(field, 'invalid_identifier');
    }
  }
  if (
    input.password.length === 0 ||
    input.password.length > 1024 ||
    /[\n\r\0]/.test(input.password)
  ) {
    throw new PostgresMigrationRehearsalInputError('password', 'invalid_secret');
  }
}

function cloneRun(run: PostgresMigrationRehearsalV1): PostgresMigrationRehearsalV1 {
  return structuredClone(run);
}

export class PostgresMigrationExecutionService {
  private readonly rehearsals = new Map<string, PostgresMigrationRehearsalV1>();

  constructor(
    private readonly db: PostgresMigrationDatabase,
    private readonly runtime: RuntimeBackend,
  ) {}

  private async selectSource(projectId: string, serviceId?: string): Promise<SelectedSource> {
    const project = await this.db.getProject(projectId);
    if (!project) throw new ProjectNotFoundError(projectId);
    const candidates = (await this.db.getServices({ project_id: project.id, kindIn: ['postgres'] }))
      .filter((service) => service.archived_at === null)
      .sort(
        (left, right) =>
          left.name.localeCompare(right.name, 'en') || left.id.localeCompare(right.id, 'en'),
      );
    if (!serviceId && candidates.length > 1) {
      throw new PostgresMigrationSelectionRequiredError(
        projectId,
        candidates.map((service) => ({ service_id: service.id, service_name: service.name })),
      );
    }
    const service = serviceId
      ? candidates.find((candidate) => candidate.id === serviceId)
      : candidates[0];
    if (!service) throw new PostgresMigrationSourceNotFoundError(projectId, serviceId);
    return { project, service };
  }

  private async inspectSource(selected: SelectedSource): Promise<PostgresMigrationPreflightV1> {
    const { project, service } = selected;
    await assertDatabaseAccessAllowed(this.db, {
      projectId: project.id,
      serviceId: service.id,
    });
    if (service.status !== 'running') {
      throw new PostgresMigrationPreflightError('source_not_running', service.id);
    }
    const containerId = service.container_id ?? service.container_name;
    if (!containerId) throw new PostgresMigrationPreflightError('container_missing', service.id);
    const credentials = parseServiceCredentials(service);
    let result: { exitCode: number; stdout: string; stderr: string };
    try {
      result = await this.runtime.execSimple(
        containerId,
        psqlArgs(credentials, SOURCE_METADATA_SQL),
        {
          env: sourceEnv(credentials.password),
        },
      );
    } catch {
      throw new PostgresMigrationPreflightError('query_failed', service.id);
    }
    if (result.exitCode !== 0) {
      throw new PostgresMigrationPreflightError('query_failed', service.id);
    }
    let metadata: PostgresMigrationMetadata;
    try {
      metadata = parseSourceMetadata(result.stdout);
    } catch {
      throw new PostgresMigrationPreflightError('invalid_response', service.id);
    }
    const checks: PostgresMigrationPreflightCheck[] = [
      {
        code: 'SOURCE_METADATA_OBSERVED',
        level: 'pass',
        message: 'PostgreSQL version, database size, and logical object counts were observed.',
      },
      {
        code: 'ROW_CONTENTS_EXCLUDED',
        level: 'pass',
        message: 'No table row content was queried or returned.',
      },
    ];
    if (metadata.extensions.some((extension) => extension.name !== 'plpgsql')) {
      checks.push({
        code: 'TARGET_EXTENSION_COMPATIBILITY_REQUIRED',
        level: 'warning',
        message:
          'Installed extensions must be available on the selected managed PostgreSQL target.',
      });
    }
    if (metadata.roles.some((role) => role.can_login)) {
      checks.push({
        code: 'GLOBAL_ROLES_EXCLUDED_FROM_DATABASE_DUMP',
        level: 'warning',
        message:
          'Login roles are cluster-global and are not recreated by the database-only rehearsal.',
      });
    }
    return {
      schema_version: POSTGRES_MIGRATION_PREFLIGHT_SCHEMA_VERSION,
      generated_at: new Date().toISOString(),
      project: {
        id: project.id,
        name: project.name,
        display_name: project.display_name || project.name,
      },
      source_service: {
        id: service.id,
        name: service.name,
        kind: 'postgres',
        runtime_status: service.status,
      },
      metadata,
      readiness: { status: 'ready_for_rehearsal', checks },
      inspection_policy: {
        read_only: true,
        row_contents_read: false,
        credentials_included: false,
        secret_values_included: false,
      },
    };
  }

  async createPreflight(
    projectId: string,
    serviceId?: string,
  ): Promise<PostgresMigrationPreflightV1> {
    return await this.inspectSource(await this.selectSource(projectId, serviceId));
  }

  private pruneTerminalRuns(): void {
    const cutoff = Date.now() - TERMINAL_RETENTION_MS;
    for (const [runId, run] of this.rehearsals) {
      if (run.finished_at && Date.parse(run.finished_at) < cutoff) this.rehearsals.delete(runId);
    }
  }

  async startRehearsal(
    projectId: string,
    serviceId: string | undefined,
    target: PostgresMigrationRehearsalTargetInput,
  ): Promise<PostgresMigrationRehearsalV1> {
    validateTarget(target);
    this.pruneTerminalRuns();
    const selected = await this.selectSource(projectId, serviceId);
    await assertDatabaseAccessAllowed(this.db, {
      projectId: selected.project.id,
      serviceId: selected.service.id,
    });
    await assertDestructiveActionAllowed(this.db, {
      projectId: selected.project.id,
      serviceId: selected.service.id,
    });
    const active = [...this.rehearsals.values()].find(
      (run) =>
        run.project_id === selected.project.id &&
        (run.status === 'queued' || run.status === 'running'),
    );
    if (active) {
      throw new PostgresMigrationRehearsalConflictError(selected.project.id, active.run_id);
    }

    const runId = randomUUID();
    const run: PostgresMigrationRehearsalV1 = {
      schema_version: POSTGRES_MIGRATION_REHEARSAL_SCHEMA_VERSION,
      run_id: runId,
      project_id: selected.project.id,
      service_id: selected.service.id,
      target: {
        provider: target.provider,
        host: target.host.trim(),
        port: target.port,
        database: target.database,
        ssl_mode: 'require',
      },
      status: 'queued',
      phase: 'queued',
      created_at: new Date().toISOString(),
      started_at: null,
      finished_at: null,
      source_preflight: null,
      target_preflight: null,
      result: null,
      error: null,
      execution_policy: {
        source_mutated: false,
        target_mutation_permitted: true,
        target_changes_started: false,
        credentials_stored: false,
        credentials_returned: false,
        persisted: false,
      },
    };
    this.rehearsals.set(runId, run);
    void this.executeRehearsal(runId, selected, target);
    return cloneRun(run);
  }

  getRehearsal(projectId: string, runId: string): PostgresMigrationRehearsalV1 {
    this.pruneTerminalRuns();
    const run = this.rehearsals.get(runId);
    if (!run || run.project_id !== projectId) {
      throw new PostgresMigrationRehearsalNotFoundError(projectId, runId);
    }
    return cloneRun(run);
  }

  private setPhase(runId: string, phase: PostgresMigrationRehearsalPhase): void {
    const run = this.rehearsals.get(runId);
    if (!run) return;
    run.phase = phase;
    if (run.status === 'queued') {
      run.status = 'running';
      run.started_at = new Date().toISOString();
    }
  }

  private async executeSql(
    containerId: string,
    command: string[],
    env: string[],
    code: string,
  ): Promise<string> {
    let result: { exitCode: number; stdout: string; stderr: string };
    try {
      result = await this.runtime.execSimple(containerId, command, { env });
    } catch {
      throw new RehearsalStepError(code, 'The PostgreSQL command could not be executed.');
    }
    if (result.exitCode !== 0) {
      throw new RehearsalStepError(code, 'The PostgreSQL command did not complete successfully.');
    }
    return result.stdout;
  }

  private async readSystemIdentifier(
    containerId: string,
    command: string[],
    env: string[],
  ): Promise<string | null> {
    try {
      const result = await this.runtime.execSimple(containerId, command, { env });
      return result.exitCode === 0 && result.stdout.trim() ? result.stdout.trim() : null;
    } catch {
      return null;
    }
  }

  private async executeRehearsal(
    runId: string,
    selected: SelectedSource,
    target: PostgresMigrationRehearsalTargetInput,
  ): Promise<void> {
    const startedMs = Date.now();
    let tempDirectory: string | null = null;
    try {
      const containerId = selected.service.container_id ?? selected.service.container_name;
      if (!containerId) {
        throw new RehearsalStepError(
          'POSTGRES_MIGRATION_SOURCE_CONTAINER_MISSING',
          'The source PostgreSQL container is unavailable.',
        );
      }
      const sourceCredentials = parseServiceCredentials(selected.service);
      const normalizedTargetHost = target.host
        .trim()
        .replace(/^\[|\]$/g, '')
        .toLowerCase();
      if (
        [selected.service.id, selected.service.name, selected.service.container_name]
          .filter((value): value is string => typeof value === 'string')
          .some((value) => value.toLowerCase() === normalizedTargetHost)
      ) {
        throw new RehearsalStepError(
          'POSTGRES_MIGRATION_TARGET_MATCHES_SOURCE_CLUSTER',
          'The target resolves to the source PostgreSQL cluster.',
        );
      }
      this.setPhase(runId, 'preflight_source');
      const sourcePreflight = await this.inspectSource(selected);
      const run = this.rehearsals.get(runId);
      if (!run) return;
      run.source_preflight = sourcePreflight;

      this.setPhase(runId, 'preflight_target');
      const sourceExtensionNames = sourcePreflight.metadata.extensions.map(
        (extension) => extension.name,
      );
      const targetStdout = await this.executeSql(
        containerId,
        targetPsqlArgs(target, TARGET_METADATA_SQL),
        targetEnv(target),
        'POSTGRES_MIGRATION_TARGET_PREFLIGHT_FAILED',
      );
      let targetMetadata: TargetMetadata;
      try {
        targetMetadata = parseTargetMetadata(targetStdout, sourceExtensionNames);
      } catch {
        throw new RehearsalStepError(
          'POSTGRES_MIGRATION_TARGET_PREFLIGHT_INVALID',
          'The target PostgreSQL metadata response was invalid.',
        );
      }
      run.target_preflight = publicTargetMetadata(targetMetadata);
      if (!targetMetadata.empty) {
        throw new RehearsalStepError(
          'POSTGRES_MIGRATION_TARGET_NOT_EMPTY',
          'The target database is not empty. Rehearsal restore was not started.',
        );
      }
      if (targetMetadata.server_major_version < sourcePreflight.metadata.server_major_version) {
        throw new RehearsalStepError(
          'POSTGRES_MIGRATION_TARGET_VERSION_INCOMPATIBLE',
          'The target PostgreSQL major version is older than the source.',
        );
      }
      if (targetMetadata.unsupported_source_extensions.length > 0) {
        throw new RehearsalStepError(
          'POSTGRES_MIGRATION_TARGET_EXTENSION_UNAVAILABLE',
          'One or more source extensions are unavailable on the target.',
        );
      }

      const [sourceSystemId, targetSystemId] = await Promise.all([
        this.readSystemIdentifier(
          containerId,
          psqlArgs(sourceCredentials, SYSTEM_IDENTIFIER_SQL),
          sourceEnv(sourceCredentials.password),
        ),
        this.readSystemIdentifier(
          containerId,
          targetPsqlArgs(target, SYSTEM_IDENTIFIER_SQL),
          targetEnv(target),
        ),
      ]);
      if (sourceSystemId && targetSystemId && sourceSystemId === targetSystemId) {
        throw new RehearsalStepError(
          'POSTGRES_MIGRATION_TARGET_MATCHES_SOURCE_CLUSTER',
          'The target resolves to the source PostgreSQL cluster.',
        );
      }

      const filesystem = await statfs(tmpdir());
      const availableBytes = filesystem.bavail * filesystem.bsize;
      const requiredBytes =
        Math.ceil(sourcePreflight.metadata.database_size_bytes * 1.25) +
        MINIMUM_DUMP_HEADROOM_BYTES;
      if (!Number.isFinite(availableBytes) || availableBytes < requiredBytes) {
        throw new RehearsalStepError(
          'POSTGRES_MIGRATION_INSUFFICIENT_DISK',
          'The OpenLander host does not have enough temporary disk space for a safe rehearsal dump.',
        );
      }

      tempDirectory = await mkdtemp(join(tmpdir(), 'openlander-postgres-rehearsal-'));
      const dumpPath = join(tempDirectory, 'source.pgdump');
      this.setPhase(runId, 'dumping');
      try {
        await this.runtime.execToFile(
          containerId,
          [
            'pg_dump',
            '--no-password',
            '--host=127.0.0.1',
            '--port=5432',
            `--username=${sourceCredentials.user}`,
            `--dbname=${sourceCredentials.database}`,
            '--format=custom',
            '--no-owner',
            '--no-acl',
          ],
          dumpPath,
          { env: sourceEnv(sourceCredentials.password) },
        );
      } catch {
        throw new RehearsalStepError(
          'POSTGRES_MIGRATION_DUMP_FAILED',
          'The source dump did not complete successfully.',
        );
      }
      const dump = await stat(dumpPath);
      if (dump.size <= 0) {
        throw new RehearsalStepError(
          'POSTGRES_MIGRATION_DUMP_EMPTY',
          'The source dump archive was empty.',
        );
      }

      this.setPhase(runId, 'restoring');
      run.execution_policy.target_changes_started = true;
      try {
        await this.runtime.execFromFile(
          containerId,
          [
            'pg_restore',
            '--no-password',
            `--host=${target.host}`,
            `--port=${String(target.port)}`,
            `--username=${target.user}`,
            `--dbname=${target.database}`,
            '--no-owner',
            '--no-acl',
            '--exit-on-error',
            '--single-transaction',
          ],
          dumpPath,
          { env: targetEnv(target) },
        );
      } catch {
        throw new RehearsalStepError(
          'POSTGRES_MIGRATION_RESTORE_FAILED',
          'The target restore failed. Inspect the target before retrying with a fresh empty database.',
        );
      }

      this.setPhase(runId, 'verifying');
      const verificationStdout = await this.executeSql(
        containerId,
        targetPsqlArgs(target, TARGET_METADATA_SQL),
        targetEnv(target),
        'POSTGRES_MIGRATION_VERIFICATION_QUERY_FAILED',
      );
      let observed: TargetMetadata;
      try {
        observed = parseTargetMetadata(verificationStdout, sourceExtensionNames);
      } catch {
        throw new RehearsalStepError(
          'POSTGRES_MIGRATION_VERIFICATION_INVALID',
          'The target verification response was invalid.',
        );
      }
      const installed = new Set(observed.installed_extensions);
      const verification = {
        schema_count_matches: observed.schema_count === sourcePreflight.metadata.schema_count,
        relation_count_matches: observed.relation_count === sourcePreflight.metadata.relation_count,
        table_count_matches: observed.table_count === sourcePreflight.metadata.table_count,
        sequence_count_matches: observed.sequence_count === sourcePreflight.metadata.sequence_count,
        extensions_restored: sourceExtensionNames.every((extension) => installed.has(extension)),
      };
      if (Object.values(verification).some((value) => !value)) {
        throw new RehearsalStepError(
          'POSTGRES_MIGRATION_VERIFICATION_FAILED',
          'The restored target object counts did not match the source preflight.',
        );
      }

      run.status = 'succeeded';
      run.phase = 'completed';
      run.finished_at = new Date().toISOString();
      run.result = {
        dump_size_bytes: dump.size,
        duration_ms: Date.now() - startedMs,
        verification,
      };
    } catch (error) {
      const run = this.rehearsals.get(runId);
      if (!run) return;
      const safeError =
        error instanceof RehearsalStepError
          ? error
          : new RehearsalStepError(
              'POSTGRES_MIGRATION_REHEARSAL_FAILED',
              'The PostgreSQL migration rehearsal failed.',
            );
      run.status = 'failed';
      run.phase = 'failed';
      run.finished_at = new Date().toISOString();
      run.error = { code: safeError.code, message: safeError.message };
    } finally {
      if (tempDirectory) {
        try {
          await rm(tempDirectory, { recursive: true, force: true });
        } catch {
          const run = this.rehearsals.get(runId);
          if (run) {
            run.status = 'failed';
            run.phase = 'failed';
            run.finished_at = new Date().toISOString();
            run.error = {
              code: 'POSTGRES_MIGRATION_TEMP_CLEANUP_FAILED',
              message:
                'The rehearsal finished, but its temporary dump could not be removed from the OpenLander host.',
            };
          }
        }
      }
    }
  }
}
