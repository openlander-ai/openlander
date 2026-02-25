import { BaseRepository } from './base-repo.js';
import type { DeployLogRow } from './types.js';

export interface CreateDeployLogInput {
  id: string;
  projectId: string;
  status: DeployLogRow['status'];
  trigger: DeployLogRow['trigger'];
  commitSha?: string;
  buildLog?: string;
  durationMs?: number;
}

export class DeployLogRepository extends BaseRepository {
  createDeployLog(log: CreateDeployLogInput): void {
    this.db
      .prepare(
        `INSERT INTO deploy_logs (id, project_id, status, trigger, commit_sha, build_log, duration_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        log.id,
        log.projectId,
        log.status,
        log.trigger,
        log.commitSha ?? null,
        log.buildLog ?? null,
        log.durationMs ?? null,
      );
  }

  getDeployLogs(projectId: string, limit = 20): DeployLogRow[] {
    return this.db
      .prepare('SELECT * FROM deploy_logs WHERE project_id = ? ORDER BY rowid DESC LIMIT ?')
      .all(projectId, limit) as DeployLogRow[];
  }

  getLastDeployLog(projectId: string): DeployLogRow | undefined {
    return this.db
      .prepare('SELECT * FROM deploy_logs WHERE project_id = ? ORDER BY rowid DESC LIMIT 1')
      .get(projectId) as DeployLogRow | undefined;
  }
}
