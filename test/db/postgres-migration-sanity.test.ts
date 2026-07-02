import { existsSync, readFileSync } from 'node:fs';
import postgres from 'postgres';
import { describe, expect, it } from 'vitest';

import { assertV01BaselineCompatible, Database } from '../../src/db/index.js';
import type { PostgresClient } from '../../src/db/drizzle.js';
import {
  DRIZZLE_DIR,
  activeMigrationSqlFiles,
  migrationSqlPath,
  quotedIdentifiers,
  readMigrationJournal,
  readMigrationSqlInJournalOrder,
  splitMigrationStatements,
  staticTableShapeFromSql,
  type StaticTableShape,
} from './postgres-migration-helpers.js';

interface FakeMigrationTable {
  schema: string;
  name: string;
  rowCount: number;
}

interface FakePostgresState {
  legacyMigrationAudit?: boolean;
  legacyProjectsRepoUrl?: boolean;
  migrationTables?: FakeMigrationTable[];
}

function quotedIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function createFakePostgresClient(state: FakePostgresState): PostgresClient {
  const unsafe = async (sql: string, params: unknown[] = []): Promise<unknown[]> => {
    if (sql.includes('to_regclass')) {
      return [
        {
          exists:
            params[0] === 'public.migration_0009_audit' && state.legacyMigrationAudit === true,
        },
      ];
    }

    if (sql.includes('information_schema.columns')) {
      return [
        {
          exists:
            params[0] === 'public' &&
            params[1] === 'projects' &&
            params[2] === 'repo_url' &&
            state.legacyProjectsRepoUrl === true,
        },
      ];
    }

    if (sql.includes('__drizzle_migrations') && sql.includes('pg_attribute')) {
      return (state.migrationTables ?? []).map((table) => ({
        schema: table.schema,
        name: table.name,
      }));
    }

    if (sql.includes('COUNT(*)::integer')) {
      const table = (state.migrationTables ?? []).find((candidate) =>
        sql.includes(`${quotedIdentifier(candidate.schema)}.${quotedIdentifier(candidate.name)}`),
      );
      return [{ count: table?.rowCount ?? 0 }];
    }

    throw new Error(`Unexpected fake SQL: ${sql}`);
  };

  return { unsafe } as unknown as PostgresClient;
}

const databaseUrl = process.env.OPENLANDER_DATABASE_URL ?? process.env.DATABASE_URL ?? '';
const describeWithDatabase = databaseUrl ? describe : describe.skip;

function quotePgIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function postgresMaintenanceUrl(url: string): string {
  const parsed = new URL(url);
  parsed.pathname = '/postgres';
  return parsed.toString();
}

async function withIsolatedPostgresDatabase(
  label: string,
  fn: (url: string) => Promise<void>,
): Promise<void> {
  const dbName = `ol_${label}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const admin = postgres(postgresMaintenanceUrl(databaseUrl), { max: 1, prepare: false });
  const quotedDbName = quotePgIdentifier(dbName);

  try {
    await admin.unsafe(`CREATE DATABASE ${quotedDbName}`);
    const isolatedUrl = new URL(databaseUrl);
    isolatedUrl.pathname = `/${dbName}`;
    await fn(isolatedUrl.toString());
  } finally {
    await admin.unsafe(`DROP DATABASE IF EXISTS ${quotedDbName} WITH (FORCE)`).catch(async () => {
      await admin.unsafe(`DROP DATABASE IF EXISTS ${quotedDbName}`);
    });
    await admin.end({ timeout: 5 });
  }
}

const SQLITE_ONLY_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: 'PRAGMA', pattern: /\bPRAGMA\b/i },
  { label: 'sqlite_master', pattern: /\bsqlite_master\b/i },
  { label: 'AUTOINCREMENT', pattern: /\bAUTOINCREMENT\b/i },
  { label: 'INSERT OR IGNORE/REPLACE', pattern: /\bINSERT\s+OR\s+(?:IGNORE|REPLACE)\b/i },
  { label: 'WITHOUT ROWID', pattern: /\bWITHOUT\s+ROWID\b/i },
  { label: 'SQLite datetime()', pattern: /\bdatetime\s*\(/i },
  { label: 'SQLite strftime()', pattern: /\bstrftime\s*\(/i },
  { label: 'SQLite json_extract()', pattern: /\bjson_extract\s*\(/i },
  { label: 'SQLite RAISE()', pattern: /\bRAISE\s*\(/i },
  { label: 'backtick identifier quoting', pattern: /`[^`]+`/ },
];

function validateForeignKeys(sql: string, tables: StaticTableShape): string[] {
  const failures: string[] = [];
  const fkPattern =
    /ALTER TABLE\s+"([^"]+)"\s+ADD CONSTRAINT\s+"([^"]+)"\s+FOREIGN KEY\s+\(([^)]*)\)\s+REFERENCES\s+(?:"public"\.)?"([^"]+)"\s*\(([^)]*)\)/gi;

  for (const match of sql.matchAll(fkPattern)) {
    const sourceTable = match[1]!;
    const constraintName = match[2]!;
    const sourceColumns = quotedIdentifiers(match[3]!);
    const targetTable = match[4]!;
    const targetColumns = quotedIdentifiers(match[5]!);

    validateKnownColumns(tables, failures, constraintName, sourceTable, sourceColumns);
    validateKnownColumns(tables, failures, constraintName, targetTable, targetColumns);
  }

  return failures;
}

function validateIndexes(sql: string, tables: StaticTableShape): string[] {
  const failures: string[] = [];
  const indexPattern =
    /CREATE\s+(?:UNIQUE\s+)?INDEX\s+"([^"]+)"\s+ON\s+"([^"]+)"\s+USING\s+\w+\s+\(([^;]*)\);/gi;

  for (const match of sql.matchAll(indexPattern)) {
    const indexName = match[1]!;
    const tableName = match[2]!;
    const columnsSegment = match[3]!;
    const columns = quotedIdentifiers(columnsSegment);

    // Expression indexes can contain quoted identifiers inside expressions.
    // This gate validates plain column-list indexes generated by Drizzle.
    const nonIdentifierText = columnsSegment.replace(/"[^"]+"/g, '').replace(/[,\s]/g, '');
    if (nonIdentifierText.length > 0) {
      continue;
    }

    validateKnownColumns(tables, failures, indexName, tableName, columns);
  }

  return failures;
}

function validateKnownColumns(
  tables: StaticTableShape,
  failures: string[],
  objectName: string,
  tableName: string,
  columnNames: string[],
): void {
  const tableColumns = tables.get(tableName);
  if (!tableColumns) {
    failures.push(`${objectName}: table '${tableName}' is not created by active migrations`);
    return;
  }

  for (const columnName of columnNames) {
    if (!tableColumns.has(columnName)) {
      failures.push(`${objectName}: column '${tableName}.${columnName}' is not created`);
    }
  }
}

describe('Postgres migration sanity gate', () => {
  it('uses a Postgres Drizzle journal and every active SQL file is journaled', () => {
    const journal = readMigrationJournal();
    const expectedSqlFiles = journal.entries.map((entry) => `${entry.tag}.sql`).sort();

    expect(journal.dialect).toBe('postgresql');
    expect(journal.entries.length).toBeGreaterThan(0);
    expect(journal.entries.map((entry) => entry.idx)).toEqual(
      journal.entries.map((_, index) => index),
    );
    expect(activeMigrationSqlFiles()).toEqual(expectedSqlFiles);

    for (const entry of journal.entries) {
      expect(existsSync(migrationSqlPath(entry.tag))).toBe(true);
      expect(entry.breakpoints).toBe(true);
    }
  });

  it('contains only Postgres migration SQL, with no archived SQLite syntax in active files', () => {
    const failures: string[] = [];

    for (const fileName of activeMigrationSqlFiles()) {
      const sql = readFileSync(`${DRIZZLE_DIR}/${fileName}`, 'utf8');
      for (const { label, pattern } of SQLITE_ONLY_PATTERNS) {
        if (pattern.test(sql)) {
          failures.push(`${fileName}: contains ${label}`);
        }
      }
    }

    expect(failures).toEqual([]);
  });

  it('keeps migration statements split on Drizzle breakpoints with semicolon terminators', () => {
    const failures: string[] = [];

    for (const fileName of activeMigrationSqlFiles()) {
      const sql = readFileSync(`${DRIZZLE_DIR}/${fileName}`, 'utf8');
      const statements = splitMigrationStatements(sql);

      if (statements.length === 0) {
        failures.push(`${fileName}: contains no statements`);
      }

      statements.forEach((statement, index) => {
        if (!statement.endsWith(';')) {
          failures.push(`${fileName}: statement ${index + 1} is missing a semicolon`);
        }
      });
    }

    expect(failures).toEqual([]);
  });

  it('does not reference missing tables or columns from migration FKs and indexes', () => {
    const sql = readMigrationSqlInJournalOrder();
    const tables = staticTableShapeFromSql(sql);
    const failures = [...validateForeignKeys(sql, tables), ...validateIndexes(sql, tables)];

    expect(failures).toEqual([]);
  });

  it('keeps v0.1 baseline first and applies post-baseline env-scope migrations', () => {
    const journal = readMigrationJournal();
    const sql = readMigrationSqlInJournalOrder();

    expect(journal.entries.map((entry) => entry.tag)).toEqual([
      '0000_v0_1_initial',
      '0001_env_var_scope',
      '0002_representative_traffic',
      '0003_ai_ops_usage_foundation',
      '0004_ai_ops_policy_dedupe',
      '0005_ai_ops_briefings',
      '0006_ai_ops_summary_metadata',
      '0007_pat_service_scope',
      '0008_ai_ops_pending_inputs',
      '0009_data_source_access',
    ]);
    expect(activeMigrationSqlFiles()).toEqual([
      '0000_v0_1_initial.sql',
      '0001_env_var_scope.sql',
      '0002_representative_traffic.sql',
      '0003_ai_ops_usage_foundation.sql',
      '0004_ai_ops_policy_dedupe.sql',
      '0005_ai_ops_briefings.sql',
      '0006_ai_ops_summary_metadata.sql',
      '0007_pat_service_scope.sql',
      '0008_ai_ops_pending_inputs.sql',
      '0009_data_source_access.sql',
    ]);
    expect(sql).toContain('CREATE TABLE "pat_tokens"');
    expect(sql).toContain('"active_scope_project_id" text');
    expect(sql).toContain('"scope_service_id" text');
    expect(sql).toContain('CONSTRAINT "pat_tokens_scope_kind_check"');
    expect(sql).toContain('CONSTRAINT "pat_tokens_scope_project_check"');
    expect(sql).toContain('CREATE INDEX "idx_pat_tokens_scope_service"');
    expect(sql).toContain('CREATE TABLE "ai_ops_pending_inputs"');
    expect(sql).toContain('CONSTRAINT "ai_ops_pending_inputs_status_check"');
    expect(sql).toContain('CREATE UNIQUE INDEX "ai_ops_pending_inputs_active_unique"');
    expect(sql).toContain('CREATE TABLE "data_source_access"');
    expect(sql).toContain('CONSTRAINT "data_source_access_mode_check"');
    expect(sql).toContain('CREATE UNIQUE INDEX "data_source_access_project_service_idx"');
    expect(sql).toContain('CREATE TABLE "domain_mappings"');
    expect(sql).toContain('"target_port" integer');
    expect(sql).toContain('CONSTRAINT "domain_mappings_path_prefix_check"');
    expect(sql).toContain('CONSTRAINT "domain_mappings_target_port_check"');
    expect(sql).toContain('CREATE UNIQUE INDEX "env_vars_service_environment_key_unique"');
    expect(sql).toContain('CREATE UNIQUE INDEX "env_vars_project_environment_key_unique"');
    expect(sql).toContain('"representative_traffic_json" text');
    expect(sql).toContain('"service_id" text');
    expect(sql).toContain('"feature" text');
    expect(sql).toContain('"briefing_id" text');
    expect(sql).toContain('CREATE TABLE "ai_ops_project_policies"');
    expect(sql).toContain('"mode" text DEFAULT \'off\' NOT NULL');
    expect(sql).toContain('CREATE TABLE "ai_ops_service_overrides"');
    expect(sql).toContain('"mode" text DEFAULT \'inherit\' NOT NULL');
    expect(sql).toContain('CREATE TABLE "ai_ops_dedupe"');
    expect(sql).toContain('CREATE UNIQUE INDEX "ai_ops_dedupe_key_unique"');
    expect(sql).toContain('CREATE TABLE "ai_ops_briefings"');
    expect(sql).toContain('"deterministic_summary" text NOT NULL');
    expect(sql).toContain('"llm_summary" text');
    expect(sql).toContain('"llm_summary_status" text');
    expect(sql).toContain('"llm_summary_finish_reason" text');
    expect(sql).toContain('"llm_summary_truncated" boolean');
    expect(sql).toContain('"llm_summary_error" text');
    expect(sql).toContain('"llm_summary_usage_json" text');
    expect(sql).toContain('CREATE INDEX "idx_ai_ops_briefings_project"');
  });

  it('allows a fresh database or already-applied public migration rows', async () => {
    await expect(
      assertV01BaselineCompatible(createFakePostgresClient({})),
    ).resolves.toBeUndefined();
    await expect(
      assertV01BaselineCompatible(
        createFakePostgresClient({
          migrationTables: [{ schema: 'drizzle', name: '__drizzle_migrations', rowCount: 1 }],
        }),
      ),
    ).resolves.toBeUndefined();
    await expect(
      assertV01BaselineCompatible(
        createFakePostgresClient({
          migrationTables: [{ schema: 'drizzle', name: '__drizzle_migrations', rowCount: 2 }],
        }),
      ),
    ).resolves.toBeUndefined();
    await expect(
      assertV01BaselineCompatible(
        createFakePostgresClient({
          migrationTables: [{ schema: 'drizzle', name: '__drizzle_migrations', rowCount: 3 }],
        }),
      ),
    ).resolves.toBeUndefined();
    await expect(
      assertV01BaselineCompatible(
        createFakePostgresClient({
          migrationTables: [{ schema: 'drizzle', name: '__drizzle_migrations', rowCount: 4 }],
        }),
      ),
    ).resolves.toBeUndefined();
    await expect(
      assertV01BaselineCompatible(
        createFakePostgresClient({
          migrationTables: [{ schema: 'drizzle', name: '__drizzle_migrations', rowCount: 5 }],
        }),
      ),
    ).resolves.toBeUndefined();
    await expect(
      assertV01BaselineCompatible(
        createFakePostgresClient({
          migrationTables: [{ schema: 'drizzle', name: '__drizzle_migrations', rowCount: 6 }],
        }),
      ),
    ).resolves.toBeUndefined();
    await expect(
      assertV01BaselineCompatible(
        createFakePostgresClient({
          migrationTables: [{ schema: 'drizzle', name: '__drizzle_migrations', rowCount: 7 }],
        }),
      ),
    ).resolves.toBeUndefined();
    await expect(
      assertV01BaselineCompatible(
        createFakePostgresClient({
          migrationTables: [{ schema: 'drizzle', name: '__drizzle_migrations', rowCount: 8 }],
        }),
      ),
    ).resolves.toBeUndefined();
    await expect(
      assertV01BaselineCompatible(
        createFakePostgresClient({
          migrationTables: [{ schema: 'drizzle', name: '__drizzle_migrations', rowCount: 9 }],
        }),
      ),
    ).resolves.toBeUndefined();
  });

  it.each([
    ['legacy migration audit table', { legacyMigrationAudit: true } satisfies FakePostgresState],
    ['legacy project runtime columns', { legacyProjectsRepoUrl: true } satisfies FakePostgresState],
    [
      'custom-schema drizzle migration history',
      {
        migrationTables: [{ schema: 'custom_migrations', name: 'openlander_history', rowCount: 2 }],
      } satisfies FakePostgresState,
    ],
    [
      'public-schema drizzle migration history',
      {
        migrationTables: [{ schema: 'public', name: '__drizzle_migrations', rowCount: 2 }],
      } satisfies FakePostgresState,
    ],
    [
      'future unknown public migration count',
      {
        migrationTables: [{ schema: 'drizzle', name: '__drizzle_migrations', rowCount: 11 }],
      } satisfies FakePostgresState,
    ],
  ])('fails fast on pre-0.1 migration histories: %s', async (_label, state) => {
    await expect(
      assertV01BaselineCompatible(createFakePostgresClient(state)),
    ).rejects.toMatchObject({
      code: 'DATABASE_BASELINE_RESET_REQUIRED',
      statusCode: 500,
    });
  });
});

describeWithDatabase('Postgres baseline guard integration', () => {
  it('boots a fresh isolated Postgres database under the v0.1 baseline', async () => {
    await withIsolatedPostgresDatabase('fresh_baseline', async (url) => {
      const db = await Database.connect(url);
      await db.close();

      const sql = postgres(url, { max: 1, prepare: false });
      try {
        const rows = (await sql.unsafe(
          'SELECT COUNT(*)::integer AS "count" FROM drizzle.__drizzle_migrations',
        )) as ReadonlyArray<{ count: number }>;
        expect(rows[0]?.count).toBe(readMigrationJournal().entries.length);
        await expect(sql.unsafe('SELECT 1 FROM domain_mappings LIMIT 1')).resolves.toBeDefined();
      } finally {
        await sql.end({ timeout: 5 });
      }
    });
  });

  it('detects custom-named Drizzle migration history tables by shape', async () => {
    await withIsolatedPostgresDatabase('custom_history', async (url) => {
      const sql = postgres(url, { max: 1, prepare: false });
      try {
        await sql.unsafe('CREATE SCHEMA custom_migrations');
        await sql.unsafe(`
          CREATE TABLE custom_migrations.openlander_history (
            id SERIAL PRIMARY KEY,
            hash text NOT NULL,
            created_at bigint
          )
        `);
        await sql.unsafe(`
          INSERT INTO custom_migrations.openlander_history (hash, created_at)
          VALUES ('legacy-0001', 1), ('legacy-0002', 2)
        `);

        await expect(assertV01BaselineCompatible(sql)).rejects.toMatchObject({
          code: 'DATABASE_BASELINE_RESET_REQUIRED',
          statusCode: 500,
          details: {
            drizzleMigrationCount: 2,
            migrationTables: [
              { schema: 'custom_migrations', name: 'openlander_history', rowCount: 2 },
            ],
          },
        });
      } finally {
        await sql.end({ timeout: 5 });
      }
    });
  });
});
