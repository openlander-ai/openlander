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
      '0010_git_credentials',
      '0011_service_runtime_role',
      '0012_resolve_one_shot_service_down_incidents',
      '0013_delivery_workspace',
      '0014_delivery_evidence_hardening',
      '0015_engagement_portfolio',
      '0016_agent_delivery_interface',
      '0017_release_promotion_reporting',
      '0018_release_promotion_quality',
      '0019_release-hard-delete-cascade',
      '0020_delivery-deploy-link-hard-delete-cascade',
      '0021_project-manifest-state',
      '0022_receipt-hard-delete-cascade',
      '0023_delivery_review_packages',
      '0024_project_updates',
      '0025_cloudflare_connected_publish',
      '0026_auth_sessions',
      '0027_absent_robin_chapel',
      '0028_lethal_penance',
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
      '0010_git_credentials.sql',
      '0011_service_runtime_role.sql',
      '0012_resolve_one_shot_service_down_incidents.sql',
      '0013_delivery_workspace.sql',
      '0014_delivery_evidence_hardening.sql',
      '0015_engagement_portfolio.sql',
      '0016_agent_delivery_interface.sql',
      '0017_release_promotion_reporting.sql',
      '0018_release_promotion_quality.sql',
      '0019_release-hard-delete-cascade.sql',
      '0020_delivery-deploy-link-hard-delete-cascade.sql',
      '0021_project-manifest-state.sql',
      '0022_receipt-hard-delete-cascade.sql',
      '0023_delivery_review_packages.sql',
      '0024_project_updates.sql',
      '0025_cloudflare_connected_publish.sql',
      '0026_auth_sessions.sql',
      '0027_absent_robin_chapel.sql',
      '0028_lethal_penance.sql',
    ]);
    expect(sql).toContain('CREATE TABLE "pat_tokens"');
    expect(sql).toContain('CREATE TABLE "auth_sessions"');
    expect(sql).toContain('ADD COLUMN "token_encrypted" text');
    expect(sql).toContain('ADD COLUMN "token_encrypted_iv" text');
    expect(sql).toContain('ADD COLUMN "access_code_encrypted" text');
    expect(sql).toContain('ADD COLUMN "access_code_encrypted_iv" text');
    expect(sql).toContain("'mongo', 'neo4j', 'minio'");
    expect(sql).toContain('INSERT INTO "auth_sessions" ("token", "created_at", "expires_at")');
    expect(sql).toContain('"active_scope_project_id" text');
    expect(sql).toContain('"scope_service_id" text');
    expect(sql).toContain('CONSTRAINT "pat_tokens_scope_kind_check"');
    expect(sql).toContain('"service"."runtime_role" = \'job\'');
    expect(sql).toContain('"incident"."category" = \'service_down\'');
    expect(sql).toContain('CREATE TABLE "deliveries"');
    expect(sql).toContain('CREATE TABLE "delivery_receipts"');
    expect(sql).toContain(
      'FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE cascade',
    );
    expect(sql).toContain('CREATE TABLE "delivery_idempotency_records"');
    expect(sql).toContain('CREATE TABLE "engagements"');
    expect(sql).toContain('CREATE TABLE "engagement_projects"');
    expect(sql).toContain('CREATE TABLE "application_operation_invocations"');
    expect(sql).toContain('CREATE TABLE "project_manifest_states"');
    expect(sql).toContain('CREATE TABLE "delivery_agent_runs"');
    expect(sql).toContain('CREATE TABLE "delivery_agent_run_events"');
    expect(sql).toContain('CREATE TABLE "delivery_run_checks"');
    expect(sql).toContain('CREATE TABLE "delivery_review_packages"');
    expect(sql).toContain('CREATE TABLE "delivery_review_package_items"');
    expect(sql).toContain('CREATE TABLE "project_updates"');
    expect(sql).toContain('CREATE TABLE "project_update_items"');
    expect(sql).toContain('CREATE TABLE "delivery_project_update_items"');
    expect(sql).toContain('ADD COLUMN "review_package_id" text');
    expect(sql).toContain('ADD COLUMN "health_timeout_seconds" integer DEFAULT 30 NOT NULL');
    expect(sql).toContain('ADD COLUMN "smoke_path" text');
    expect(sql).toContain('ADD COLUMN "soak_seconds" integer DEFAULT 0 NOT NULL');
    expect(sql).toContain('"auto_finalize" boolean');
    expect(sql).toContain('UPDATE "deliveries" SET "auto_finalize" = false');
    expect(sql).toContain('CREATE UNIQUE INDEX "delivery_agent_runs_active_unique"');
    expect(sql).toContain('CREATE TABLE "project_environments"');
    expect(sql).toContain('CREATE TABLE "releases"');
    expect(sql).toContain('CREATE TABLE "release_artifacts"');
    expect(sql).toContain('CREATE TABLE "release_promotions"');
    expect(sql).toContain('CREATE TABLE "engagement_weekly_reports"');
    expect(sql).toContain('UPDATE "environments" AS "environment"');
    expect(sql).toContain('"project_id" text PRIMARY KEY NOT NULL');
    expect(sql).toContain('CONSTRAINT "engagements_status_check"');
    expect(sql).toContain('"evidence_version" integer DEFAULT 0 NOT NULL');
    expect(sql).toContain('CONSTRAINT "deliveries_status_check"');
    expect(sql).toContain('CONSTRAINT "pat_tokens_scope_project_check"');
    expect(sql).toContain('CREATE INDEX "idx_pat_tokens_scope_service"');
    expect(sql).toContain('CREATE TABLE "ai_ops_pending_inputs"');
    expect(sql).toContain('CONSTRAINT "ai_ops_pending_inputs_status_check"');
    expect(sql).toContain('CREATE UNIQUE INDEX "ai_ops_pending_inputs_active_unique"');
    expect(sql).toContain('CREATE TABLE "data_source_access"');
    expect(sql).toContain('CONSTRAINT "data_source_access_mode_check"');
    expect(sql).toContain('CREATE UNIQUE INDEX "data_source_access_project_service_idx"');
    expect(sql).toContain('CREATE TABLE "git_credentials"');
    expect(sql).toContain('CONSTRAINT "git_credentials_status_check"');
    expect(sql).toContain('ADD COLUMN "git_credential_id" text');
    expect(sql).toContain('CREATE INDEX "idx_services_git_credential"');
    expect(sql).toContain('CREATE TABLE "domain_mappings"');
    expect(sql).toContain('CREATE TABLE "cloudflare_connections"');
    expect(sql).toContain('CREATE TABLE "project_public_access"');
    expect(sql).toContain('CONSTRAINT "project_public_access_status_check"');
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
    await expect(
      assertV01BaselineCompatible(
        createFakePostgresClient({
          migrationTables: [{ schema: 'drizzle', name: '__drizzle_migrations', rowCount: 10 }],
        }),
      ),
    ).resolves.toBeUndefined();
    await expect(
      assertV01BaselineCompatible(
        createFakePostgresClient({
          migrationTables: [{ schema: 'drizzle', name: '__drizzle_migrations', rowCount: 11 }],
        }),
      ),
    ).resolves.toBeUndefined();
    await expect(
      assertV01BaselineCompatible(
        createFakePostgresClient({
          migrationTables: [{ schema: 'drizzle', name: '__drizzle_migrations', rowCount: 12 }],
        }),
      ),
    ).resolves.toBeUndefined();
    await expect(
      assertV01BaselineCompatible(
        createFakePostgresClient({
          migrationTables: [{ schema: 'drizzle', name: '__drizzle_migrations', rowCount: 13 }],
        }),
      ),
    ).resolves.toBeUndefined();
    await expect(
      assertV01BaselineCompatible(
        createFakePostgresClient({
          migrationTables: [{ schema: 'drizzle', name: '__drizzle_migrations', rowCount: 14 }],
        }),
      ),
    ).resolves.toBeUndefined();
    await expect(
      assertV01BaselineCompatible(
        createFakePostgresClient({
          migrationTables: [{ schema: 'drizzle', name: '__drizzle_migrations', rowCount: 15 }],
        }),
      ),
    ).resolves.toBeUndefined();
    await expect(
      assertV01BaselineCompatible(
        createFakePostgresClient({
          migrationTables: [{ schema: 'drizzle', name: '__drizzle_migrations', rowCount: 16 }],
        }),
      ),
    ).resolves.toBeUndefined();
    await expect(
      assertV01BaselineCompatible(
        createFakePostgresClient({
          migrationTables: [{ schema: 'drizzle', name: '__drizzle_migrations', rowCount: 17 }],
        }),
      ),
    ).resolves.toBeUndefined();
    await expect(
      assertV01BaselineCompatible(
        createFakePostgresClient({
          migrationTables: [{ schema: 'drizzle', name: '__drizzle_migrations', rowCount: 19 }],
        }),
      ),
    ).resolves.toBeUndefined();
    await expect(
      assertV01BaselineCompatible(
        createFakePostgresClient({
          migrationTables: [{ schema: 'drizzle', name: '__drizzle_migrations', rowCount: 20 }],
        }),
      ),
    ).resolves.toBeUndefined();
    await expect(
      assertV01BaselineCompatible(
        createFakePostgresClient({
          migrationTables: [{ schema: 'drizzle', name: '__drizzle_migrations', rowCount: 21 }],
        }),
      ),
    ).resolves.toBeUndefined();
    await expect(
      assertV01BaselineCompatible(
        createFakePostgresClient({
          migrationTables: [{ schema: 'drizzle', name: '__drizzle_migrations', rowCount: 22 }],
        }),
      ),
    ).resolves.toBeUndefined();
    await expect(
      assertV01BaselineCompatible(
        createFakePostgresClient({
          migrationTables: [{ schema: 'drizzle', name: '__drizzle_migrations', rowCount: 23 }],
        }),
      ),
    ).resolves.toBeUndefined();
    await expect(
      assertV01BaselineCompatible(
        createFakePostgresClient({
          migrationTables: [{ schema: 'drizzle', name: '__drizzle_migrations', rowCount: 24 }],
        }),
      ),
    ).resolves.toBeUndefined();
    await expect(
      assertV01BaselineCompatible(
        createFakePostgresClient({
          migrationTables: [{ schema: 'drizzle', name: '__drizzle_migrations', rowCount: 25 }],
        }),
      ),
    ).resolves.toBeUndefined();
    await expect(
      assertV01BaselineCompatible(
        createFakePostgresClient({
          migrationTables: [{ schema: 'drizzle', name: '__drizzle_migrations', rowCount: 26 }],
        }),
      ),
    ).resolves.toBeUndefined();
    await expect(
      assertV01BaselineCompatible(
        createFakePostgresClient({
          migrationTables: [{ schema: 'drizzle', name: '__drizzle_migrations', rowCount: 27 }],
        }),
      ),
    ).resolves.toBeUndefined();
    await expect(
      assertV01BaselineCompatible(
        createFakePostgresClient({
          migrationTables: [{ schema: 'drizzle', name: '__drizzle_migrations', rowCount: 28 }],
        }),
      ),
    ).resolves.toBeUndefined();
    await expect(
      assertV01BaselineCompatible(
        createFakePostgresClient({
          migrationTables: [{ schema: 'drizzle', name: '__drizzle_migrations', rowCount: 29 }],
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
        migrationTables: [{ schema: 'drizzle', name: '__drizzle_migrations', rowCount: 30 }],
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
        await expect(sql.unsafe('SELECT 1 FROM project_updates LIMIT 1')).resolves.toBeDefined();
        await expect(
          sql.unsafe('SELECT 1 FROM project_update_items LIMIT 1'),
        ).resolves.toBeDefined();
      } finally {
        await sql.end({ timeout: 5 });
      }
    });
  });

  it('stores independent web sessions and logs out only the requesting browser', async () => {
    await withIsolatedPostgresDatabase('auth_sessions', async (url) => {
      const db = await Database.connect(url);
      try {
        await db.createSession('browser-a', 1_000, 10_000);
        await db.createSession('browser-b', 2_000, 11_000);

        await expect(db.getSession('browser-a')).resolves.toMatchObject({ token: 'browser-a' });
        await expect(db.getSession('browser-b')).resolves.toMatchObject({ token: 'browser-b' });

        await db.deleteSession('browser-a');
        await expect(db.getSession('browser-a')).resolves.toBeNull();
        await expect(db.getSession('browser-b')).resolves.toMatchObject({ token: 'browser-b' });

        await db.deleteAllSessions();
        await expect(db.getSession('browser-b')).resolves.toBeNull();
      } finally {
        await db.close();
      }
    });
  });

  it('preserves the current web session while upgrading to the multi-session table', async () => {
    await withIsolatedPostgresDatabase('auth_session_upgrade', async (url) => {
      const sql = postgres(url, { max: 1, prepare: false });
      try {
        for (const fileName of activeMigrationSqlFiles().filter(
          (file) => file !== '0026_auth_sessions.sql',
        )) {
          const migrationSql = readFileSync(
            migrationSqlPath(fileName.replace(/\.sql$/, '')),
            'utf8',
          );
          for (const statement of splitMigrationStatements(migrationSql)) {
            await sql.unsafe(statement);
          }
        }

        await sql.unsafe(`
          INSERT INTO auth (
            id, password_hash, api_token, session_token, session_created_at, session_expires_at
          ) VALUES (1, 'hash', 'token', 'legacy-browser', 1000, 604801000)
        `);

        const migrationSql = readFileSync(migrationSqlPath('0026_auth_sessions'), 'utf8');
        for (const statement of splitMigrationStatements(migrationSql)) {
          await sql.unsafe(statement);
        }

        const rows = (await sql.unsafe(
          'SELECT token, created_at, expires_at FROM auth_sessions',
        )) as ReadonlyArray<{ token: string; created_at: string; expires_at: string }>;
        expect(rows).toEqual([
          { token: 'legacy-browser', created_at: '1000', expires_at: '604801000' },
        ]);
      } finally {
        await sql.end({ timeout: 5 });
      }
    });
  });

  it('upgrades 0023 data and keeps migrated Project Updates after Activity cleanup', async () => {
    await withIsolatedPostgresDatabase('project_updates_upgrade', async (url) => {
      const sql = postgres(url, { max: 1, prepare: false });
      try {
        for (const fileName of activeMigrationSqlFiles().filter(
          (file) => file !== '0024_project_updates.sql',
        )) {
          const migrationSql = readFileSync(
            migrationSqlPath(fileName.replace(/\.sql$/, '')),
            'utf8',
          );
          for (const statement of splitMigrationStatements(migrationSql)) {
            await sql.unsafe(statement);
          }
        }

        await sql.unsafe(`
          INSERT INTO projects (id, name, display_name)
          VALUES ('project-update-upgrade', 'project-update-upgrade', 'Project Update Upgrade')
        `);
        await sql.unsafe(`
          INSERT INTO deliveries (id, project_id, title, created_by)
          VALUES ('delivery-update-upgrade', 'project-update-upgrade', 'Upgrade Delivery', 'agent-a')
        `);
        await sql.unsafe(`
          INSERT INTO activity_log (
            id, event_type, activity_type, severity, project_id, correlation_id,
            title, description, status, metadata, created_at
          ) VALUES (
            'activity-update-upgrade',
            'project.update_recorded',
            'project_update',
            'warning',
            'project-update-upgrade',
            'delivery-update-upgrade',
            'Project update recorded',
            'Customer meeting identified an SI dependency.',
            'completed',
            '{"delivery_id":"delivery-update-upgrade","source_artifact_ids":["artifact-legacy"],"entries":[{"kind":"dependency","title":"SI API contract","detail":"Waiting for payload and auth details","status":"open"}],"actor":"agent-a"}',
            '2026-07-29T01:00:00.000Z'
          )
        `);
        await sql.unsafe(`
          INSERT INTO activity_log (
            id, event_type, activity_type, severity, project_id, correlation_id,
            title, description, status, metadata, created_at
          ) VALUES
          (
            'activity-update-invalid-metadata',
            'project.update_recorded',
            'project_update',
            'info',
            'project-update-upgrade',
            NULL,
            'Legacy project note',
            '',
            'completed',
            'not-json',
            '2026-07-29T02:00:00.000Z'
          ),
          (
            'activity-update-orphan',
            'project.update_recorded',
            'project_update',
            'info',
            'deleted-project',
            NULL,
            'Orphaned project note',
            'This Project was already deleted.',
            'completed',
            '{}',
            '2026-07-29T03:00:00.000Z'
          )
        `);
        const excessiveLegacySources = Array.from(
          { length: 21 },
          (_, index) => `artifact-legacy-${String(index + 1)}`,
        );
        await sql.unsafe(
          `
            INSERT INTO activity_log (
              id, event_type, activity_type, severity, project_id, correlation_id,
              title, description, status, metadata, created_at
            ) VALUES (
              'activity-update-excessive-sources',
              'project.update_recorded',
              'project_update',
              'info',
              'project-update-upgrade',
              NULL,
              'Legacy update with excessive sources',
              'The migration must stay within the new source limit.',
              'completed',
              $1,
              '2026-07-29T02:30:00.000Z'
            )
          `,
          [JSON.stringify({ source_artifact_ids: excessiveLegacySources })],
        );

        const migrationSql = readFileSync(migrationSqlPath('0024_project_updates'), 'utf8');
        for (const statement of splitMigrationStatements(migrationSql)) {
          await sql.unsafe(statement);
        }

        const updates = (await sql.unsafe(`
          SELECT id, project_id, delivery_id, summary, sources, created_by, occurred_at
          FROM project_updates
        `)) as ReadonlyArray<Record<string, unknown>>;
        expect(updates).toHaveLength(3);
        expect(updates).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: 'pupd_legacy_activity-update-upgrade',
              project_id: 'project-update-upgrade',
              delivery_id: 'delivery-update-upgrade',
              created_by: 'agent-a',
              occurred_at: '2026-07-29T01:00:00.000Z',
            }),
            expect.objectContaining({
              id: 'pupd_legacy_activity-update-invalid-metadata',
              project_id: 'project-update-upgrade',
              summary: 'Legacy project note',
              delivery_id: null,
              created_by: 'legacy-activity',
            }),
          ]),
        );
        const migratedUpdate = updates.find(
          (update) => update['id'] === 'pupd_legacy_activity-update-upgrade',
        );
        expect(migratedUpdate?.['sources']).toEqual([
          {
            source_type: 'other',
            label: 'Legacy Delivery artifact',
            artifact_id: 'artifact-legacy',
          },
        ]);
        const excessiveSourceUpdate = updates.find(
          (update) => update['id'] === 'pupd_legacy_activity-update-excessive-sources',
        );
        expect(excessiveSourceUpdate?.['sources']).toHaveLength(20);
        expect(updates.some((update) => update['project_id'] === 'deleted-project')).toBe(false);
        const items = (await sql.unsafe(`
          SELECT id, kind, title, detail, status
          FROM project_update_items
        `)) as ReadonlyArray<Record<string, unknown>>;
        expect(items).toEqual([
          expect.objectContaining({
            kind: 'dependency',
            title: 'SI API contract',
            status: 'open',
          }),
        ]);

        await sql.unsafe(`DELETE FROM activity_log WHERE id = 'activity-update-upgrade'`);
        const retained = (await sql.unsafe(
          `SELECT COUNT(*)::integer AS count FROM project_updates`,
        )) as ReadonlyArray<{ count: number }>;
        expect(retained[0]?.count).toBe(3);

        await sql.unsafe(`
          INSERT INTO delivery_project_update_items (
            delivery_id, project_update_item_id, item_status, item_updated_at, linked_by
          )
          SELECT 'delivery-update-upgrade', id, status, updated_at, 'agent-a'
          FROM project_update_items
        `);
        await sql.unsafe(`DELETE FROM deliveries WHERE id = 'delivery-update-upgrade'`);
        const deliveryCleanup = (await sql.unsafe(`
          SELECT
            (SELECT delivery_id FROM project_updates WHERE id = 'pupd_legacy_activity-update-upgrade') AS delivery_id,
            (SELECT COUNT(*)::integer FROM delivery_project_update_items) AS link_count
        `)) as ReadonlyArray<{ delivery_id: string | null; link_count: number }>;
        expect(deliveryCleanup[0]).toEqual({ delivery_id: null, link_count: 0 });

        await sql.unsafe(`DELETE FROM projects WHERE id = 'project-update-upgrade'`);
        const projectCleanup = (await sql.unsafe(
          `SELECT COUNT(*)::integer AS count FROM project_updates`,
        )) as ReadonlyArray<{ count: number }>;
        expect(projectCleanup[0]?.count).toBe(0);
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
