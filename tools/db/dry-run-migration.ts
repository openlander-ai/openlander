#!/usr/bin/env node
/**
 * Dry-run migration tool — applies the full migration sequence (including
 * 0012) against a COPY of a target SQLite database file and reports
 * pass/fail with details. NEVER mutates the source DB.
 *
 * Usage:
 *   tsx tools/db/dry-run-migration.ts [<dbPath>]
 *   tsx tools/db/dry-run-migration.ts ~/.openlander/openlander.db
 *
 * Defaults:
 *   - Source: $HOME/.openlander/openlander.db (the dogfood DB).
 *   - Copy:   /tmp/dryrun-<timestamp>.db
 *
 * Exit codes:
 *   0   — dry-run PASS (FK check clean, audit row counts match, column
 *         shape matches expected post-0012 layout).
 *   1   — dry-run FAIL (any of the above did not match).
 *
 * Plan §"PR 5 dry-run tool".
 */
import { copyFileSync, existsSync, unlinkSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { createDrizzleDatabase } from '../../src/db/drizzle.js';

interface ColumnInfo {
  name: string;
}

const EXPECTED_PROJECTS_COLUMNS = [
  'id',
  'name',
  'repo_url',
  'branch',
  'archived_at',
  'created_at',
  'updated_at',
  'server_id',
  'deploy_lock_session',
  'deploy_lock_at',
];

const EXPECTED_AUDIT_COUNTS_BY_KIND: Record<string, number> = {
  '0012-column-dropped': 31, // 25 projects + 6 services
  '0012-fk-repointed': 6,
  '0012-unique-rebuilt': 5,
  '0012-index-repointed': 3,
};

const FK_REPOINT_TABLES = [
  'environments',
  'deploy_configs',
  'deploy_logs',
  'domain_mappings',
  'runtime_incidents',
  'service_ops_overrides',
];

interface DryRunReport {
  pass: boolean;
  details: string[];
}

function defaultDbPath(): string {
  return path.join(homedir(), '.openlander', 'openlander.db');
}

function copyToTmp(srcPath: string): string {
  const tsv = new Date().toISOString().replace(/[:.]/g, '-');
  const dst = path.join(tmpdir(), `dryrun-${tsv}.db`);
  copyFileSync(srcPath, dst);
  return dst;
}

function getColumns(sqlite: ReturnType<typeof createDrizzleDatabase>['sqlite'], table: string): string[] {
  return (sqlite.prepare(`PRAGMA table_info('${table}')`).all() as ColumnInfo[]).map((c) => c.name);
}

function checkProjectsShape(sqlite: ReturnType<typeof createDrizzleDatabase>['sqlite']): string[] {
  const cols = new Set(getColumns(sqlite, 'projects'));
  const issues: string[] = [];
  for (const expected of EXPECTED_PROJECTS_COLUMNS) {
    if (!cols.has(expected)) issues.push(`projects: missing expected column ${expected}`);
  }
  for (const present of cols) {
    if (!EXPECTED_PROJECTS_COLUMNS.includes(present)) {
      issues.push(`projects: unexpected post-0012 column ${present}`);
    }
  }
  return issues;
}

function checkServicesDroppedColumns(sqlite: ReturnType<typeof createDrizzleDatabase>['sqlite']): string[] {
  const cols = new Set(getColumns(sqlite, 'services'));
  const dropped = ['type', 'image', 'port', 'env_vars', 'deploy_lock_session', 'deploy_lock_at'];
  return dropped
    .filter((c) => cols.has(c))
    .map((c) => `services: column ${c} not dropped (expected dropped in Phase C)`);
}

function checkFkTargets(
  sqlite: ReturnType<typeof createDrizzleDatabase>['sqlite'],
): string[] {
  // PRAGMA foreign_key_list returns rows of {id, seq, table, from, to, ...}
  const issues: string[] = [];
  for (const tbl of FK_REPOINT_TABLES) {
    const rows = sqlite.prepare(`PRAGMA foreign_key_list('${tbl}')`).all() as Array<{
      table: string;
      from: string;
    }>;
    const projectsFk = rows.find((r) => r.table === 'projects');
    const servicesFk = rows.find((r) => r.table === 'services');
    if (projectsFk) {
      issues.push(`${tbl}: still has FK to projects(${projectsFk.from}) — expected dropped`);
    }
    if (!servicesFk) {
      issues.push(`${tbl}: missing FK to services(*) — expected post-0012`);
    }
  }
  return issues;
}

function checkAuditRows(
  sqlite: ReturnType<typeof createDrizzleDatabase>['sqlite'],
): string[] {
  const issues: string[] = [];
  for (const [kind, expected] of Object.entries(EXPECTED_AUDIT_COUNTS_BY_KIND)) {
    const row = sqlite
      .prepare('SELECT COUNT(*) AS cnt FROM migration_0009_audit WHERE kind = ?')
      .get(kind) as { cnt: number } | undefined;
    const actual = row?.cnt ?? 0;
    if (actual !== expected) {
      issues.push(`audit: kind='${kind}' count = ${String(actual)} (expected ${String(expected)})`);
    }
  }
  return issues;
}

function runDryRun(srcDbPath: string): DryRunReport {
  const details: string[] = [];

  if (!existsSync(srcDbPath)) {
    return { pass: false, details: [`source DB not found: ${srcDbPath}`] };
  }

  const tmpPath = copyToTmp(srcDbPath);
  details.push(`copied: ${srcDbPath} -> ${tmpPath}`);

  let pass = true;
  try {
    const { sqlite, db } = createDrizzleDatabase(tmpPath);

    sqlite.exec('PRAGMA foreign_keys = OFF');
    try {
      migrate(db as Parameters<typeof migrate>[0], {
        migrationsFolder: path.resolve(process.cwd(), 'drizzle'),
      });
    } finally {
      sqlite.exec('PRAGMA foreign_keys = ON');
    }

    const violations = sqlite.pragma('foreign_key_check') as unknown[];
    if (violations.length > 0) {
      pass = false;
      details.push(`FAIL: foreign_key_check returned ${String(violations.length)} violations`);
    } else {
      details.push('PASS: foreign_key_check clean');
    }

    const projShape = checkProjectsShape(sqlite);
    if (projShape.length > 0) {
      pass = false;
      details.push(...projShape.map((s) => `FAIL: ${s}`));
    } else {
      details.push('PASS: projects has expected 10 columns');
    }

    const svcDropped = checkServicesDroppedColumns(sqlite);
    if (svcDropped.length > 0) {
      pass = false;
      details.push(...svcDropped.map((s) => `FAIL: ${s}`));
    } else {
      details.push('PASS: services dropped 6 legacy columns');
    }

    const fkIssues = checkFkTargets(sqlite);
    if (fkIssues.length > 0) {
      pass = false;
      details.push(...fkIssues.map((s) => `FAIL: ${s}`));
    } else {
      details.push('PASS: 6 per-deployable FKs target services(id)');
    }

    const auditIssues = checkAuditRows(sqlite);
    if (auditIssues.length > 0) {
      pass = false;
      details.push(...auditIssues.map((s) => `FAIL: ${s}`));
    } else {
      details.push('PASS: 45 audit rows present (31 column-dropped + 6 fk + 5 unique + 3 index)');
    }

    sqlite.close();
  } catch (err) {
    pass = false;
    details.push(`FAIL: migration threw ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    try {
      unlinkSync(tmpPath);
      details.push(`cleaned up: ${tmpPath}`);
    } catch {
      // best-effort cleanup
    }
  }

  return { pass, details };
}

function main(): void {
  const argDb = process.argv[2];
  const srcDbPath = argDb ?? defaultDbPath();
  // eslint-disable-next-line no-console
  console.log(`[dry-run-migration] source: ${srcDbPath}`);
  const { pass, details } = runDryRun(srcDbPath);
  for (const line of details) {
    // eslint-disable-next-line no-console
    console.log(`  ${line}`);
  }
  // eslint-disable-next-line no-console
  console.log(`[dry-run-migration] verdict: ${pass ? 'PASS' : 'FAIL'}`);
  process.exit(pass ? 0 : 1);
}

const invokedDirectly =
  import.meta.url === `file://${process.argv[1] ?? ''}` ||
  import.meta.url.endsWith('/dry-run-migration.ts');
if (invokedDirectly) {
  main();
}

export { runDryRun };
