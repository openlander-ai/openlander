#!/usr/bin/env node
/**
 * Dry-run migration tool — applies the full migration sequence (including
 * 0012) against a COPY of a target SQLite database file and reports
 * pass/fail with details. NEVER mutates the source DB.
 *
 * Startup-faithful: instantiates the production `Database` class against
 * the copy so the FULL boot path (backup-or-bust → bridgeLegacyDatabase →
 * migrate() → foreign_key_check) runs exactly as it would on real boot.
 * If Phase A asserts ABORT, the constructor throws and we surface the
 * abort message verbatim.
 *
 * WAL-safe copy: uses `VACUUM INTO` instead of `copyFileSync` so the
 * snapshot includes any pages still buffered in the -wal sidecar. A
 * naive copy would risk an inconsistent post-migration state.
 *
 * Usage:
 *   tsx tools/db/dry-run-migration.ts [<dbPath>]
 *   tsx tools/db/dry-run-migration.ts ~/.openlander/openlander.db
 *   tsx tools/db/dry-run-migration.ts /tmp/dogfood-analysis/dogfood.db
 *
 * Defaults:
 *   - Source: $HOME/.openlander/openlander.db (the dogfood DB).
 *   - Copy:   /tmp/dryrun-<timestamp>.db
 *
 * Exit codes:
 *   0   — dry-run PASS (FK check clean, audit row counts match, column
 *         shape matches expected post-0012 layout).
 *   1   — dry-run FAIL (any of the above did not match, or the
 *         constructor threw — i.e. a Phase A ABORT or backup failure).
 *
 * Plan §"PR 5 dry-run tool".
 */
import { existsSync, readdirSync, unlinkSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { createDrizzleDatabase, type SqliteDatabase } from '../../src/db/drizzle.js';
import { Database as OlDatabase } from '../../src/db/index.js';

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

/**
 * WAL-safe DB snapshot via SQLite's `VACUUM INTO`. Plain copyFileSync of
 * the main DB file would miss pages buffered in the -wal sidecar; the
 * resulting copy is potentially inconsistent. VACUUM INTO acquires a
 * read lock, reads ALL pages (main + WAL), and writes a self-contained
 * file atomically.
 *
 * We open the SOURCE DB read-only-by-discipline (better-sqlite3's
 * default open is RW; we issue VACUUM INTO and immediately close so the
 * source is untouched on disk except for the standard read-lock dance).
 */
function vacuumIntoTmp(srcPath: string): string {
  const tsv = new Date().toISOString().replace(/[:.]/g, '-');
  const dst = path.join(tmpdir(), `dryrun-${tsv}.db`);

  // Open the source via the same drizzle wrapper used in production —
  // this engages the same PRAGMA setup (WAL mode, etc.) so the VACUUM
  // INTO sees the same on-disk state the runtime would.
  const { sqlite } = createDrizzleDatabase(srcPath);
  try {
    const escapedDst = dst.replace(/'/g, "''");
    sqlite.exec(`VACUUM INTO '${escapedDst}'`);
  } finally {
    sqlite.close();
  }
  return dst;
}

function getColumns(sqlite: SqliteDatabase, table: string): string[] {
  return (sqlite.prepare(`PRAGMA table_info('${table}')`).all() as ColumnInfo[]).map((c) => c.name);
}

function checkProjectsShape(sqlite: SqliteDatabase): string[] {
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

function checkServicesDroppedColumns(sqlite: SqliteDatabase): string[] {
  const cols = new Set(getColumns(sqlite, 'services'));
  const dropped = ['type', 'image', 'port', 'env_vars', 'deploy_lock_session', 'deploy_lock_at'];
  return dropped
    .filter((c) => cols.has(c))
    .map((c) => `services: column ${c} not dropped (expected dropped in Phase C)`);
}

function checkFkTargets(sqlite: SqliteDatabase): string[] {
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

function checkAuditRows(sqlite: SqliteDatabase): string[] {
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

function listTables(sqlite: SqliteDatabase): string[] {
  return (
    sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all() as Array<{ name: string }>
  ).map((r) => r.name);
}

function runDryRun(srcDbPath: string): DryRunReport {
  const details: string[] = [];

  if (!existsSync(srcDbPath)) {
    return { pass: false, details: [`source DB not found: ${srcDbPath}`] };
  }

  let tmpPath: string | null = null;
  try {
    tmpPath = vacuumIntoTmp(srcDbPath);
    details.push(`VACUUM INTO copy: ${srcDbPath} -> ${tmpPath}`);
  } catch (err) {
    return {
      pass: false,
      details: [`FAIL: VACUUM INTO copy failed: ${err instanceof Error ? err.message : String(err)}`],
    };
  }

  let pass = true;
  let olDb: OlDatabase | null = null;
  try {
    // Run the FULL production startup path against the copy. The
    // constructor performs:
    //   1. PRAGMA foreign_keys = OFF
    //   2. backupOrBustForMigration0012  (writes <copy>.pre-1.0-a-completion.<ts>.bak)
    //   3. bridgeLegacyDatabase           (legacy env_vars/deploy_logs rebuild + baseline)
    //   4. migrate()                      (runs 0000..0012 inclusive)
    //   5. PRAGMA foreign_keys = ON
    //   6. PRAGMA foreign_key_check       (throws if any orphans)
    // If Phase A's ABORT triggers, migrate() throws with the descriptive
    // message we surface verbatim.
    olDb = new OlDatabase(tmpPath);
    details.push('PASS: Database constructor completed (backup → bridge → migrate → fk_check)');

    // Reach into the same on-disk file to verify post-state. The
    // constructor already ran foreign_key_check; we re-open via drizzle
    // to read PRAGMA + audit data without going through the repos.
    olDb.close();
    olDb = null;
    const { sqlite } = createDrizzleDatabase(tmpPath);
    try {
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
        details.push(`PASS: projects has expected ${String(EXPECTED_PROJECTS_COLUMNS.length)} columns`);
      }

      const svcDropped = checkServicesDroppedColumns(sqlite);
      if (svcDropped.length > 0) {
        pass = false;
        details.push(...svcDropped.map((s) => `FAIL: ${s}`));
      } else {
        details.push('PASS: services dropped 6 legacy columns (type, image, port, env_vars, deploy_lock_session, deploy_lock_at)');
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

      const tables = listTables(sqlite);
      details.push(`tables (${String(tables.length)}): ${tables.join(', ')}`);
      const projCols = getColumns(sqlite, 'projects');
      const svcCols = getColumns(sqlite, 'services');
      details.push(`projects columns (${String(projCols.length)}): ${projCols.join(', ')}`);
      details.push(`services columns (${String(svcCols.length)}): ${svcCols.join(', ')}`);

      const orphanRow = sqlite
        .prepare(
          "SELECT COUNT(*) AS cnt FROM migration_0009_audit WHERE kind = '0012-orphan-cleanup'",
        )
        .get() as { cnt: number } | undefined;
      if ((orphanRow?.cnt ?? 0) > 0) {
        details.push(`PASS: Phase A.0 cleaned up ${String(orphanRow?.cnt ?? 0)} __orphan_managed environment row(s)`);
      } else {
        details.push('PASS: no __orphan_managed cleanup needed (clean DB)');
      }
    } finally {
      sqlite.close();
    }
  } catch (err) {
    pass = false;
    const msg = err instanceof Error ? err.message : String(err);
    details.push(`FAIL: startup-faithful migration threw: ${msg}`);
    if (msg.includes('phase A:')) {
      details.push('  ↑ Phase A pre-flight assertion ABORTed — operator must clean source data before rolling out');
    }
    if (msg.includes('Backup-or-bust')) {
      details.push('  ↑ Backup-or-bust prelude failed — DB unchanged, no migration ran');
    }
  } finally {
    if (olDb !== null) {
      try {
        olDb.close();
      } catch {
        // best-effort
      }
    }
    if (tmpPath !== null) {
      try {
        unlinkSync(tmpPath);
        details.push(`cleaned up: ${tmpPath}`);
      } catch {
        // best-effort cleanup
      }
      // Also clean up the .pre-1.0-a-completion.*.bak sidecar that
      // backup-or-bust writes next to the copy. Best-effort, glob-free.
      // The file path pattern is `${tmpPath}.pre-1.0-a-completion.<ts>.bak`.
      try {
        const dir = path.dirname(tmpPath);
        const base = path.basename(tmpPath);
        const candidates = readdirSync(dir).filter(
          (f) => f.startsWith(`${base}.pre-1.0-a-completion.`) && f.endsWith('.bak'),
        );
        for (const c of candidates) {
          try {
            unlinkSync(path.join(dir, c));
            details.push(`cleaned up backup sidecar: ${c}`);
          } catch {
            // best-effort
          }
        }
      } catch {
        // best-effort
      }
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
