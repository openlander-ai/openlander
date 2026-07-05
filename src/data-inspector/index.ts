import { createHash, randomBytes } from 'node:crypto';

import type { AppContext } from '../app.js';
import { kindToLegacyType, MANAGED_SERVICE_KINDS } from '../db/repos/service.repo.js';
import type { ServiceRow } from '../db/types.js';
import { decrypt, encrypt } from '../env/crypto.js';

const SUPPORTED_KINDS = new Set(['postgres', 'redis']);
const POSTGRES_FORBIDDEN_SQL =
  /\b(?:insert|update|delete|copy|create|alter|drop|truncate|grant|revoke|do|call|merge|refresh|vacuum|analyze|listen|notify|set|reset)\b/i;
const POSTGRES_FORBIDDEN_FUNCTIONS = /\bset_config\s*\(/i;
const POSTGRES_MAX_ROWS = 100;
const POSTGRES_DEFAULT_ROWS = 50;
const MAX_RESULT_BYTES = 128 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;
const REDIS_MAX_ITEMS = 100;
const REDIS_DEFAULT_ITEMS = 50;
const REDIS_MAX_DB_INDEX = 15;

const DEFAULT_DATA_ACCESS_NEXT_STEPS = [
  'Do not ask for or expose raw database credentials.',
  'Ask the user to enable Agent read access in Project Settings → Data Access if needed.',
] as const;

export type DataSourceKind = 'postgres' | 'redis' | 'external';
export type DataSourceAccessStatus =
  'enabled' | 'disabled' | 'external_requires_setup' | 'unsupported';

export interface DataSourceSummary {
  data_source_id: string;
  service_id: string | null;
  project_id: string;
  name: string;
  kind: DataSourceKind;
  status: DataSourceAccessStatus;
  queryable: boolean;
  access_mode: 'read' | 'disabled' | null;
  source: 'managed_service' | 'external_env';
  env_key?: string;
  host?: string;
  database?: string;
}

type ManagedSource = DataSourceSummary & { service_id: string; kind: 'postgres' | 'redis' };

export interface DataSourceReadResult {
  status: 'ok';
  data_source: Pick<
    DataSourceSummary,
    'data_source_id' | 'service_id' | 'project_id' | 'name' | 'kind'
  >;
  operation: string;
  rows?: Array<Record<string, unknown>>;
  values?: unknown;
  count: number;
  limit: number;
  truncated: boolean;
  duration_ms: number;
}

export interface DataSourceDescribeResult {
  status: 'ok';
  data_source: Pick<
    DataSourceSummary,
    'data_source_id' | 'service_id' | 'project_id' | 'name' | 'kind'
  >;
  database?: string;
  schemas?: Array<{
    schema: string;
    tables: Array<{
      table: string;
      columns: Array<{ name: string; type: string; nullable: boolean }>;
    }>;
  }>;
  redis?: {
    keyspace: string[];
    dbsize: number | null;
    sample_keys: string[];
  };
}

export function dataAccessBlockedResponse(
  code: string,
  message: string,
  details: Record<string, unknown> = {},
  nextSteps: string[] = [...DEFAULT_DATA_ACCESS_NEXT_STEPS],
): Record<string, unknown> {
  return {
    status: 'blocked',
    error: code,
    code,
    message,
    details,
    report_to_user: {
      status: 'blocked',
      code,
      message,
    },
    safe_alternatives: nextSteps,
    _agent_guidance: {
      message,
      next_steps: nextSteps,
    },
  };
}

function parseCredentials(service: ServiceRow): Record<string, string> | null {
  if (!service.credentials) return null;
  try {
    const parsed: unknown = JSON.parse(service.credentials);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'string') result[key] = value;
      else if (typeof value === 'number' || typeof value === 'boolean') result[key] = String(value);
    }
    return result;
  } catch {
    return null;
  }
}

function serviceKind(service: ServiceRow): string {
  // Wire contract historically exposes postgresql/mongodb while canonical kind is postgres/mongo.
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  return service.type ?? kindToLegacyType(service.kind);
}

function normalizeKind(service: ServiceRow): DataSourceKind | null {
  const kind = service.kind === 'postgres' ? 'postgres' : service.kind;
  if (kind === 'postgres' || kind === 'redis') return kind;
  return null;
}

function clampLimit(value: unknown, defaultValue: number, maxValue: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) return defaultValue;
  return Math.min(value, maxValue);
}

function redactAuditPreview(value: string): string {
  return value
    .replace(/\$[A-Za-z_][A-Za-z0-9_]*\$[\s\S]*?\$[A-Za-z_][A-Za-z0-9_]*\$/g, '$[redacted]$')
    .replace(/\$\$[\s\S]*?\$\$/g, '$$[redacted]$$')
    .replace(/'(?:''|[^'])*'/g, "'[redacted]'")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer [redacted-token]')
    .replace(
      /\b(?:sk|pk|rk|ghp|gho|ghu|pat|xox[baprs]?)[_-][A-Za-z0-9_-]{8,}\b/gi,
      '[redacted-token]',
    )
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted-email]')
    .replace(/\b[A-Za-z0-9_-]{24,}\b/g, '[redacted-token]')
    .replace(/\b\d+(?:\.\d+)?\b/g, '[number]')
    .slice(0, 180);
}

function redisDatabaseFromConnectionString(
  connectionString: string | undefined,
): string | undefined {
  if (!connectionString) return undefined;
  try {
    const url = new URL(connectionString);
    if (!url.protocol.startsWith('redis')) return undefined;
    const raw = url.pathname.replace(/^\//, '').trim();
    return /^\d+$/.test(raw) ? raw : undefined;
  } catch {
    return undefined;
  }
}

function sourceFromManagedService(
  projectId: string,
  service: ServiceRow,
  accessMode: 'read' | 'disabled' | null,
): DataSourceSummary | null {
  const kind = normalizeKind(service);
  if (!kind) return null;
  const credentials = parseCredentials(service);
  return {
    data_source_id: service.id,
    service_id: service.id,
    project_id: projectId,
    name: service.name,
    kind,
    status: accessMode === 'read' ? 'enabled' : 'disabled',
    queryable: accessMode === 'read',
    access_mode: accessMode ?? 'disabled',
    source: 'managed_service',
    host: service.container_name ?? undefined,
    database:
      kind === 'postgres'
        ? credentials?.['database']
        : redisDatabaseFromConnectionString(credentials?.['connectionString']),
  };
}

function managedHost(host: string): boolean {
  return host.startsWith('ol-svc-') || !host.includes('.');
}

function externalSourceFromEnv(
  projectId: string,
  key: string,
  value: string,
): DataSourceSummary | null {
  if (!/_?(?:DATABASE|REDIS|POSTGRES)_?URL$/i.test(key) && !/^DATABASE_URL$/i.test(key)) {
    return null;
  }
  try {
    const url = new URL(value);
    if (managedHost(url.hostname)) return null;
    const kind: DataSourceKind = url.protocol.startsWith('redis')
      ? 'redis'
      : url.protocol.startsWith('postgres')
        ? 'postgres'
        : 'external';
    return {
      data_source_id: `external:${key}`,
      service_id: null,
      project_id: projectId,
      name: key,
      kind,
      status: 'external_requires_setup',
      queryable: false,
      access_mode: null,
      source: 'external_env',
      env_key: key,
      host: url.hostname,
      database: url.pathname ? url.pathname.replace(/^\//, '') || undefined : undefined,
    };
  } catch {
    return null;
  }
}

async function managedServicesForProject(
  ctx: AppContext,
  projectId: string,
): Promise<ServiceRow[]> {
  const direct = await ctx.db.getServices({ project_id: projectId, kindIn: MANAGED_SERVICE_KINDS });
  const connections = await ctx.db.listServiceConnectionsByProject(projectId);
  const connected = (
    await Promise.all(
      connections.map((connection) => ctx.db.getService(connection.service_id_provider)),
    )
  ).filter((service): service is ServiceRow => service !== undefined);
  const byId = new Map<string, ServiceRow>();
  for (const service of [...direct, ...connected]) {
    if (SUPPORTED_KINDS.has(service.kind)) byId.set(service.id, service);
  }
  return [...byId.values()];
}

export async function listProjectDataSources(
  ctx: AppContext,
  projectId: string,
): Promise<DataSourceSummary[]> {
  const managed = await managedServicesForProject(ctx, projectId);
  const accessRows = await ctx.db.listDataSourceAccessByProjectAndServices(
    projectId,
    managed.map((service) => service.id),
  );
  const accessByService = new Map(accessRows.map((row) => [row.service_id, row]));
  const managedSources = managed
    .map((service) =>
      sourceFromManagedService(
        projectId,
        service,
        accessByService.get(service.id)?.mode ?? 'disabled',
      ),
    )
    .filter((source): source is DataSourceSummary => source !== null);

  const envVars = await ctx.env.getAll(projectId).catch(() => ({}));
  const external = Object.entries(envVars)
    .map(([key, value]) => externalSourceFromEnv(projectId, key, value))
    .filter((source): source is DataSourceSummary => source !== null);

  return [...managedSources, ...external].sort((a, b) => a.name.localeCompare(b.name));
}

export async function resolveManagedDataSource(
  ctx: AppContext,
  serviceId: string,
): Promise<{ service: ServiceRow; source: ManagedSource } | { error: Record<string, unknown> }> {
  const service = await ctx.db.getService(serviceId);
  if (!service) {
    return { error: dataAccessBlockedResponse('DATA_SOURCE_NOT_FOUND', 'Data source not found.') };
  }
  const kind = normalizeKind(service);
  if (!kind) {
    return {
      error: dataAccessBlockedResponse(
        'DATA_SOURCE_UNSUPPORTED',
        'Only managed Postgres and Redis data sources are supported in this version.',
        {
          service_id: service.id,
          kind: serviceKind(service),
        },
      ),
    };
  }
  const access = await ctx.db.getDataSourceAccess(service.project_id, service.id);
  const source = sourceFromManagedService(service.project_id, service, access?.mode ?? 'disabled');
  if (!source || !source.service_id || source.kind === 'external') {
    return {
      error: dataAccessBlockedResponse('DATA_SOURCE_UNSUPPORTED', 'Data source is unsupported.'),
    };
  }
  if (access?.mode !== 'read') {
    return {
      error: dataAccessBlockedResponse(
        'DATA_ACCESS_NOT_ENABLED',
        'Agent read access is not enabled for this data source.',
        {
          project_id: service.project_id,
          service_id: service.id,
          enable_path: 'Project Settings → Data Access',
        },
        [
          'Report that Agent read access is disabled for this data source.',
          'Ask the user to enable Agent read access in Project Settings → Data Access.',
          'After the user enables it, call list_data_sources again. Do not ask for raw credentials.',
        ],
      ),
    };
  }
  return { service, source: source as ManagedSource };
}

function quotePostgresIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function quoteSqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function postgresReaderName(serviceId: string): string {
  const digest = createHash('sha256').update(serviceId).digest('hex').slice(0, 12);
  return `ol_reader_${digest}`;
}

async function postgresExec(
  ctx: AppContext,
  serviceId: string,
  password: string,
  user: string,
  database: string,
  sql: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  env: Record<string, string> = {},
): Promise<{ exitCode: number; stdout: string; stderr: string; truncated?: boolean }> {
  return await ctx.serviceManager.exec(
    serviceId,
    [
      'sh',
      '-c',
      'psql -h 127.0.0.1 -v ON_ERROR_STOP=1 -X -q -t -A -U "$1" -d "$2" -f -',
      'openlander-data-inspector',
      user,
      database,
    ],
    {
      throwOnNonZeroExit: false,
      timeoutMs,
      maxOutputBytes: MAX_RESULT_BYTES,
      env: { PGPASSWORD: password, ...env },
      stdin: sql,
    },
  );
}

async function grantPostgresRead(
  ctx: AppContext,
  service: ServiceRow,
  database: string,
  reader: { username: string; password: string },
): Promise<Record<string, unknown> | null> {
  const credentials = parseCredentials(service);
  if (!credentials?.['user'] || !credentials['password']) {
    return dataAccessBlockedResponse(
      'DATA_SOURCE_CREDENTIALS_UNAVAILABLE',
      'Postgres admin credentials are unavailable for reader setup.',
      { service_id: service.id },
    );
  }
  const role = quotePostgresIdentifier(reader.username);
  const db = quotePostgresIdentifier(database);
  const adminUser = credentials['user'];
  const adminPassword = credentials['password'];
  const adminDatabase = credentials['database'] ?? 'postgres';
  const createRoleSql = [
    `DO $$ DECLARE role_name text := ${quoteSqlLiteral(reader.username)}; role_password text := current_setting('openlander.reader_password', true); BEGIN IF role_password IS NULL OR role_password = '' THEN RAISE EXCEPTION 'openlander reader password is missing'; END IF; IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN EXECUTE format('CREATE ROLE %I LOGIN PASSWORD %L', role_name, role_password); ELSE EXECUTE format('ALTER ROLE %I LOGIN PASSWORD %L', role_name, role_password); END IF; END $$`,
    `ALTER ROLE ${role} SET statement_timeout = ${quoteSqlLiteral(`${String(DEFAULT_TIMEOUT_MS)}ms`)}`,
    `GRANT CONNECT ON DATABASE ${db} TO ${role}`,
  ].join('; ');
  const createRole = await postgresExec(
    ctx,
    service.id,
    adminPassword,
    adminUser,
    adminDatabase,
    createRoleSql,
    DEFAULT_TIMEOUT_MS,
    { PGOPTIONS: `-c openlander.reader_password=${reader.password}` },
  );
  if (createRole.exitCode !== 0) {
    return dataAccessBlockedResponse(
      'DATA_SOURCE_READER_SETUP_FAILED',
      createRole.stderr.trim() || createRole.stdout.trim() || 'Failed to create reader role.',
      { service_id: service.id },
    );
  }

  const grantsSql = [
    `GRANT USAGE ON SCHEMA public TO ${role}`,
    `GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${role}`,
    `GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO ${role}`,
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO ${role}`,
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON SEQUENCES TO ${role}`,
  ].join('; ');
  const grants = await postgresExec(ctx, service.id, adminPassword, adminUser, database, grantsSql);
  if (grants.exitCode !== 0) {
    return dataAccessBlockedResponse(
      'DATA_SOURCE_READER_SETUP_FAILED',
      grants.stderr.trim() || grants.stdout.trim() || 'Failed to grant reader role.',
      { service_id: service.id, database },
    );
  }
  return null;
}

export async function enableDataSourceReadAccess(
  ctx: AppContext,
  projectId: string,
  serviceId: string,
): Promise<DataSourceSummary | Record<string, unknown>> {
  const service = await ctx.db.getService(serviceId);
  if (!service || service.project_id !== projectId || !SUPPORTED_KINDS.has(service.kind)) {
    return dataAccessBlockedResponse(
      'DATA_SOURCE_NOT_FOUND',
      'Data source not found in this Project.',
    );
  }

  if (service.kind === 'postgres') {
    const credentials = parseCredentials(service);
    const username = postgresReaderName(service.id);
    const password = randomBytes(18).toString('base64url');
    const setupError = await grantPostgresRead(
      ctx,
      service,
      credentials?.['database'] ?? 'postgres',
      {
        username,
        password,
      },
    );
    if (setupError) return setupError;
    const encrypted = encrypt(password);
    await ctx.db.upsertDataSourceAccess({
      projectId,
      serviceId,
      mode: 'read',
      readerUsername: username,
      readerPasswordEncrypted: encrypted.encrypted,
      readerPasswordIv: encrypted.iv,
    });
  } else {
    await ctx.db.upsertDataSourceAccess({ projectId, serviceId, mode: 'read' });
  }

  const source = (await listProjectDataSources(ctx, projectId)).find(
    (candidate) => candidate.service_id === serviceId,
  );
  return (
    source ??
    dataAccessBlockedResponse('DATA_SOURCE_NOT_FOUND', 'Data source not found after enabling.')
  );
}

export async function disableDataSourceReadAccess(
  ctx: AppContext,
  projectId: string,
  serviceId: string,
): Promise<DataSourceSummary | Record<string, unknown>> {
  await ctx.db.upsertDataSourceAccess({ projectId, serviceId, mode: 'disabled' });
  const source = (await listProjectDataSources(ctx, projectId)).find(
    (candidate) => candidate.service_id === serviceId,
  );
  return (
    source ??
    dataAccessBlockedResponse('DATA_SOURCE_NOT_FOUND', 'Data source not found after disabling.')
  );
}

function normalizePostgresQuery(
  query: string,
): { ok: true; sql: string } | { ok: false; message: string } {
  const trimmed = query.trim();
  if (!trimmed) return { ok: false, message: 'query is required.' };
  if (/^\s*\\/m.test(trimmed)) {
    return { ok: false, message: 'psql meta-commands are not allowed.' };
  }
  const withoutTerminalSemicolon = trimmed.endsWith(';') ? trimmed.slice(0, -1).trim() : trimmed;
  if (withoutTerminalSemicolon.includes(';')) {
    return { ok: false, message: 'Only a single SQL statement is allowed.' };
  }
  if (!/^(?:select|with)\b/i.test(withoutTerminalSemicolon)) {
    return { ok: false, message: 'Only SELECT or read-only WITH queries are allowed.' };
  }
  if (POSTGRES_FORBIDDEN_SQL.test(withoutTerminalSemicolon)) {
    return { ok: false, message: 'Query contains a blocked SQL keyword.' };
  }
  if (POSTGRES_FORBIDDEN_FUNCTIONS.test(withoutTerminalSemicolon)) {
    return { ok: false, message: 'Query contains a blocked SQL function.' };
  }
  return { ok: true, sql: withoutTerminalSemicolon };
}

function decryptReaderPassword(row: {
  reader_password_encrypted: string | null;
  reader_password_iv: string | null;
}): string | null {
  if (!row.reader_password_encrypted || !row.reader_password_iv) return null;
  return decrypt(row.reader_password_encrypted, row.reader_password_iv);
}

function isReaderCredentials(value: unknown): value is { username: string; password: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'username' in value &&
    'password' in value &&
    typeof (value as { username?: unknown }).username === 'string' &&
    typeof (value as { password?: unknown }).password === 'string'
  );
}

type RedisCliInvocation =
  | { ok: true; command: string[]; env: Record<string, string>; database?: number }
  | { ok: false; response: Record<string, unknown> };

function parseRedisDatabaseIndex(
  value: unknown,
  details: Record<string, unknown>,
): { ok: true; database?: number } | { ok: false; response: Record<string, unknown> } {
  if (value == null || value === '') return { ok: true };
  const raw = typeof value === 'number' ? String(value) : typeof value === 'string' ? value : null;
  const trimmed = raw?.trim();
  if (!trimmed) return { ok: true };
  if (!/^\d+$/.test(trimmed)) {
    return {
      ok: false,
      response: dataAccessBlockedResponse(
        'DATA_REDIS_DB_INVALID',
        'Redis database must be an integer index.',
        details,
        [
          'Retry with database set to an integer Redis DB index, for example "0".',
          'Use describe_data_source without database if you are not sure which DB to inspect.',
        ],
      ),
    };
  }
  const database = Number.parseInt(trimmed, 10);
  if (database < 0 || database > REDIS_MAX_DB_INDEX) {
    return {
      ok: false,
      response: dataAccessBlockedResponse(
        'DATA_REDIS_DB_INVALID',
        `Redis database must be between 0 and ${String(REDIS_MAX_DB_INDEX)}.`,
        { ...details, max_database: REDIS_MAX_DB_INDEX },
        [
          `Retry with a Redis DB index from 0 to ${String(REDIS_MAX_DB_INDEX)}.`,
          'Use describe_data_source without database if you are not sure which DB to inspect.',
        ],
      ),
    };
  }
  return { ok: true, database };
}

function redisCliInvocation(
  service: ServiceRow,
  databaseInput: unknown,
  args: string[],
): RedisCliInvocation {
  const credentials = parseCredentials(service);
  const details = { service_id: service.id };
  let username = credentials?.['username'] ?? credentials?.['user'];
  let password = credentials?.['password'];
  let defaultDatabase: number | undefined;
  const connectionString = credentials?.['connectionString'];

  if (connectionString) {
    try {
      const url = new URL(connectionString);
      if (url.protocol.startsWith('redis')) {
        if (!username && url.username) username = decodeURIComponent(url.username);
        if (!password && url.password) password = decodeURIComponent(url.password);
        const parsedDefault = parseRedisDatabaseIndex(url.pathname.replace(/^\//, ''), details);
        if (!parsedDefault.ok) return { ok: false, response: parsedDefault.response };
        defaultDatabase = parsedDefault.database;
      }
    } catch {
      // A malformed connection string should not leak credentials or block local managed Redis
      // instances that can still answer redis-cli on localhost.
    }
  }

  const parsedInput = parseRedisDatabaseIndex(databaseInput, details);
  if (!parsedInput.ok) return { ok: false, response: parsedInput.response };
  const database = parsedInput.database ?? defaultDatabase;
  const command = ['redis-cli', '--raw'];
  if (username) command.push('--user', username);
  if (database !== undefined) command.push('-n', String(database));
  command.push(...args);
  return {
    ok: true,
    command,
    env: password ? { REDISCLI_AUTH: password } : {},
    database,
  };
}

function redisFailureResponse(service: ServiceRow, output: string): Record<string, unknown> {
  const message = output.trim() || 'Redis read operation failed.';
  if (/\b(?:NOAUTH|WRONGPASS|AUTH failed|invalid username-password)\b/i.test(message)) {
    return dataAccessBlockedResponse(
      'DATA_REDIS_AUTH_FAILED',
      'Redis authentication failed for this managed data source.',
      { service_id: service.id },
      [
        'Report that OpenLander could not authenticate to the managed Redis data source.',
        'Ask the user to verify or recreate the managed Redis service credentials.',
        'Do not ask the user to paste raw Redis credentials into the agent chat.',
      ],
    );
  }
  return dataAccessBlockedResponse('DATA_QUERY_FAILED', message);
}

function postgresDatabaseName(
  value: unknown,
  defaultDatabase: string,
  serviceId: string,
): { ok: true; database: string } | { ok: false; response: Record<string, unknown> } {
  if (value == null || value === '') return { ok: true, database: defaultDatabase };
  if (typeof value !== 'string') {
    return {
      ok: false,
      response: dataAccessBlockedResponse(
        'DATA_POSTGRES_DATABASE_INVALID',
        'Postgres database must be a database name string.',
        { service_id: serviceId },
        [
          'Retry with database set to a Postgres database name string.',
          'Use describe_data_source without database to inspect the default database.',
        ],
      ),
    };
  }
  const trimmed = value.trim();
  if (!trimmed) return { ok: true, database: defaultDatabase };
  return { ok: true, database: trimmed };
}

async function getPostgresReaderCredentials(
  ctx: AppContext,
  service: ServiceRow,
): Promise<{ username: string; password: string } | Record<string, unknown>> {
  const access = await ctx.db.getDataSourceAccess(service.project_id, service.id);
  if (!access?.reader_username) {
    return dataAccessBlockedResponse(
      'DATA_ACCESS_NOT_ENABLED',
      'Postgres reader credentials are not configured.',
    );
  }
  const password = decryptReaderPassword(access);
  if (!password) {
    return dataAccessBlockedResponse(
      'DATA_ACCESS_NOT_ENABLED',
      'Postgres reader password is not configured.',
    );
  }
  return { username: access.reader_username, password };
}

export async function describeDataSource(
  ctx: AppContext,
  serviceId: string,
  options: { database?: string | number; schema?: string } = {},
): Promise<DataSourceDescribeResult | Record<string, unknown>> {
  const resolved = await resolveManagedDataSource(ctx, serviceId);
  if ('error' in resolved) return resolved.error;
  const { service, source } = resolved;
  const credentials = parseCredentials(service);

  if (source.kind === 'postgres') {
    const postgresDatabase = postgresDatabaseName(
      options.database,
      credentials?.['database'] ?? 'postgres',
      service.id,
    );
    if (!postgresDatabase.ok) return postgresDatabase.response;
    const database = postgresDatabase.database;
    const reader = await getPostgresReaderCredentials(ctx, service);
    if (!isReaderCredentials(reader)) return reader;
    const schemaFilter = options.schema ?? 'public';
    const sql = `
      SELECT COALESCE(json_agg(row_to_json(cols)), '[]'::json)::text
      FROM (
        SELECT table_schema, table_name, column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_schema = ${quoteSqlLiteral(schemaFilter)}
        ORDER BY table_schema, table_name, ordinal_position
        LIMIT 300
      ) cols
    `;
    const result = await postgresExec(
      ctx,
      service.id,
      reader.password,
      reader.username,
      database,
      sql,
    );
    if (result.exitCode !== 0) {
      return dataAccessBlockedResponse(
        'DATA_SOURCE_DESCRIBE_FAILED',
        result.stderr.trim() || result.stdout.trim(),
      );
    }
    const rows = JSON.parse(result.stdout.trim() || '[]') as Array<Record<string, unknown>>;
    const tables = new Map<string, Array<{ name: string; type: string; nullable: boolean }>>();
    for (const row of rows) {
      const table = typeof row['table_name'] === 'string' ? row['table_name'] : '';
      const column = typeof row['column_name'] === 'string' ? row['column_name'] : '';
      const type = typeof row['data_type'] === 'string' ? row['data_type'] : '';
      if (!table || !column) continue;
      const columns = tables.get(table) ?? [];
      columns.push({ name: column, type, nullable: row['is_nullable'] === 'YES' });
      tables.set(table, columns);
    }
    return {
      status: 'ok',
      data_source: source,
      database,
      schemas: [
        {
          schema: schemaFilter,
          tables: [...tables.entries()].map(([table, columns]) => ({ table, columns })),
        },
      ],
    };
  }

  const infoCommand = redisCliInvocation(service, options.database, ['INFO', 'keyspace']);
  if (!infoCommand.ok) return infoCommand.response;
  const dbsizeCommand = redisCliInvocation(service, options.database, ['DBSIZE']);
  if (!dbsizeCommand.ok) return dbsizeCommand.response;
  const scanCommand = redisCliInvocation(service, options.database, ['SCAN', '0', 'COUNT', '20']);
  if (!scanCommand.ok) return scanCommand.response;

  const [info, dbsize, scan] = await Promise.all([
    ctx.serviceManager.exec(service.id, infoCommand.command, {
      throwOnNonZeroExit: false,
      timeoutMs: DEFAULT_TIMEOUT_MS,
      maxOutputBytes: 16 * 1024,
      env: infoCommand.env,
    }),
    ctx.serviceManager.exec(service.id, dbsizeCommand.command, {
      throwOnNonZeroExit: false,
      timeoutMs: DEFAULT_TIMEOUT_MS,
      maxOutputBytes: 16 * 1024,
      env: dbsizeCommand.env,
    }),
    ctx.serviceManager.exec(service.id, scanCommand.command, {
      throwOnNonZeroExit: false,
      timeoutMs: DEFAULT_TIMEOUT_MS,
      maxOutputBytes: 16 * 1024,
      env: scanCommand.env,
    }),
  ]);
  if (info.exitCode !== 0 || dbsize.exitCode !== 0 || scan.exitCode !== 0) {
    return redisFailureResponse(service, info.stderr || dbsize.stderr || scan.stderr);
  }
  const scanLines = scan.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  return {
    status: 'ok',
    data_source: source,
    redis: {
      keyspace: info.stdout
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.startsWith('db')),
      dbsize: Number.parseInt(dbsize.stdout.trim(), 10) || null,
      sample_keys: scanLines.slice(1, 21),
    },
  };
}

export async function readDataSource(
  ctx: AppContext,
  serviceId: string,
  input: Record<string, unknown>,
): Promise<DataSourceReadResult | Record<string, unknown>> {
  const resolved = await resolveManagedDataSource(ctx, serviceId);
  if ('error' in resolved) return resolved.error;
  const { service, source } = resolved;
  const startedAt = Date.now();
  const operation = typeof input['operation'] === 'string' ? input['operation'] : '';
  let result: DataSourceReadResult | Record<string, unknown>;

  if (source.kind === 'postgres') {
    if (operation !== 'sql.query') {
      return dataAccessBlockedResponse(
        'DATA_OPERATION_UNSUPPORTED',
        'Postgres supports operation "sql.query" only.',
      );
    }
    const query = typeof input['query'] === 'string' ? input['query'] : '';
    const normalized = normalizePostgresQuery(query);
    if (!normalized.ok) {
      return dataAccessBlockedResponse(
        'DATA_QUERY_BLOCKED',
        normalized.message,
        { operation, service_id: service.id },
        [
          'Do not retry blocked write or mutation statements.',
          'Use describe_data_source to inspect available tables and columns.',
          'Retry read_data_source with one SELECT or read-only WITH query and a small limit.',
        ],
      );
    }
    const credentials = parseCredentials(service);
    const postgresDatabase = postgresDatabaseName(
      input['database'],
      credentials?.['database'] ?? 'postgres',
      service.id,
    );
    if (!postgresDatabase.ok) return postgresDatabase.response;
    const database = postgresDatabase.database;
    const reader = await getPostgresReaderCredentials(ctx, service);
    if (!isReaderCredentials(reader)) return reader;
    const limit = clampLimit(input['limit'], POSTGRES_DEFAULT_ROWS, POSTGRES_MAX_ROWS);
    const wrappedSql = `SELECT COALESCE(json_agg(row_to_json(__ol_row)), '[]'::json)::text FROM (SELECT * FROM (${normalized.sql}) AS __ol_user_query LIMIT ${String(limit + 1)}) AS __ol_row`;
    const exec = await postgresExec(
      ctx,
      service.id,
      reader.password,
      reader.username,
      database,
      wrappedSql,
    );
    if (exec.exitCode !== 0) {
      return dataAccessBlockedResponse(
        'DATA_QUERY_FAILED',
        exec.stderr.trim() || exec.stdout.trim(),
      );
    }
    if (exec.truncated === true) {
      const response = {
        ...dataAccessBlockedResponse(
          'DATA_RESULT_TOO_LARGE',
          'Query result exceeded the response byte cap.',
          {
            service_id: service.id,
            max_result_bytes: MAX_RESULT_BYTES,
            limit,
          },
          [
            'Retry with a lower limit.',
            'Select fewer or smaller columns.',
            'Do not ask for or expose raw database credentials.',
          ],
        ),
        truncated: true,
        duration_ms: Date.now() - startedAt,
      };
      await auditDataAccess(ctx, service, operation, query, response);
      return response;
    }
    const rows = JSON.parse(exec.stdout.trim() || '[]') as Array<Record<string, unknown>>;
    const visibleRows = rows.slice(0, limit);
    result = {
      status: 'ok',
      data_source: source,
      operation,
      rows: visibleRows,
      count: visibleRows.length,
      limit,
      truncated: rows.length > limit,
      duration_ms: Date.now() - startedAt,
    };
    await auditDataAccess(ctx, service, operation, query, result);
    return result;
  }

  result = await readRedisDataSource(ctx, service, source, operation, input, startedAt);
  if ('status' in result && result.status === 'ok') {
    await auditDataAccess(
      ctx,
      service,
      operation,
      typeof input['key'] === 'string' ? input['key'] : JSON.stringify({ operation }),
      result,
    );
  }
  return result;
}

async function readRedisDataSource(
  ctx: AppContext,
  service: ServiceRow,
  source: ManagedSource,
  operation: string,
  input: Record<string, unknown>,
  startedAt: number,
): Promise<DataSourceReadResult | Record<string, unknown>> {
  const limit = clampLimit(input['limit'] ?? input['count'], REDIS_DEFAULT_ITEMS, REDIS_MAX_ITEMS);
  const key = typeof input['key'] === 'string' ? input['key'] : '';
  const keys = Array.isArray(input['keys'])
    ? input['keys']
        .filter((candidate): candidate is string => typeof candidate === 'string')
        .slice(0, limit)
    : [];
  const pattern =
    typeof input['pattern'] === 'string' && input['pattern'].trim() ? input['pattern'].trim() : '*';
  const commandArgs =
    operation === 'redis.get' && key
      ? ['GET', key]
      : operation === 'redis.mget' && keys.length > 0
        ? ['MGET', ...keys]
        : operation === 'redis.type' && key
          ? ['TYPE', key]
          : operation === 'redis.ttl' && key
            ? ['TTL', key]
            : operation === 'redis.hgetall' && key
              ? ['HGETALL', key]
              : operation === 'redis.scan'
                ? ['SCAN', '0', 'MATCH', pattern, 'COUNT', String(limit)]
                : null;
  if (!commandArgs) {
    return dataAccessBlockedResponse(
      'DATA_OPERATION_UNSUPPORTED',
      'Redis supports redis.get, redis.mget, redis.type, redis.ttl, redis.hgetall, and redis.scan with required key/keys params.',
    );
  }
  const invocation = redisCliInvocation(service, input['database'], commandArgs);
  if (!invocation.ok) return invocation.response;
  const exec = await ctx.serviceManager.exec(service.id, invocation.command, {
    throwOnNonZeroExit: false,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    maxOutputBytes: MAX_RESULT_BYTES,
    env: invocation.env,
  });
  if (exec.exitCode !== 0) {
    return redisFailureResponse(service, exec.stderr.trim() || exec.stdout.trim());
  }
  const lines = exec.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const values =
    operation === 'redis.hgetall'
      ? Object.fromEntries(
          Array.from({ length: Math.floor(lines.length / 2) }, (_, index) => [
            lines[index * 2] ?? '',
            lines[index * 2 + 1] ?? '',
          ]),
        )
      : operation === 'redis.scan'
        ? { cursor: lines[0] ?? '0', keys: lines.slice(1, limit + 1) }
        : operation === 'redis.mget'
          ? lines.slice(0, keys.length)
          : (lines[0] ?? null);
  const count =
    operation === 'redis.scan'
      ? Array.isArray((values as { keys?: unknown }).keys)
        ? (values as { keys: unknown[] }).keys.length
        : 0
      : operation === 'redis.hgetall'
        ? Object.keys(values as Record<string, unknown>).length
        : Array.isArray(values)
          ? values.length
          : values == null
            ? 0
            : 1;
  return {
    status: 'ok',
    data_source: source,
    operation,
    values,
    count,
    limit,
    truncated: exec.truncated === true || count >= limit,
    duration_ms: Date.now() - startedAt,
  };
}

async function auditDataAccess(
  ctx: AppContext,
  service: ServiceRow,
  operation: string,
  preview: string,
  result: DataSourceReadResult | Record<string, unknown>,
): Promise<void> {
  const rowCount = typeof result['count'] === 'number' ? result['count'] : null;
  const truncated = result['truncated'] === true;
  const durationMs = typeof result['duration_ms'] === 'number' ? result['duration_ms'] : null;
  await ctx.db.insertActivityLog({
    event_type: 'data_access:read',
    activity_type: 'data_access',
    severity: 'info',
    project_id: service.project_id,
    correlation_id: service.id,
    title: 'Agent data source read',
    description: `${operation} on ${service.name}`,
    status: 'completed',
    metadata: JSON.stringify({
      service_id: service.id,
      data_source_id: service.id,
      kind: service.kind,
      operation,
      preview: redactAuditPreview(preview),
      query_hash: createHash('sha256').update(preview).digest('hex'),
      row_count: rowCount,
      duration_ms: durationMs,
      truncated,
    }),
  });
}
