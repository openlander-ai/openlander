import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  describeDataSource,
  enableDataSourceReadAccess,
  listProjectDataSources,
  readDataSource,
  resolveManagedDataSource,
} from '../src/data-inspector/index.js';
import type { AppContext } from '../src/app.js';
import type { ServiceRow } from '../src/db/types.js';
import { _resetCachedKey, encrypt } from '../src/env/crypto.js';
import { serviceToolDefs } from '../src/tools/defs/service.js';
import type { ToolDef } from '../src/tools/defs/types.js';

function service(partial: Partial<ServiceRow>): ServiceRow {
  return {
    id: 'svc-pg',
    project_id: 'p1',
    name: 'postgres',
    kind: 'postgres',
    parent_service_id: null,
    status: 'running',
    visibility: 'internal',
    assigned_port: 5432,
    container_id: 'container-1',
    container_name: 'ol-svc-postgres',
    container_port: 5432,
    image_tag: null,
    previous_image_tag: null,
    public_url: null,
    dockerfile_path: null,
    docker_target: null,
    build_context: null,
    build_method: null,
    source: 'managed',
    repo_url: null,
    branch: null,
    image_url: null,
    image_cmd: null,
    pending_fix: null,
    access_code: null,
    access_code_iv: null,
    is_preview: null,
    pr_number: null,
    project_type: 'web',
    health_check_strategy: null,
    health_check_path: null,
    recovering_started_at: null,
    credentials: JSON.stringify({
      user: 'postgres',
      password: 'secret',
      database: 'app',
      connectionString: 'postgres://postgres:secret@ol-svc-postgres:5432/app',
    }),
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    archived_at: null,
    ...partial,
  };
}

function context(overrides: Partial<AppContext> = {}): AppContext {
  const db = {
    getServices: vi.fn().mockResolvedValue([]),
    listServiceConnectionsByProject: vi.fn().mockResolvedValue([]),
    listDataSourceAccessByProjectAndServices: vi.fn().mockResolvedValue([]),
    getDataSourceAccess: vi.fn().mockResolvedValue(undefined),
    getService: vi.fn().mockResolvedValue(undefined),
    insertActivityLog: vi.fn().mockResolvedValue({}),
  };
  const env = {
    getAll: vi.fn().mockResolvedValue({}),
  };
  const serviceManager = {
    exec: vi.fn(),
  };
  return {
    db,
    env,
    serviceManager,
    ...overrides,
  } as unknown as AppContext;
}

describe('Project-aware data inspector', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    _resetCachedKey();
  });

  it('lists managed sources without credentials and marks external URLs as setup-required', async () => {
    const pg = service({ id: 'svc-pg', name: 'pg' });
    const redis = service({
      id: 'svc-redis',
      name: 'redis',
      kind: 'redis',
      assigned_port: 6379,
      container_port: 6379,
      credentials: JSON.stringify({ connectionString: 'redis://ol-svc-redis:6379' }),
    });
    const appCtx = context({
      db: {
        getServices: vi.fn().mockResolvedValue([pg, redis]),
        listServiceConnectionsByProject: vi.fn().mockResolvedValue([]),
        listDataSourceAccessByProjectAndServices: vi
          .fn()
          .mockResolvedValue([{ project_id: 'p1', service_id: 'svc-pg', mode: 'read' }]),
      },
      env: {
        getAll: vi.fn().mockResolvedValue({
          DATABASE_URL: 'postgres://user:pass@db.example.com/app',
        }),
      },
    } as Partial<AppContext>);

    const sources = await listProjectDataSources(appCtx, 'p1');

    expect(sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          data_source_id: 'svc-pg',
          kind: 'postgres',
          status: 'enabled',
          queryable: true,
        }),
        expect.objectContaining({
          data_source_id: 'svc-redis',
          kind: 'redis',
          status: 'disabled',
          queryable: false,
        }),
        expect.objectContaining({
          data_source_id: 'external:DATABASE_URL',
          status: 'external_requires_setup',
          queryable: false,
          host: 'db.example.com',
        }),
      ]),
    );
    expect(JSON.stringify(sources)).not.toContain('secret');
    expect(JSON.stringify(sources)).not.toContain('user:pass');
  });

  it('blocks reads when source access is disabled', async () => {
    const pg = service({ id: 'svc-pg' });
    const appCtx = context({
      db: {
        getService: vi.fn().mockResolvedValue(pg),
        getDataSourceAccess: vi.fn().mockResolvedValue(undefined),
      },
    } as Partial<AppContext>);

    const result = await resolveManagedDataSource(appCtx, 'svc-pg');

    expect(result).toEqual({
      error: expect.objectContaining({
        code: 'DATA_ACCESS_NOT_ENABLED',
        status: 'blocked',
        report_to_user: expect.objectContaining({
          message: 'Agent read access is not enabled for this data source.',
        }),
        safe_alternatives: expect.arrayContaining([
          'After the user enables it, call list_data_sources again. Do not ask for raw credentials.',
        ]),
      }),
    });
  });

  it('blocks service-scoped MCP tokens from data-source discovery', async () => {
    const action = serviceToolDefs.find((tool) => tool.name === 'list_data_sources');
    expect(action).toBeDefined();

    const result = await action!.execute({ project_id: 'p1' }, {
      appCtx: context(),
      target: 'mcp',
      identity: { mcpScopeKind: 'service' },
    } as unknown as Parameters<ToolDef['execute']>[1]);

    expect(result).toEqual(
      expect.objectContaining({
        status: 'blocked',
        code: 'DATA_ACCESS_REQUIRES_PROJECT_SCOPE',
      }),
    );
  });

  it('blocks Postgres write SQL before container exec', async () => {
    const pg = service({ id: 'svc-pg' });
    const exec = vi.fn();
    const appCtx = context({
      db: {
        getService: vi.fn().mockResolvedValue(pg),
        getDataSourceAccess: vi.fn().mockResolvedValue({
          project_id: 'p1',
          service_id: 'svc-pg',
          mode: 'read',
          reader_username: 'ol_reader_test',
          reader_password_encrypted: null,
          reader_password_iv: null,
        }),
      },
      serviceManager: { exec },
    } as Partial<AppContext>);

    const result = await readDataSource(appCtx, 'svc-pg', {
      operation: 'sql.query',
      query: 'UPDATE users SET admin = true',
    });

    expect(result).toEqual(
      expect.objectContaining({
        code: 'DATA_QUERY_BLOCKED',
        status: 'blocked',
        report_to_user: expect.objectContaining({
          code: 'DATA_QUERY_BLOCKED',
        }),
        safe_alternatives: expect.arrayContaining([
          'Retry read_data_source with one SELECT or read-only WITH query and a small limit.',
        ]),
      }),
    );
    expect(exec).not.toHaveBeenCalled();
  });

  it('blocks Postgres session-mutating functions before container exec', async () => {
    const pg = service({ id: 'svc-pg' });
    const exec = vi.fn();
    const appCtx = context({
      db: {
        getService: vi.fn().mockResolvedValue(pg),
        getDataSourceAccess: vi.fn().mockResolvedValue({
          project_id: 'p1',
          service_id: 'svc-pg',
          mode: 'read',
          reader_username: 'ol_reader_test',
          reader_password_encrypted: null,
          reader_password_iv: null,
        }),
      },
      serviceManager: { exec },
    } as Partial<AppContext>);

    const result = await readDataSource(appCtx, 'svc-pg', {
      operation: 'sql.query',
      query: "select set_config('x', 'y', true)",
    });

    expect(result).toEqual(
      expect.objectContaining({
        code: 'DATA_QUERY_BLOCKED',
        status: 'blocked',
      }),
    );
    expect(exec).not.toHaveBeenCalled();
  });

  it('blocks numeric Postgres database params before container exec', async () => {
    const pg = service({ id: 'svc-pg' });
    const exec = vi.fn();
    const appCtx = context({
      db: {
        getService: vi.fn().mockResolvedValue(pg),
        getDataSourceAccess: vi.fn().mockResolvedValue({
          project_id: 'p1',
          service_id: 'svc-pg',
          mode: 'read',
          reader_username: 'ol_reader_test',
          reader_password_encrypted: null,
          reader_password_iv: null,
        }),
      },
      serviceManager: { exec },
    } as Partial<AppContext>);

    const result = await readDataSource(appCtx, 'svc-pg', {
      operation: 'sql.query',
      query: 'SELECT 1',
      database: 3,
    });

    expect(result).toEqual(
      expect.objectContaining({
        code: 'DATA_POSTGRES_DATABASE_INVALID',
        status: 'blocked',
      }),
    );
    expect(exec).not.toHaveBeenCalled();
  });

  it('blocks numeric Postgres describe database params before container exec', async () => {
    const pg = service({ id: 'svc-pg' });
    const exec = vi.fn();
    const appCtx = context({
      db: {
        getService: vi.fn().mockResolvedValue(pg),
        getDataSourceAccess: vi.fn().mockResolvedValue({
          project_id: 'p1',
          service_id: 'svc-pg',
          mode: 'read',
          reader_username: 'ol_reader_test',
          reader_password_encrypted: null,
          reader_password_iv: null,
        }),
      },
      serviceManager: { exec },
    } as Partial<AppContext>);

    const result = await describeDataSource(appCtx, 'svc-pg', { database: 3 });

    expect(result).toEqual(
      expect.objectContaining({
        code: 'DATA_POSTGRES_DATABASE_INVALID',
        status: 'blocked',
      }),
    );
    expect(exec).not.toHaveBeenCalled();
  });

  it('returns a bounded error when Postgres JSON output is byte-truncated', async () => {
    vi.stubEnv('OPENLANDER_MASTER_KEY', '0'.repeat(64));
    _resetCachedKey();
    const pg = service({ id: 'svc-pg' });
    const encrypted = encrypt('reader-secret');
    const exec = vi.fn().mockResolvedValue({
      exitCode: 0,
      stdout: '[{\"payload\":\"unterminated',
      stderr: '',
      truncated: true,
    });
    const insertActivityLog = vi.fn().mockResolvedValue({});
    const appCtx = context({
      db: {
        getService: vi.fn().mockResolvedValue(pg),
        getDataSourceAccess: vi.fn().mockResolvedValue({
          project_id: 'p1',
          service_id: 'svc-pg',
          mode: 'read',
          reader_username: 'ol_reader_test',
          reader_password_encrypted: encrypted.encrypted,
          reader_password_iv: encrypted.iv,
        }),
        insertActivityLog,
      },
      serviceManager: { exec },
    } as Partial<AppContext>);

    const result = await readDataSource(appCtx, 'svc-pg', {
      operation: 'sql.query',
      query: "select repeat('x', 2000) as payload from generate_series(1,100)",
      limit: 100,
    });

    expect(result).toEqual(
      expect.objectContaining({
        code: 'DATA_RESULT_TOO_LARGE',
        status: 'blocked',
        truncated: true,
        details: expect.objectContaining({
          max_result_bytes: 128 * 1024,
          limit: 100,
        }),
      }),
    );
    expect(JSON.stringify(result)).not.toContain('unterminated');
    expect(insertActivityLog).toHaveBeenCalledWith(
      expect.objectContaining({
        activity_type: 'data_access',
        metadata: expect.stringContaining('"truncated":true'),
      }),
    );
  });

  it('enables Postgres read access by creating a reader role and storing encrypted credentials', async () => {
    vi.stubEnv('OPENLANDER_MASTER_KEY', '0'.repeat(64));
    _resetCachedKey();
    const pg = service({ id: 'svc-pg', name: 'pg' });
    const exec = vi.fn().mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });
    const upsertDataSourceAccess = vi.fn().mockResolvedValue({});
    const appCtx = context({
      db: {
        getService: vi.fn().mockResolvedValue(pg),
        getServices: vi.fn().mockResolvedValue([pg]),
        listServiceConnectionsByProject: vi.fn().mockResolvedValue([]),
        listDataSourceAccessByProjectAndServices: vi
          .fn()
          .mockResolvedValue([{ project_id: 'p1', service_id: 'svc-pg', mode: 'read' }]),
        upsertDataSourceAccess,
      },
      env: { getAll: vi.fn().mockResolvedValue({}) },
      serviceManager: { exec },
    } as Partial<AppContext>);

    const result = await enableDataSourceReadAccess(appCtx, 'p1', 'svc-pg');

    expect(result).toEqual(expect.objectContaining({ status: 'enabled', queryable: true }));
    expect(exec).toHaveBeenCalledTimes(2);
    expect(exec.mock.calls[0]?.[1]).toEqual(
      expect.arrayContaining([expect.stringContaining('CREATE ROLE')]),
    );
    expect(exec.mock.calls[0]?.[1]).toEqual(
      expect.arrayContaining([expect.stringContaining('current_setting')]),
    );
    expect(exec.mock.calls[0]?.[1]).toEqual(
      expect.arrayContaining([expect.stringContaining('statement_timeout')]),
    );
    expect(JSON.stringify(exec.mock.calls[0]?.[1])).not.toContain('secret');
    expect(exec.mock.calls[0]?.[2]).toEqual(
      expect.objectContaining({
        env: expect.objectContaining({
          PGPASSWORD: 'secret',
          PGOPTIONS: expect.stringContaining('openlander.reader_password='),
        }),
      }),
    );
    expect(exec.mock.calls[1]?.[1]).toEqual(
      expect.arrayContaining([expect.stringContaining('GRANT SELECT')]),
    );
    expect(upsertDataSourceAccess).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'p1',
        serviceId: 'svc-pg',
        mode: 'read',
        readerUsername: expect.stringMatching(/^ol_reader_/),
        readerPasswordEncrypted: expect.any(String),
        readerPasswordIv: expect.any(String),
      }),
    );
  });

  it('masks SQL literals in audit previews', async () => {
    vi.stubEnv('OPENLANDER_MASTER_KEY', '0'.repeat(64));
    _resetCachedKey();
    const pg = service({ id: 'svc-pg' });
    const encrypted = encrypt('reader-secret');
    const exec = vi.fn().mockResolvedValue({
      exitCode: 0,
      stdout: '[{\"id\":1,\"email\":\"a@example.com\"}]',
      stderr: '',
    });
    const insertActivityLog = vi.fn().mockResolvedValue({});
    const appCtx = context({
      db: {
        getService: vi.fn().mockResolvedValue(pg),
        getDataSourceAccess: vi.fn().mockResolvedValue({
          project_id: 'p1',
          service_id: 'svc-pg',
          mode: 'read',
          reader_username: 'ol_reader_test',
          reader_password_encrypted: encrypted.encrypted,
          reader_password_iv: encrypted.iv,
        }),
        insertActivityLog,
      },
      serviceManager: { exec },
    } as Partial<AppContext>);

    const result = await readDataSource(appCtx, 'svc-pg', {
      operation: 'sql.query',
      query: "SELECT * FROM users WHERE email='a@example.com' AND age=42",
    });

    expect(result).toEqual(expect.objectContaining({ status: 'ok', count: 1 }));
    expect(exec).toHaveBeenCalledTimes(1);
    expect(exec.mock.calls[0]?.[2]).toEqual(
      expect.objectContaining({
        env: expect.objectContaining({ PGPASSWORD: 'reader-secret' }),
      }),
    );
    const auditCall = insertActivityLog.mock.calls[0]?.[0] as { metadata?: string } | undefined;
    expect(auditCall?.metadata).toBeDefined();
    expect(auditCall?.metadata).not.toContain('a@example.com');
    expect(auditCall?.metadata).not.toContain('age=42');
    expect(auditCall?.metadata).toContain("'[redacted]'");
    expect(auditCall?.metadata).toContain('[number]');
  });

  it('does not re-run Postgres reader setup during bounded SQL reads', async () => {
    vi.stubEnv('OPENLANDER_MASTER_KEY', '0'.repeat(64));
    _resetCachedKey();
    const pg = service({ id: 'svc-pg' });
    const encrypted = encrypt('reader-secret');
    const exec = vi.fn().mockResolvedValue({
      exitCode: 0,
      stdout: '[{\"id\":1}]',
      stderr: '',
    });
    const appCtx = context({
      db: {
        getService: vi.fn().mockResolvedValue(pg),
        getDataSourceAccess: vi.fn().mockResolvedValue({
          project_id: 'p1',
          service_id: 'svc-pg',
          mode: 'read',
          reader_username: 'ol_reader_test',
          reader_password_encrypted: encrypted.encrypted,
          reader_password_iv: encrypted.iv,
        }),
        insertActivityLog: vi.fn().mockResolvedValue({}),
      },
      serviceManager: { exec },
    } as Partial<AppContext>);

    const result = await readDataSource(appCtx, 'svc-pg', {
      operation: 'sql.query',
      query: 'SELECT id FROM users',
    });

    expect(result).toEqual(expect.objectContaining({ status: 'ok', count: 1 }));
    expect(exec).toHaveBeenCalledTimes(1);
    const command = JSON.stringify(exec.mock.calls[0]?.[1]);
    expect(command).toContain('ol_reader_test');
    expect(command).not.toMatch(/CREATE ROLE|ALTER ROLE|GRANT SELECT|ALTER DEFAULT PRIVILEGES/);
  });

  it('does not re-run Postgres reader setup during schema describe', async () => {
    vi.stubEnv('OPENLANDER_MASTER_KEY', '0'.repeat(64));
    _resetCachedKey();
    const pg = service({ id: 'svc-pg' });
    const encrypted = encrypt('reader-secret');
    const exec = vi.fn().mockResolvedValue({
      exitCode: 0,
      stdout:
        '[{\"table_name\":\"users\",\"column_name\":\"id\",\"data_type\":\"integer\",\"is_nullable\":\"NO\"}]',
      stderr: '',
    });
    const appCtx = context({
      db: {
        getService: vi.fn().mockResolvedValue(pg),
        getDataSourceAccess: vi.fn().mockResolvedValue({
          project_id: 'p1',
          service_id: 'svc-pg',
          mode: 'read',
          reader_username: 'ol_reader_test',
          reader_password_encrypted: encrypted.encrypted,
          reader_password_iv: encrypted.iv,
        }),
      },
      serviceManager: { exec },
    } as Partial<AppContext>);

    const result = await describeDataSource(appCtx, 'svc-pg');

    expect(result).toEqual(
      expect.objectContaining({
        status: 'ok',
        schemas: [
          expect.objectContaining({
            tables: [
              expect.objectContaining({
                table: 'users',
              }),
            ],
          }),
        ],
      }),
    );
    expect(exec).toHaveBeenCalledTimes(1);
    const command = JSON.stringify(exec.mock.calls[0]?.[1]);
    expect(command).toContain('ol_reader_test');
    expect(command).not.toMatch(/CREATE ROLE|ALTER ROLE|GRANT SELECT|ALTER DEFAULT PRIVILEGES/);
  });

  it('runs Redis read operations through allowlisted commands and audits without values', async () => {
    const redis = service({
      id: 'svc-redis',
      name: 'cache',
      kind: 'redis',
      credentials: JSON.stringify({ connectionString: 'redis://ol-svc-redis:6379' }),
    });
    const exec = vi.fn().mockResolvedValue({ exitCode: 0, stdout: 'bar\n', stderr: '' });
    const insertActivityLog = vi.fn().mockResolvedValue({});
    const appCtx = context({
      db: {
        getService: vi.fn().mockResolvedValue(redis),
        getDataSourceAccess: vi.fn().mockResolvedValue({
          project_id: 'p1',
          service_id: 'svc-redis',
          mode: 'read',
        }),
        insertActivityLog,
      },
      serviceManager: { exec },
    } as Partial<AppContext>);

    const result = await readDataSource(appCtx, 'svc-redis', {
      operation: 'redis.get',
      key: 'foo',
    });

    expect(exec).toHaveBeenCalledWith(
      'svc-redis',
      ['redis-cli', '--raw', 'GET', 'foo'],
      expect.objectContaining({ throwOnNonZeroExit: false }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        status: 'ok',
        values: 'bar',
        count: 1,
      }),
    );
    expect(insertActivityLog).toHaveBeenCalledWith(
      expect.objectContaining({
        activity_type: 'data_access',
        metadata: expect.not.stringContaining('bar'),
      }),
    );
  });

  it('passes managed Redis auth through env and supports DB selection without exposing the password', async () => {
    const redis = service({
      id: 'svc-redis',
      name: 'cache',
      kind: 'redis',
      credentials: JSON.stringify({
        connectionString: 'redis://:redis-secret@ol-svc-redis:6379/2',
      }),
    });
    const exec = vi.fn().mockResolvedValue({ exitCode: 0, stdout: 'bar\n', stderr: '' });
    const appCtx = context({
      db: {
        getService: vi.fn().mockResolvedValue(redis),
        getDataSourceAccess: vi.fn().mockResolvedValue({
          project_id: 'p1',
          service_id: 'svc-redis',
          mode: 'read',
        }),
        insertActivityLog: vi.fn().mockResolvedValue({}),
      },
      serviceManager: { exec },
    } as Partial<AppContext>);

    const result = await readDataSource(appCtx, 'svc-redis', {
      operation: 'redis.get',
      key: 'foo',
      database: 3,
    });

    expect(result).toEqual(expect.objectContaining({ status: 'ok', values: 'bar' }));
    expect(exec).toHaveBeenCalledWith(
      'svc-redis',
      ['redis-cli', '--raw', '-n', '3', 'GET', 'foo'],
      expect.objectContaining({
        env: { REDISCLI_AUTH: 'redis-secret' },
      }),
    );
    expect(JSON.stringify(exec.mock.calls[0])).not.toContain('-a');
  });

  it('passes managed Redis ACL usernames while keeping passwords out of argv', async () => {
    const redis = service({
      id: 'svc-redis',
      name: 'cache',
      kind: 'redis',
      credentials: JSON.stringify({
        connectionString: 'redis://app-reader:redis-secret@ol-svc-redis:6379/2',
      }),
    });
    const exec = vi.fn().mockResolvedValue({ exitCode: 0, stdout: 'bar\n', stderr: '' });
    const appCtx = context({
      db: {
        getService: vi.fn().mockResolvedValue(redis),
        getDataSourceAccess: vi.fn().mockResolvedValue({
          project_id: 'p1',
          service_id: 'svc-redis',
          mode: 'read',
        }),
        insertActivityLog: vi.fn().mockResolvedValue({}),
      },
      serviceManager: { exec },
    } as Partial<AppContext>);

    const result = await readDataSource(appCtx, 'svc-redis', {
      operation: 'redis.get',
      key: 'foo',
    });

    expect(result).toEqual(expect.objectContaining({ status: 'ok', values: 'bar' }));
    expect(exec).toHaveBeenCalledWith(
      'svc-redis',
      ['redis-cli', '--raw', '--user', 'app-reader', '-n', '2', 'GET', 'foo'],
      expect.objectContaining({
        env: { REDISCLI_AUTH: 'redis-secret' },
      }),
    );
    expect(exec.mock.calls[0]?.[1]).not.toContain('redis-secret');
  });

  it('blocks invalid Redis DB indexes before container exec', async () => {
    const redis = service({
      id: 'svc-redis',
      name: 'cache',
      kind: 'redis',
      credentials: JSON.stringify({ connectionString: 'redis://ol-svc-redis:6379' }),
    });
    const exec = vi.fn();
    const appCtx = context({
      db: {
        getService: vi.fn().mockResolvedValue(redis),
        getDataSourceAccess: vi.fn().mockResolvedValue({
          project_id: 'p1',
          service_id: 'svc-redis',
          mode: 'read',
        }),
      },
      serviceManager: { exec },
    } as Partial<AppContext>);

    const result = await readDataSource(appCtx, 'svc-redis', {
      operation: 'redis.get',
      key: 'foo',
      database: '99',
    });

    expect(result).toEqual(
      expect.objectContaining({
        status: 'blocked',
        code: 'DATA_REDIS_DB_INVALID',
      }),
    );
    expect(exec).not.toHaveBeenCalled();
  });

  it('returns agent-readable guidance when managed Redis authentication fails', async () => {
    const redis = service({
      id: 'svc-redis',
      name: 'cache',
      kind: 'redis',
      credentials: JSON.stringify({ connectionString: 'redis://ol-svc-redis:6379' }),
    });
    const exec = vi.fn().mockResolvedValue({
      exitCode: 1,
      stdout: '',
      stderr: 'NOAUTH Authentication required.',
    });
    const appCtx = context({
      db: {
        getService: vi.fn().mockResolvedValue(redis),
        getDataSourceAccess: vi.fn().mockResolvedValue({
          project_id: 'p1',
          service_id: 'svc-redis',
          mode: 'read',
        }),
      },
      serviceManager: { exec },
    } as Partial<AppContext>);

    const result = await readDataSource(appCtx, 'svc-redis', {
      operation: 'redis.get',
      key: 'foo',
    });

    expect(result).toEqual(
      expect.objectContaining({
        status: 'blocked',
        code: 'DATA_REDIS_AUTH_FAILED',
        report_to_user: expect.objectContaining({
          message: 'Redis authentication failed for this managed data source.',
        }),
        safe_alternatives: expect.arrayContaining([
          'Do not ask the user to paste raw Redis credentials into the agent chat.',
        ]),
      }),
    );
  });

  it('redacts sensitive-looking Redis keys in audit previews', async () => {
    const redis = service({
      id: 'svc-redis',
      name: 'cache',
      kind: 'redis',
      credentials: JSON.stringify({ connectionString: 'redis://ol-svc-redis:6379' }),
    });
    const exec = vi.fn().mockResolvedValue({ exitCode: 0, stdout: 'bar\n', stderr: '' });
    const insertActivityLog = vi.fn().mockResolvedValue({});
    const appCtx = context({
      db: {
        getService: vi.fn().mockResolvedValue(redis),
        getDataSourceAccess: vi.fn().mockResolvedValue({
          project_id: 'p1',
          service_id: 'svc-redis',
          mode: 'read',
        }),
        insertActivityLog,
      },
      serviceManager: { exec },
    } as Partial<AppContext>);

    const result = await readDataSource(appCtx, 'svc-redis', {
      operation: 'redis.get',
      key: 'session:user@example.com:abcdef0123456789abcdef0123456789',
    });

    expect(result).toEqual(expect.objectContaining({ status: 'ok' }));
    const auditCall = insertActivityLog.mock.calls[0]?.[0] as { metadata?: string } | undefined;
    expect(auditCall?.metadata).toBeDefined();
    expect(auditCall?.metadata).not.toContain('user@example.com');
    expect(auditCall?.metadata).not.toContain('abcdef0123456789abcdef0123456789');
    expect(auditCall?.metadata).toContain('[redacted-email]');
    expect(auditCall?.metadata).toContain('[redacted-token]');
  });

  it('redacts SQL dollar-quoted literals and token-shaped values in audit previews', async () => {
    vi.stubEnv('OPENLANDER_MASTER_KEY', '0'.repeat(64));
    _resetCachedKey();
    const pg = service({ id: 'svc-pg' });
    const encrypted = encrypt('reader-secret');
    const exec = vi.fn().mockResolvedValue({
      exitCode: 0,
      stdout: '[{\"ok\":true}]',
      stderr: '',
    });
    const insertActivityLog = vi.fn().mockResolvedValue({});
    const appCtx = context({
      db: {
        getService: vi.fn().mockResolvedValue(pg),
        getDataSourceAccess: vi.fn().mockResolvedValue({
          project_id: 'p1',
          service_id: 'svc-pg',
          mode: 'read',
          reader_username: 'ol_reader_test',
          reader_password_encrypted: encrypted.encrypted,
          reader_password_iv: encrypted.iv,
        }),
        insertActivityLog,
      },
      serviceManager: { exec },
    } as Partial<AppContext>);

    const result = await readDataSource(appCtx, 'svc-pg', {
      operation: 'sql.query',
      query: 'SELECT $$sk_live_secret$$ as token, $$Bearer abcdefghijklmnop$$ as bearer',
    });

    expect(result).toEqual(expect.objectContaining({ status: 'ok' }));
    const auditCall = insertActivityLog.mock.calls[0]?.[0] as { metadata?: string } | undefined;
    expect(auditCall?.metadata).toBeDefined();
    expect(auditCall?.metadata).not.toContain('sk_live_secret');
    expect(auditCall?.metadata).not.toContain('abcdefghijklmnop');
    expect(auditCall?.metadata).toContain('[redacted]');
  });
});
