import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { createDrizzleDatabase } from '../../../src/db/drizzle.js';
import { DeploymentPatternRepo } from '../../../src/db/repos/deployment-pattern.repo.js';

describe('DeploymentPatternRepo', () => {
  let repo: DeploymentPatternRepo;
  let sqlite: ReturnType<typeof createDrizzleDatabase>['sqlite'];

  beforeEach(() => {
    const db = createDrizzleDatabase(':memory:');
    sqlite = db.sqlite;
    repo = new DeploymentPatternRepo(db.db, db.sqlite);
    migrate(db.db as Parameters<typeof migrate>[0], { migrationsFolder: './drizzle' });
  });

  afterEach(() => {
    sqlite.close();
  });

  describe('findByProject', () => {
    it('returns empty array for project with no patterns', () => {
      const patterns = repo.findByProject('proj-1');
      expect(patterns).toEqual([]);
    });

    it('returns all patterns for a project', () => {
      repo.upsertPattern({
        project_id: 'proj-1',
        pattern_type: 'build_error',
        error_signature: 'npm ERR! code ENOENT',
        fix_action: '{"action": "install_deps"}',
      });

      repo.upsertPattern({
        project_id: 'proj-1',
        pattern_type: 'runtime_error',
        error_signature: 'EADDRINUSE',
        fix_action: '{"action": "change_port"}',
      });

      const patterns = repo.findByProject('proj-1');
      expect(patterns).toHaveLength(2);
      expect(patterns.map((p) => p.pattern_type)).toEqual(
        expect.arrayContaining(['runtime_error', 'build_error']),
      );
    });

    it('filters patterns by project', () => {
      repo.upsertPattern({
        project_id: 'proj-1',
        pattern_type: 'build_error',
        error_signature: 'npm ERR! code ENOENT',
        fix_action: '{"action": "install_deps"}',
      });

      repo.upsertPattern({
        project_id: 'proj-2',
        pattern_type: 'build_error',
        error_signature: 'npm ERR! code ENOENT',
        fix_action: '{"action": "install_deps"}',
      });

      const proj1Patterns = repo.findByProject('proj-1');
      const proj2Patterns = repo.findByProject('proj-2');

      expect(proj1Patterns).toHaveLength(1);
      expect(proj2Patterns).toHaveLength(1);
      expect(proj1Patterns[0].project_id).toBe('proj-1');
      expect(proj2Patterns[0].project_id).toBe('proj-2');
    });
  });

  describe('findBySignature', () => {
    it('returns undefined for non-existent signature', () => {
      const pattern = repo.findBySignature('proj-1', 'non-existent');
      expect(pattern).toBeUndefined();
    });

    it('finds pattern by project and signature', () => {
      const id = repo.upsertPattern({
        project_id: 'proj-1',
        pattern_type: 'build_error',
        error_signature: 'npm ERR! code ENOENT',
        fix_action: '{"action": "install_deps"}',
      });

      const pattern = repo.findBySignature('proj-1', 'npm ERR! code ENOENT');
      expect(pattern).toBeDefined();
      expect(pattern?.id).toBe(id);
      expect(pattern?.pattern_type).toBe('build_error');
    });

    it('does not find pattern from different project', () => {
      repo.upsertPattern({
        project_id: 'proj-1',
        pattern_type: 'build_error',
        error_signature: 'npm ERR! code ENOENT',
        fix_action: '{"action": "install_deps"}',
      });

      const pattern = repo.findBySignature('proj-2', 'npm ERR! code ENOENT');
      expect(pattern).toBeUndefined();
    });
  });

  describe('upsertPattern', () => {
    it('creates a new pattern', () => {
      const id = repo.upsertPattern({
        project_id: 'proj-1',
        pattern_type: 'build_error',
        error_signature: 'npm ERR! code ENOENT',
        fix_action: '{"action": "install_deps"}',
      });

      expect(id).toBeTruthy();
      expect(id).toMatch(/^[0-9a-f-]{36}$/);

      const pattern = repo.findBySignature('proj-1', 'npm ERR! code ENOENT');
      expect(pattern).toBeDefined();
      expect(pattern?.success_count).toBe(0);
      expect(pattern?.failure_count).toBe(0);
      expect(pattern?.created_at).toBeTruthy();
    });

    it('updates existing pattern instead of creating duplicate', () => {
      const id1 = repo.upsertPattern({
        project_id: 'proj-1',
        pattern_type: 'build_error',
        error_signature: 'npm ERR! code ENOENT',
        fix_action: '{"action": "install_deps"}',
      });

      const id2 = repo.upsertPattern({
        project_id: 'proj-1',
        pattern_type: 'build_error',
        error_signature: 'npm ERR! code ENOENT',
        fix_action: '{"action": "install_deps_v2"}',
      });

      expect(id1).toBe(id2);

      const patterns = repo.findByProject('proj-1');
      expect(patterns).toHaveLength(1);

      const pattern = repo.findBySignature('proj-1', 'npm ERR! code ENOENT');
      expect(pattern?.fix_action).toBe('{"action": "install_deps_v2"}');
    });

    it('updates last_seen_at on upsert', () => {
      repo.upsertPattern({
        project_id: 'proj-1',
        pattern_type: 'build_error',
        error_signature: 'npm ERR! code ENOENT',
        fix_action: '{"action": "install_deps"}',
      });

      const pattern1 = repo.findBySignature('proj-1', 'npm ERR! code ENOENT');
      const firstSeenAt = pattern1?.last_seen_at;

      const start = Date.now();
      while (Date.now() - start < 2) {
        void 0;
      }

      repo.upsertPattern({
        project_id: 'proj-1',
        pattern_type: 'build_error',
        error_signature: 'npm ERR! code ENOENT',
        fix_action: '{"action": "install_deps"}',
      });

      const pattern2 = repo.findBySignature('proj-1', 'npm ERR! code ENOENT');
      expect(pattern2?.last_seen_at).not.toBe(firstSeenAt);
    });
  });

  describe('recordSuccess', () => {
    it('increments success_count', () => {
      const id = repo.upsertPattern({
        project_id: 'proj-1',
        pattern_type: 'build_error',
        error_signature: 'npm ERR! code ENOENT',
        fix_action: '{"action": "install_deps"}',
      });

      repo.recordSuccess(id);
      repo.recordSuccess(id);

      const pattern = repo.findBySignature('proj-1', 'npm ERR! code ENOENT');
      expect(pattern?.success_count).toBe(2);
    });

    it('updates last_seen_at on success', () => {
      const id = repo.upsertPattern({
        project_id: 'proj-1',
        pattern_type: 'build_error',
        error_signature: 'npm ERR! code ENOENT',
        fix_action: '{"action": "install_deps"}',
      });

      const pattern1 = repo.findBySignature('proj-1', 'npm ERR! code ENOENT');
      const firstSeenAt = pattern1?.last_seen_at;

      const start = Date.now();
      while (Date.now() - start < 2) {
        void 0;
      }

      repo.recordSuccess(id);

      const pattern2 = repo.findBySignature('proj-1', 'npm ERR! code ENOENT');
      expect(pattern2?.last_seen_at).not.toBe(firstSeenAt);
    });
  });

  describe('recordFailure', () => {
    it('increments failure_count', () => {
      const id = repo.upsertPattern({
        project_id: 'proj-1',
        pattern_type: 'build_error',
        error_signature: 'npm ERR! code ENOENT',
        fix_action: '{"action": "install_deps"}',
      });

      repo.recordFailure(id);
      repo.recordFailure(id);
      repo.recordFailure(id);

      const pattern = repo.findBySignature('proj-1', 'npm ERR! code ENOENT');
      expect(pattern?.failure_count).toBe(3);
    });
  });

  describe('getTopPatterns', () => {
    it('returns empty array for project with no patterns', () => {
      const patterns = repo.getTopPatterns('proj-1');
      expect(patterns).toEqual([]);
    });

    it('returns patterns sorted by success_count descending', () => {
      const id1 = repo.upsertPattern({
        project_id: 'proj-1',
        pattern_type: 'build_error',
        error_signature: 'error1',
        fix_action: '{}',
      });

      const id2 = repo.upsertPattern({
        project_id: 'proj-1',
        pattern_type: 'build_error',
        error_signature: 'error2',
        fix_action: '{}',
      });

      const id3 = repo.upsertPattern({
        project_id: 'proj-1',
        pattern_type: 'build_error',
        error_signature: 'error3',
        fix_action: '{}',
      });

      repo.recordSuccess(id1);
      repo.recordSuccess(id1);
      repo.recordSuccess(id1);

      repo.recordSuccess(id2);
      repo.recordSuccess(id2);

      repo.recordSuccess(id3);

      const patterns = repo.getTopPatterns('proj-1');
      expect(patterns).toHaveLength(3);
      expect(patterns[0].error_signature).toBe('error1');
      expect(patterns[0].success_count).toBe(3);
      expect(patterns[1].error_signature).toBe('error2');
      expect(patterns[1].success_count).toBe(2);
      expect(patterns[2].error_signature).toBe('error3');
      expect(patterns[2].success_count).toBe(1);
    });

    it('respects limit parameter', () => {
      for (let i = 0; i < 5; i++) {
        repo.upsertPattern({
          project_id: 'proj-1',
          pattern_type: 'build_error',
          error_signature: `error${i}`,
          fix_action: '{}',
        });
      }

      const patterns = repo.getTopPatterns('proj-1', 3);
      expect(patterns).toHaveLength(3);
    });

    it('filters by project', () => {
      repo.upsertPattern({
        project_id: 'proj-1',
        pattern_type: 'build_error',
        error_signature: 'error1',
        fix_action: '{}',
      });

      repo.upsertPattern({
        project_id: 'proj-2',
        pattern_type: 'build_error',
        error_signature: 'error2',
        fix_action: '{}',
      });

      const proj1Patterns = repo.getTopPatterns('proj-1');
      const proj2Patterns = repo.getTopPatterns('proj-2');

      expect(proj1Patterns).toHaveLength(1);
      expect(proj2Patterns).toHaveLength(1);
      expect(proj1Patterns[0].project_id).toBe('proj-1');
      expect(proj2Patterns[0].project_id).toBe('proj-2');
    });
  });
});
