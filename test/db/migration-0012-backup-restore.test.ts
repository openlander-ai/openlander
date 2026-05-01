/**
 * Migration 0012: VACUUM INTO backup is WAL-safe and restorable.
 *
 * Verifies that the VACUUM INTO pattern used by backupOrBustForMigration0012
 * (src/db/index.ts) produces a backup that can be opened, read, and is
 * consistent — i.e. contains all rows that existed before the backup ran,
 * including rows that were written to the WAL but not yet checkpointed.
 *
 * Also verifies end-to-end that the Database constructor creates a .bak
 * file when 0012 is pending, and the backup reflects pre-0012 state.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  mkdtempSync,
  existsSync,
  readdirSync,
  unlinkSync,
  mkdirSync,
  writeFileSync,
  copyFileSync,
  readFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { createDrizzleDatabase } from '../../src/db/drizzle.js';
import { Database as OlDatabase } from '../../src/db/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_FOLDER = path.resolve(__dirname, '..', '..', 'drizzle');

const PRE_0012_TAGS = [
  '0000_initial',
  '0001_env_vars_scoped_uniques',
  '0002_add_server_id',
  '0003_fix_check_constraints',
  '0004_restore_ai_usage_result_check',
  '0005_add_error_fields_to_ai_usage_log',
  '0006_compose_path_and_recovering_watchdog',
  '0007_service_metrics_and_settings',
  '0008_mcp_session_log',
  '0009_split_projects_services',
  '0010_cleanup_compose_child_groups',
  '0011_repoint_deployable_project_ids',
];

function buildPre0012MigrationsFolder(tmpBase: string): string {
  const dir = mkdtempSync(path.join(tmpBase, 'pre0012-'));
  const metaDir = path.join(dir, 'meta');
  mkdirSync(metaDir, { recursive: true });
  for (const tag of PRE_0012_TAGS) {
    copyFileSync(path.join(MIGRATIONS_FOLDER, `${tag}.sql`), path.join(dir, `${tag}.sql`));
  }
  const fullJournal = JSON.parse(
    readFileSync(path.join(MIGRATIONS_FOLDER, 'meta', '_journal.json'), 'utf8'),
  ) as {
    version: string;
    dialect: string;
    entries: { idx: number; version: string; when: number; tag: string; breakpoints: boolean }[];
  };
  writeFileSync(
    path.join(metaDir, '_journal.json'),
    JSON.stringify(
      {
        version: fullJournal.version,
        dialect: fullJournal.dialect,
        entries: fullJournal.entries.filter((e) => e.idx <= 11),
      },
      null,
      2,
    ),
  );
  return dir;
}

function cleanDir(dir: string): void {
  try {
    for (const f of readdirSync(dir)) {
      try { unlinkSync(path.join(dir, f)); } catch (_) { /* ignore */ }
    }
  } catch (_) { /* ignore */ }
}

// =====================================================================
// Group 1: VACUUM INTO semantics (unit-level, no Drizzle dependency)
// =====================================================================
describe('VACUUM INTO: WAL-safe backup semantics', () => {
  let tmpDir: string;
  let dbPath: string;
  let backupPath: string;
  let db: Database.Database;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'ol-backup-unit-'));
    dbPath = path.join(tmpDir, 'test.db');
    backupPath = path.join(tmpDir, 'test.bak');

    db = new Database(dbPath);
    db.exec('PRAGMA journal_mode = WAL');
    db.exec(`
      CREATE TABLE sentinel (id INTEGER PRIMARY KEY, val TEXT NOT NULL);
      INSERT INTO sentinel VALUES (1, 'row-one');
      INSERT INTO sentinel VALUES (2, 'row-two');
    `);
  });

  afterEach(() => {
    try { db.close(); } catch (_) { /* already closed */ }
    cleanDir(tmpDir);
  });

  it('produces a backup file at the specified path', () => {
    const escaped = backupPath.replace(/'/g, "''");
    db.exec(`VACUUM INTO '${escaped}'`);
    expect(existsSync(backupPath)).toBe(true);
  });

  it('backup contains all rows and is openable as a standalone DB', () => {
    const escaped = backupPath.replace(/'/g, "''");
    db.exec(`VACUUM INTO '${escaped}'`);
    db.close();

    const restored = new Database(backupPath);
    try {
      const rows = restored
        .prepare('SELECT id, val FROM sentinel ORDER BY id')
        .all() as Array<{ id: number; val: string }>;
      expect(rows).toHaveLength(2);
      expect(rows[0]).toEqual({ id: 1, val: 'row-one' });
      expect(rows[1]).toEqual({ id: 2, val: 'row-two' });
    } finally {
      restored.close();
    }
  });

  it('backup captures rows written to WAL before explicit checkpoint', () => {
    // Write a third row in a transaction (goes to WAL, may not be in main file yet).
    db.transaction(() => {
      db.prepare("INSERT INTO sentinel VALUES (3, 'wal-row')").run();
    })();

    // VACUUM INTO must capture the WAL page — core WAL-safety assertion.
    const escaped = backupPath.replace(/'/g, "''");
    db.exec(`VACUUM INTO '${escaped}'`);

    const restored = new Database(backupPath);
    try {
      const row = restored
        .prepare("SELECT val FROM sentinel WHERE id = 3")
        .get() as { val: string } | undefined;
      expect(row, 'WAL-buffered row must appear in VACUUM INTO backup').toBeDefined();
      expect(row?.val).toBe('wal-row');
    } finally {
      restored.close();
    }
  });

  it('backup is unaffected by mutations to source DB after VACUUM INTO', () => {
    const escaped = backupPath.replace(/'/g, "''");
    db.exec(`VACUUM INTO '${escaped}'`);

    // Mutate the source after backup
    db.exec("DELETE FROM sentinel WHERE id = 1");

    // Backup must still have both rows
    const restored = new Database(backupPath);
    try {
      const rows = restored.prepare('SELECT COUNT(*) AS cnt FROM sentinel').get() as { cnt: number };
      expect(rows.cnt).toBe(2);
    } finally {
      restored.close();
    }
  });
});

// =====================================================================
// Group 2: End-to-end — Database constructor creates .bak before 0012
// =====================================================================
describe('Database constructor: .bak file created before migrate() runs 0012', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'ol-backup-e2e-'));
  });

  afterEach(() => {
    cleanDir(tmpDir);
  });

  it('creates a .pre-1.0-a-completion.*.bak file when 0012 is pending', () => {
    const dbPath = path.join(tmpDir, 'e2e.db');

    // Seed a pre-0012 DB on disk (0000-0011 only).
    const pre0012Dir = buildPre0012MigrationsFolder(tmpDir);
    const { sqlite: preSqlite, db: preDrizzle } = createDrizzleDatabase(dbPath);
    preSqlite.exec('PRAGMA foreign_keys = OFF');
    try {
      migrate(preDrizzle as Parameters<typeof migrate>[0], { migrationsFolder: pre0012Dir });
    } finally {
      preSqlite.exec('PRAGMA foreign_keys = ON');
      preSqlite.close();
    }

    // Construct OlDatabase — triggers backupOrBustForMigration0012 + full 0012.
    const olDb = new OlDatabase(dbPath);
    olDb.close();

    // Assert a .bak file was created in the same directory as the DB.
    const dbDir = path.dirname(dbPath);
    const bakFiles = readdirSync(dbDir).filter(
      (f) => f.includes('.pre-1.0-a-completion') && f.endsWith('.bak'),
    );
    expect(bakFiles.length, 'backupOrBustForMigration0012 must create a .bak file').toBeGreaterThan(0);
  });

  it('backup file is restorable: opening it yields a valid SQLite DB', () => {
    const dbPath = path.join(tmpDir, 'e2e-restore.db');

    const pre0012Dir = buildPre0012MigrationsFolder(tmpDir);
    const { sqlite: preSqlite, db: preDrizzle } = createDrizzleDatabase(dbPath);
    preSqlite.exec('PRAGMA foreign_keys = OFF');
    try {
      migrate(preDrizzle as Parameters<typeof migrate>[0], { migrationsFolder: pre0012Dir });
    } finally {
      preSqlite.exec('PRAGMA foreign_keys = ON');
      preSqlite.close();
    }

    const olDb = new OlDatabase(dbPath);
    olDb.close();

    const dbDir = path.dirname(dbPath);
    const bakFiles = readdirSync(dbDir).filter(
      (f) => f.includes('.pre-1.0-a-completion') && f.endsWith('.bak'),
    );
    expect(bakFiles.length).toBeGreaterThan(0);

    // Open the backup and run a basic integrity check.
    const bakPath = path.join(dbDir, bakFiles[0]);
    const restored = new Database(bakPath);
    try {
      const result = restored.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
      expect(result.integrity_check).toBe('ok');

      // The backup was taken pre-0012, so __drizzle_migrations should have <= 12 rows.
      const migRow = restored.prepare('SELECT COUNT(*) AS cnt FROM __drizzle_migrations').get() as { cnt: number };
      expect(migRow.cnt).toBeLessThanOrEqual(12);
    } finally {
      restored.close();
    }
  });
});
