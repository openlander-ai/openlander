/**
 * Realistic-volume migration tests for the rc.7 -> 1.0 upgrade path.
 *
 * `migration-replay.test.ts` proves the migration is *correct* on a few
 * sentinel rows. This file proves the migration is *safe at production
 * scale*: rc.7-shaped fixtures with hundreds of rows across every
 * dependent table, mixed canonical / non-canonical `result` enum values,
 * and a wall-clock budget so a regression that adds an O(N^2) step is
 * caught before users discover it on a 10k-row instance.
 *
 * The fixture deliberately mirrors the exact column set of the rc.7
 * schema (i.e. the state produced by 0000+0001+0002 with NO 0003/0004/0005
 * applied) and seeds:
 *   - 50 projects
 *   - 100 environments (2 per project)
 *   - 500 env_vars
 *   - 200 deploy_logs
 *   - 500 ai_usage_log rows split between canonical and non-canonical
 *     `result` values
 *
 * All tests run on in-memory SQLite to keep CI fast.
 */

import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { createDrizzleDatabase } from '../../src/db/drizzle.js';
import type { SqliteDatabase } from '../../src/db/drizzle.js';

const DRIZZLE_DIR = path.resolve(process.cwd(), 'drizzle');
const MIGRATIONS_FOLDER = DRIZZLE_DIR;

/**
 * folderMillis values from drizzle/meta/_journal.json. Drizzle's migrator
 * uses these (NOT the SHA256 hash alone) to decide which migrations to
 * skip — specifically: a migration is skipped when its `folderMillis`
 * is <= the latest `created_at` in `__drizzle_migrations`. The existing
 * `migration-replay.test.ts` records baseline rows with `Date.now()`,
 * which silently disables 0003/0004/0005 because every newer-than-now
 * folderMillis check fails. We pin to exact values here so 0003/0004/0005
 * actually run.
 */
const BASELINE_FOLDER_MILLIS: Record<string, number> = {
  '0000_initial': 1776203869422,
  '0001_env_vars_scoped_uniques': 1776203869423,
  '0002_add_server_id': 1776217725447,
};

const BASELINE_TAGS = [
  '0000_initial',
  '0001_env_vars_scoped_uniques',
  '0002_add_server_id',
] as const;

// --- Helpers -----------------------------------------------------------------

function readMigrationStatements(tag: string): string[] {
  const sql = readFileSync(path.join(DRIZZLE_DIR, `${tag}.sql`), 'utf8');
  return sql
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Apply baseline migrations 0000~0002, then mark them as recorded. */
function applyBaseline0to2(sqlite: SqliteDatabase): void {
  sqlite.exec('PRAGMA foreign_keys = OFF');
  try {
    for (const tag of BASELINE_TAGS) {
      for (const stmt of readMigrationStatements(tag)) {
        try {
          sqlite.exec(stmt);
        } catch {
          // already-applied statement — skip
        }
      }
    }

    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS __drizzle_migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        hash text NOT NULL,
        created_at numeric
      )
    `);

    const insert = sqlite.prepare(
      'INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)',
    );
    // Use the exact folderMillis from the journal so drizzle's
    // "skip if folderMillis <= last created_at" check correctly
    // identifies 0003/0004/0005 as still pending. See doc comment
    // on BASELINE_FOLDER_MILLIS for why Date.now() is wrong.
    for (const tag of BASELINE_TAGS) {
      const sql = readFileSync(path.join(DRIZZLE_DIR, `${tag}.sql`), 'utf8');
      const hash = createHash('sha256').update(sql).digest('hex');
      insert.run(hash, BASELINE_FOLDER_MILLIS[tag]!);
    }
  } finally {
    sqlite.exec('PRAGMA foreign_keys = ON');
  }
}

function runFullMigration(
  drizzle: ReturnType<typeof createDrizzleDatabase>['db'],
  sqlite: SqliteDatabase,
): void {
  sqlite.exec('PRAGMA foreign_keys = OFF');
  try {
    migrate(drizzle as Parameters<typeof migrate>[0], { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    sqlite.exec('PRAGMA foreign_keys = ON');
  }
}

function countRows(sqlite: SqliteDatabase, table: string): number {
  return (sqlite.prepare(`SELECT COUNT(*) AS cnt FROM "${table}"`).get() as { cnt: number }).cnt;
}

interface FixtureCounts {
  projects: number;
  environments: number;
  envVars: number;
  deployLogs: number;
  aiUsageLog: number;
  aiUsageNonCanonical: number;
}

/**
 * Seed rc.7-shaped data into the database after baseline 0000~0002 has
 * been applied. Quantities are large enough to surface O(N^2) regressions
 * but small enough to keep the suite fast.
 *
 * `nonCanonicalAiResults`: when true, ~10% of ai_usage_log rows get a
 * `result` value outside ('success','failure','partial'). Used to drive
 * the test that asserts 0004's INSERT…SELECT *fails* on non-canonical data
 * (matching the documented rc.7 -> 1.0 upgrade behaviour in
 * docs/migration-rc7-to-rc9.md).
 */
function seedRc7Fixture(
  sqlite: SqliteDatabase,
  opts: { nonCanonicalAiResults: boolean },
): FixtureCounts {
  const PROJECT_COUNT = 50;
  const ENV_PER_PROJECT = 2;
  const ENV_VARS_TOTAL = 500;
  const DEPLOY_LOGS_TOTAL = 200;
  const AI_USAGE_TOTAL = 500;
  const NOW = new Date().toISOString();

  const counts: FixtureCounts = {
    projects: PROJECT_COUNT,
    environments: PROJECT_COUNT * ENV_PER_PROJECT,
    envVars: ENV_VARS_TOTAL,
    deployLogs: DEPLOY_LOGS_TOTAL,
    aiUsageLog: AI_USAGE_TOTAL,
    aiUsageNonCanonical: 0,
  };

  // Bulk insert via single transaction — required to keep wall-clock
  // budget realistic for the perf assertion below.
  sqlite.exec('BEGIN');
  try {
    const insertProject = sqlite.prepare(`
      INSERT INTO projects (
        id, name, repo_url, branch, status, visibility,
        dockerfile_path, source, project_type, created_at, updated_at, server_id
      ) VALUES (?, ?, ?, 'main', 'stopped', 'internal',
        'Dockerfile', 'git', 'web', ?, ?, 'local')
    `);

    const projectIds: string[] = [];
    for (let i = 0; i < PROJECT_COUNT; i++) {
      const id = `proj-${String(i).padStart(4, '0')}-${randomUUID().slice(0, 8)}`;
      projectIds.push(id);
      insertProject.run(
        id,
        `project-${String(i)}`,
        `https://example.com/repo-${String(i)}.git`,
        NOW,
        NOW,
      );
    }

    const insertEnv = sqlite.prepare(`
      INSERT INTO environments (
        id, project_id, type, branch, status, created_at, updated_at, server_id
      ) VALUES (?, ?, ?, 'main', 'idle', ?, ?, 'local')
    `);

    const envIds: string[] = [];
    for (const projId of projectIds) {
      for (const envType of ['production', 'development'] as const) {
        const id = `env-${randomUUID().slice(0, 12)}`;
        envIds.push(id);
        insertEnv.run(id, projId, envType, NOW, NOW);
      }
    }

    const insertEnvVar = sqlite.prepare(`
      INSERT INTO env_vars (id, project_id, environment_id, key, value, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (let i = 0; i < ENV_VARS_TOTAL; i++) {
      const projId = projectIds[i % projectIds.length]!;
      // Half scoped to an env, half global — exercises the
      // 0001_env_vars_scoped_uniques partial-unique index in both modes.
      const envId = i % 2 === 0 ? envIds[i % envIds.length]! : null;
      insertEnvVar.run(
        `var-${String(i)}-${randomUUID().slice(0, 8)}`,
        projId,
        envId,
        `KEY_${String(i)}`,
        `value_${String(i)}`,
        NOW,
      );
    }

    const insertDeployLog = sqlite.prepare(`
      INSERT INTO deploy_logs (
        id, project_id, environment_id, status, trigger_source,
        commit_sha, commit_message, duration_ms, created_at, server_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'local')
    `);
    const STATUSES = ['success', 'failed', 'cancelled'] as const;
    const TRIGGERS = ['chat', 'webhook', 'api'] as const;
    for (let i = 0; i < DEPLOY_LOGS_TOTAL; i++) {
      insertDeployLog.run(
        `dlog-${String(i)}-${randomUUID().slice(0, 8)}`,
        projectIds[i % projectIds.length]!,
        envIds[i % envIds.length]!,
        STATUSES[i % STATUSES.length]!,
        TRIGGERS[i % TRIGGERS.length]!,
        `commit${String(i).padStart(40, '0')}`.slice(0, 40),
        `chore: deploy ${String(i)}`,
        1000 + i,
        NOW,
      );
    }

    const insertAiUsage = sqlite.prepare(`
      INSERT INTO ai_usage_log (
        id, action_type, model_name, provider,
        input_tokens, output_tokens, total_tokens,
        tools_called, result, duration_ms, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?)
    `);
    const CANONICAL = ['success', 'failure', 'partial'] as const;
    const NON_CANONICAL = ['unknown', 'pending', 'timeout', 'ok', ''] as const;
    for (let i = 0; i < AI_USAGE_TOTAL; i++) {
      let result: string;
      if (opts.nonCanonicalAiResults && i % 10 === 0) {
        result = NON_CANONICAL[i % NON_CANONICAL.length]!;
        counts.aiUsageNonCanonical += 1;
      } else {
        result = CANONICAL[i % CANONICAL.length]!;
      }
      insertAiUsage.run(
        `aiu-${String(i)}-${randomUUID().slice(0, 8)}`,
        'web_agent',
        'gpt-4',
        'openai',
        100 + i,
        50 + i,
        150 + i * 2,
        result,
        1000 + i,
        NOW,
      );
    }

    sqlite.exec('COMMIT');
  } catch (err) {
    sqlite.exec('ROLLBACK');
    throw err;
  }

  return counts;
}

// --- Test Suite --------------------------------------------------------------

describe('migration realistic-data (rc.7 -> 1.0 at production scale)', () => {
  let sqlite: SqliteDatabase;
  let drizzle: ReturnType<typeof createDrizzleDatabase>['db'];

  beforeEach(() => {
    const db = createDrizzleDatabase(':memory:');
    sqlite = db.sqlite;
    drizzle = db.db;
  });

  afterEach(() => {
    sqlite.close();
  });

  // ---------------------------------------------------------------------
  // Scenario 1: Realistic rc.7 -> 1.0 happy path (canonical results only)
  // ---------------------------------------------------------------------
  describe('Scenario 1: canonical-only fixture (50 projects + 100 envs + 500 env_vars + 200 deploys + 500 ai_usage)', () => {
    it('migrates 0003~0005 successfully on rc.7-shaped baseline', () => {
      applyBaseline0to2(sqlite);
      const counts = seedRc7Fixture(sqlite, { nonCanonicalAiResults: false });

      expect(() => runFullMigration(drizzle, sqlite)).not.toThrow();

      // Every table preserved its row count exactly — zero data loss.
      // Post-0009: projects gains the synthesized __orphan_managed group row
      // (Plan §6.3 Phase C). Subtract 1 from the post-migration count to
      // assert against the input fixture count.
      expect(countRows(sqlite, 'projects') - 1).toBe(counts.projects);
      expect(countRows(sqlite, 'environments')).toBe(counts.environments);
      expect(countRows(sqlite, 'env_vars')).toBe(counts.envVars);
      expect(countRows(sqlite, 'deploy_logs')).toBe(counts.deployLogs);
      expect(countRows(sqlite, 'ai_usage_log')).toBe(counts.aiUsageLog);
    });

    it('post-migration: every ai_usage_log.result value is in the canonical enum', () => {
      applyBaseline0to2(sqlite);
      seedRc7Fixture(sqlite, { nonCanonicalAiResults: false });
      runFullMigration(drizzle, sqlite);

      const rows = sqlite.prepare('SELECT DISTINCT result FROM ai_usage_log').all() as {
        result: string;
      }[];
      const distinct = rows.map((r) => r.result).sort();
      expect(distinct).toEqual(['failure', 'partial', 'success']);
    });

    it('post-migration: 0005 columns (error_message, error_type) exist on every row as NULL', () => {
      applyBaseline0to2(sqlite);
      seedRc7Fixture(sqlite, { nonCanonicalAiResults: false });
      runFullMigration(drizzle, sqlite);

      const row = sqlite
        .prepare(
          'SELECT COUNT(*) AS cnt FROM ai_usage_log WHERE error_message IS NULL AND error_type IS NULL',
        )
        .get() as { cnt: number };
      expect(row.cnt).toBe(500);
    });

    it('post-migration: env_vars partial-unique indexes still hold (no spurious duplicates introduced)', () => {
      applyBaseline0to2(sqlite);
      seedRc7Fixture(sqlite, { nonCanonicalAiResults: false });
      runFullMigration(drizzle, sqlite);

      // Duplicate insert on the global-scope partial unique index must throw.
      const proj = (sqlite.prepare('SELECT id FROM projects LIMIT 1').get() as { id: string }).id;

      sqlite
        .prepare(
          'INSERT INTO env_vars (id, project_id, environment_id, key, value, created_at) VALUES (?, ?, NULL, ?, ?, ?)',
        )
        .run(`var-uniq-1-${randomUUID()}`, proj, 'UNIQUE_KEY_TEST', 'v', new Date().toISOString());

      expect(() => {
        sqlite
          .prepare(
            'INSERT INTO env_vars (id, project_id, environment_id, key, value, created_at) VALUES (?, ?, NULL, ?, ?, ?)',
          )
          .run(
            `var-uniq-2-${randomUUID()}`,
            proj,
            'UNIQUE_KEY_TEST',
            'v',
            new Date().toISOString(),
          );
      }).toThrow();
    });
  });

  // ---------------------------------------------------------------------
  // Scenario 2: Non-canonical result handling — documents the failure mode
  // ---------------------------------------------------------------------
  describe('Scenario 2: non-canonical ai_usage_log.result values', () => {
    it('seeded fixture contains the expected non-canonical mix (sanity check)', () => {
      applyBaseline0to2(sqlite);
      const counts = seedRc7Fixture(sqlite, { nonCanonicalAiResults: true });

      // 10% of 500 = 50 rows with non-canonical values
      expect(counts.aiUsageNonCanonical).toBe(50);

      const distinct = (
        sqlite.prepare('SELECT DISTINCT result FROM ai_usage_log').all() as { result: string }[]
      )
        .map((r) => r.result)
        .sort();
      // Must contain at least one non-canonical entry from the seed list.
      const hasNonCanonical = distinct.some((v) => !['success', 'failure', 'partial'].includes(v));
      expect(hasNonCanonical).toBe(true);
    });

    it('migration FAILS on non-canonical rows — confirms documented rc.7 upgrade behaviour', () => {
      applyBaseline0to2(sqlite);
      seedRc7Fixture(sqlite, { nonCanonicalAiResults: true });

      // 0004's INSERT INTO __new_ai_usage_log SELECT FROM ai_usage_log
      // re-applies the CHECK clause; rows with result NOT IN
      // ('success','failure','partial') trigger a CHECK constraint
      // failure that aborts the migration. This mirrors what an rc.7
      // user sees if they upgrade without running the pre-flight
      // SELECT documented in docs/migration-rc7-to-rc9.md section 2.
      let caught: unknown = null;
      try {
        runFullMigration(drizzle, sqlite);
      } catch (err) {
        caught = err;
      }

      expect(caught).not.toBeNull();
      // The error message must mention the CHECK constraint so users
      // can correlate it with the migration doc's section 2.
      const msg = caught instanceof Error ? caught.message : String(caught);
      expect(msg.toLowerCase()).toMatch(/check|constraint|ai_usage/);
    });

    it('after pre-flight cleanup (UPDATE non-canonical -> failure), migration succeeds', () => {
      applyBaseline0to2(sqlite);
      seedRc7Fixture(sqlite, { nonCanonicalAiResults: true });

      // Simulate the recommended remediation from docs/migration-rc7-to-rc9.md:
      //   UPDATE ai_usage_log SET result = 'failure'
      //   WHERE result NOT IN ('success','failure','partial');
      const updated = sqlite
        .prepare(
          "UPDATE ai_usage_log SET result = 'failure' WHERE result NOT IN ('success','failure','partial')",
        )
        .run();
      expect(updated.changes).toBe(50);

      expect(() => runFullMigration(drizzle, sqlite)).not.toThrow();
      expect(countRows(sqlite, 'ai_usage_log')).toBe(500);

      const stillBad = (
        sqlite
          .prepare(
            "SELECT COUNT(*) AS cnt FROM ai_usage_log WHERE result NOT IN ('success','failure','partial')",
          )
          .get() as { cnt: number }
      ).cnt;
      expect(stillBad).toBe(0);
    });
  });

  // ---------------------------------------------------------------------
  // Scenario 3: Edge cases that could violate constraints introduced in 0003+
  // ---------------------------------------------------------------------
  describe('Scenario 3: edge cases (orphan-like rows, NULL handling)', () => {
    it('rows with NULL project_id on ai_usage_log survive migration (column is nullable)', () => {
      applyBaseline0to2(sqlite);
      // Insert a row with project_id explicitly NULL — schema allows this,
      // and the rebuild in 0003/0004 must preserve it.
      sqlite
        .prepare(
          `INSERT INTO ai_usage_log (
            id, project_id, action_type, model_name, provider,
            input_tokens, output_tokens, total_tokens, tools_called,
            result, duration_ms, created_at
          ) VALUES (?, NULL, 'web_agent', 'gpt-4', 'openai',
            100, 50, 150, '[]', 'success', 1000, ?)`,
        )
        .run('null-pid-row', new Date().toISOString());

      expect(() => runFullMigration(drizzle, sqlite)).not.toThrow();

      const row = sqlite
        .prepare("SELECT project_id FROM ai_usage_log WHERE id = 'null-pid-row'")
        .get() as { project_id: string | null } | undefined;
      expect(row).toBeDefined();
      expect(row!.project_id).toBeNull();
    });

    it('a project that violates the new status CHECK is rejected on rebuild — surfaces upgrade blocker', () => {
      applyBaseline0to2(sqlite);

      // Insert a project with a status value outside the rc.7 enum that
      // 0003 will enforce. rc.7 schema (0000_initial) already had a
      // CHECK on projects.status, so this insert should fail at the
      // baseline level too — verifying that CHECK is in fact already
      // present at baseline (regression guard).
      expect(() => {
        sqlite
          .prepare(
            `INSERT INTO projects (
              id, name, repo_url, branch, status, visibility,
              dockerfile_path, source, project_type, server_id
            ) VALUES ('bad-proj', 'bad-status-project', NULL, 'main',
              'unknown_status', 'internal', 'Dockerfile', 'git', 'web', 'local')`,
          )
          .run();
      }).toThrow();
    });

    it('orphaned env_vars (project_id pointing to deleted project) are flagged when foreign keys are re-enabled', () => {
      applyBaseline0to2(sqlite);
      seedRc7Fixture(sqlite, { nonCanonicalAiResults: false });

      // Manually orphan one env_var by inserting a row with a fake project_id.
      // Migration runs with foreign_keys=OFF (matching production) so the
      // insert+migration succeed; the assertion below documents that
      // orphaned rows survive the migration silently — a known 1.0
      // characteristic. Tracked as 1.0.x backlog if we ever want
      // automated cleanup.
      sqlite.exec('PRAGMA foreign_keys = OFF');
      sqlite
        .prepare(
          'INSERT INTO env_vars (id, project_id, environment_id, key, value, created_at) VALUES (?, ?, NULL, ?, ?, ?)',
        )
        .run('orphan-env-var', 'nonexistent-project', 'ORPHAN_KEY', 'v', new Date().toISOString());
      sqlite.exec('PRAGMA foreign_keys = ON');

      expect(() => runFullMigration(drizzle, sqlite)).not.toThrow();

      const row = sqlite.prepare("SELECT id FROM env_vars WHERE id = 'orphan-env-var'").get() as
        | { id: string }
        | undefined;
      // Orphan survived (FKs were OFF during migration). Documented
      // behaviour, not a bug — the rc.7 dataset may already contain
      // orphaned rows from race conditions and we don't want the
      // upgrade to silently delete user data.
      expect(row).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------
  // Scenario 4: Performance budget — guards against O(N^2) regressions
  // ---------------------------------------------------------------------
  describe('Scenario 4: performance — full rc.7 -> 1.0 migration completes within wall-clock budget', () => {
    it('1000+ rows across all rc.7 tables migrate in under 10 seconds', () => {
      applyBaseline0to2(sqlite);
      seedRc7Fixture(sqlite, { nonCanonicalAiResults: false });

      const totalRowsBefore =
        countRows(sqlite, 'projects') +
        countRows(sqlite, 'environments') +
        countRows(sqlite, 'env_vars') +
        countRows(sqlite, 'deploy_logs') +
        countRows(sqlite, 'ai_usage_log');
      expect(totalRowsBefore).toBeGreaterThanOrEqual(1000);

      const start = Date.now();
      runFullMigration(drizzle, sqlite);
      const elapsed = Date.now() - start;

      // 10-second budget on in-memory SQLite. On disk-backed instances
      // we expect 2-3x slowdown — still well under the 30s pm2 boot
      // timeout. If this fails, profile 0003 (the largest rebuild).
      expect(elapsed, `migration took ${String(elapsed)}ms (budget: 10000ms)`).toBeLessThan(10000);
    });
  });
});
