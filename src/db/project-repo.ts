import { BaseRepository } from './base-repo.js';
import type { ProjectRow } from './types.js';

export interface CreateProjectInput {
  id: string;
  name: string;
  repoUrl: string;
  branch?: string;
  parentProjectId?: string;
  dockerfilePath?: string;
}

interface ProjectUpdateFields {
  status: ProjectRow['status'];
  visibility: ProjectRow['visibility'];
  assignedPort: number | null;
  containerId: string | null;
  imageTag: string | null;
  previousImageTag: string | null;
  publicUrl: string | null;
  parentProjectId: string | null;
  dockerfilePath: string;
}

export type UpdateProjectInput = Partial<ProjectUpdateFields>;

export class ProjectRepository extends BaseRepository {
  createProject(project: CreateProjectInput): ProjectRow {
    this.db
      .prepare(
        `INSERT INTO projects (id, name, repo_url, branch, parent_project_id, dockerfile_path)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        project.id,
        project.name,
        project.repoUrl,
        project.branch ?? 'main',
        project.parentProjectId ?? null,
        project.dockerfilePath ?? 'Dockerfile',
      );

    const created = this.getProject(project.id);
    if (!created) throw new Error(`Failed to create project ${project.id}`);
    return created;
  }

  getProject(id: string): ProjectRow | undefined {
    return this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow | undefined;
  }

  getProjectByName(name: string): ProjectRow | undefined {
    return this.db.prepare('SELECT * FROM projects WHERE name = ?').get(name) as
      | ProjectRow
      | undefined;
  }

  listProjects(status?: ProjectRow['status']): ProjectRow[] {
    if (status) {
      return this.db
        .prepare('SELECT * FROM projects WHERE status = ? ORDER BY updated_at DESC')
        .all(status) as ProjectRow[];
    }

    return this.db.prepare('SELECT * FROM projects ORDER BY updated_at DESC').all() as ProjectRow[];
  }

  updateProject(id: string, updates: UpdateProjectInput): void {
    const fieldMap: Record<keyof ProjectUpdateFields, string> = {
      status: 'status',
      visibility: 'visibility',
      assignedPort: 'assigned_port',
      containerId: 'container_id',
      imageTag: 'image_tag',
      previousImageTag: 'previous_image_tag',
      publicUrl: 'public_url',
      parentProjectId: 'parent_project_id',
      dockerfilePath: 'dockerfile_path',
    };

    const setClauses: string[] = [];
    const values: unknown[] = [];
    const entries = Object.entries(updates) as Array<
      [keyof ProjectUpdateFields, ProjectUpdateFields[keyof ProjectUpdateFields] | undefined]
    >;

    for (const [key, value] of entries) {
      if (value === undefined) {
        continue;
      }

      setClauses.push(`${fieldMap[key]} = ?`);
      values.push(value);
    }

    if (setClauses.length === 0) {
      return;
    }

    setClauses.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id);

    this.db.prepare(`UPDATE projects SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);
  }

  deleteProject(id: string): void {
    this.db.prepare('DELETE FROM projects WHERE id = ?').run(id);
  }

  getChildProjects(parentId: string): ProjectRow[] {
    return this.db
      .prepare('SELECT * FROM projects WHERE parent_project_id = ? ORDER BY name ASC')
      .all(parentId) as ProjectRow[];
  }

  isParentProject(id: string): boolean {
    const row = this.db
      .prepare('SELECT COUNT(*) as cnt FROM projects WHERE parent_project_id = ?')
      .get(id) as { cnt: number };
    return row.cnt > 0;
  }

  getUsedPorts(): number[] {
    const rows = this.db
      .prepare('SELECT assigned_port FROM projects WHERE assigned_port IS NOT NULL')
      .all() as Array<{ assigned_port: number }>;
    return rows.map((row) => row.assigned_port);
  }
}
