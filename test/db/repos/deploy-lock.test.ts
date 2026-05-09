/**
 * Deploy-lock tests against the post-0012 fixture.
 *
 * Plan §AC: "Deploy-lock criterion: acquireDeployLock, releaseDeployLock,
 * cleanExpiredDeployLocks, getDeployLockInfo exercise the projects-side
 * columns post-0012; test/db/repos/deploy-lock.test.ts covers acquire/
 * release/expire/getInfo against post-0012 fixture; locks still on projects."
 *
 * Coverage:
 *   - acquireDeployLock — fresh lock + same-session re-acquire
 *   - releaseDeployLock — exact session match
 *   - releaseDeployLock — session mismatch (no-op + warn-log path)
 *   - getDeployLockInfo — populated + null
 *   - cleanExpiredDeployLocks — TTL expiry
 *
 * The test asserts that the deploy_lock_session/at columns persist on the
 * `projects` row (NOT services) post-0012, per ADR §"Deploy-lock relocation"
 * option (c).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createDrizzleDatabase,
  type SqliteDatabase,
} from '../../../src/db/drizzle.js';
import { ProjectRepo } from '../../../src/db/repos/project.repo.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_FOLDER = path.resolve(__dirname, '..', '..', '..', 'drizzle');

describe('DeployLock — post-0012 fixture (locks on projects, not services)', () => {
  let repo: ProjectRepo;
  let sqlite: SqliteDatabase;

  beforeEach(() => {
    const db = createDrizzleDatabase(':memory:');
    sqlite = db.sqlite;
    sqlite.exec('PRAGMA foreign_keys = OFF');
    try {
      migrate(db.db as Parameters<typeof migrate>[0], { migrationsFolder: MIGRATIONS_FOLDER });
    } finally {
      sqlite.exec('PRAGMA foreign_keys = ON');
    }
    repo = new ProjectRepo(db.db, db.sqlite);

    // Seed a project row directly (bypassing createProject since some of
    // its dependent tables / columns rely on the post-0012 services side).
    sqlite
      .prepare(
        'INSERT INTO projects (id, name, repo_url, branch, server_id) VALUES (?, ?, ?, ?, ?)',
      )
      .run('p1', 'p1', null, 'main', 'local');
  });

  afterEach(() => {
    sqlite.close();
  });

  it('services post-0012 has NO deploy_lock_session column (Phase C drop verification)', () => {
    const cols = sqlite.prepare(`PRAGMA table_info('services')`).all() as Array<{ name: string }>;
    const colNames = cols.map((c) => c.name);
    expect(colNames).not.toContain('deploy_lock_session');
    expect(colNames).not.toContain('deploy_lock_at');
  });

  it('projects retains deploy_lock_session and deploy_lock_at (option c — locks stay on projects)', () => {
    const cols = sqlite.prepare(`PRAGMA table_info('projects')`).all() as Array<{ name: string }>;
    const colNames = cols.map((c) => c.name);
    expect(colNames).toContain('deploy_lock_session');
    expect(colNames).toContain('deploy_lock_at');
  });

  it('acquireDeployLock acquires when free', () => {
    expect(repo.acquireDeployLock('p1', 'sess-1')).toBe(true);
    const info = repo.getDeployLockInfo('p1');
    expect(info?.session).toBe('sess-1');
    expect(info?.lockedAt).toBeTruthy();
  });

  it('acquireDeployLock allows same-session re-entry', () => {
    repo.acquireDeployLock('p1', 'sess-1');
    expect(repo.acquireDeployLock('p1', 'sess-1')).toBe(true);
  });

  it('acquireDeployLock blocks a foreign session', () => {
    repo.acquireDeployLock('p1', 'sess-1');
    expect(repo.acquireDeployLock('p1', 'sess-2')).toBe(false);
    const info = repo.getDeployLockInfo('p1');
    expect(info?.session).toBe('sess-1');
  });

  it('releaseDeployLock with matching session clears the lock', () => {
    repo.acquireDeployLock('p1', 'sess-1');
    expect(repo.releaseDeployLock('p1', 'sess-1')).toBe(true);
    expect(repo.getDeployLockInfo('p1')).toBeNull();
  });

  it('releaseDeployLock with mismatched session is a no-op', () => {
    repo.acquireDeployLock('p1', 'sess-1');
    expect(repo.releaseDeployLock('p1', 'sess-2')).toBe(false);
    const info = repo.getDeployLockInfo('p1');
    expect(info?.session).toBe('sess-1');
  });

  it('releaseDeployLock without session arg force-releases', () => {
    repo.acquireDeployLock('p1', 'sess-1');
    expect(repo.releaseDeployLock('p1')).toBe(true);
    expect(repo.getDeployLockInfo('p1')).toBeNull();
  });

  it('cleanExpiredDeployLocks clears stale lock past TTL', () => {
    // Manually set deploy_lock_at to a known stale timestamp.
    sqlite
      .prepare(
        "UPDATE projects SET deploy_lock_session = ?, deploy_lock_at = datetime('now', '-2 hours') WHERE id = ?",
      )
      .run('sess-stale', 'p1');
    const cleared = repo.cleanExpiredDeployLocks(30);
    expect(cleared).toBeGreaterThanOrEqual(1);
    expect(repo.getDeployLockInfo('p1')).toBeNull();
  });

  it('getDeployLockInfo returns null when no lock is held', () => {
    expect(repo.getDeployLockInfo('p1')).toBeNull();
  });
});
