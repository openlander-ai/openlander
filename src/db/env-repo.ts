import { BaseRepository } from './base-repo.js';

export class EnvVarRepository extends BaseRepository {
  getEnvVars(projectId: string): Record<string, string> {
    const rows = this.db
      .prepare('SELECT key, value FROM env_vars WHERE project_id = ?')
      .all(projectId) as Array<{ key: string; value: string }>;

    const result: Record<string, string> = {};
    for (const row of rows) {
      result[row.key] = row.value;
    }

    return result;
  }

  setEnvVar(projectId: string, key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO env_vars (id, project_id, key, value)
         VALUES (lower(hex(randomblob(8))), ?, ?, ?)
         ON CONFLICT(project_id, key) DO UPDATE SET value = excluded.value`,
      )
      .run(projectId, key, value);
  }

  setEnvVarsBulk(projectId: string, vars: Record<string, string>): void {
    const stmt = this.db.prepare(
      `INSERT INTO env_vars (id, project_id, key, value)
       VALUES (lower(hex(randomblob(8))), ?, ?, ?)
       ON CONFLICT(project_id, key) DO UPDATE SET value = excluded.value`,
    );

    this.transaction(() => {
      for (const [key, value] of Object.entries(vars)) {
        stmt.run(projectId, key, value);
      }
    });
  }

  deleteEnvVar(projectId: string, key: string): void {
    this.db.prepare('DELETE FROM env_vars WHERE project_id = ? AND key = ?').run(projectId, key);
  }

  findProjectsByEnvKey(key: string): string[] {
    const rows = this.db
      .prepare('SELECT DISTINCT project_id FROM env_vars WHERE key = ?')
      .all(key) as Array<{ project_id: string }>;

    return rows.map((row) => row.project_id);
  }
}
