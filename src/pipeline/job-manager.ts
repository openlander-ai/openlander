export type JobPhase = 'queued' | 'cloning' | 'building' | 'starting' | 'done' | 'failed';

export interface JobStatus {
  projectId: string;
  projectName: string;
  phase: JobPhase;
  errorSummary?: string;
  buildLogTail?: string;
  startedAt: Date;
  completedAt?: Date;
}

export class JobManager {
  private jobs = new Map<string, JobStatus>();

  trackJob(projectId: string, projectName: string): void {
    this.jobs.set(projectId, {
      projectId,
      projectName,
      phase: 'queued',
      startedAt: new Date(),
    });
  }

  updatePhase(
    projectId: string,
    phase: JobPhase,
    errorSummary?: string,
    buildLogTail?: string,
  ): void {
    const job = this.jobs.get(projectId);
    if (!job) return;
    job.phase = phase;
    if (errorSummary) job.errorSummary = errorSummary;
    if (buildLogTail) job.buildLogTail = buildLogTail;
    if (phase === 'done' || phase === 'failed') {
      job.completedAt = new Date();
    }
  }

  getStatus(projectId: string): JobStatus | undefined {
    return this.jobs.get(projectId);
  }

  getStatuses(projectIds?: string[]): JobStatus[] {
    if (!projectIds) return [...this.jobs.values()];
    return projectIds.map((id) => this.jobs.get(id)).filter((j): j is JobStatus => j !== undefined);
  }

  getActiveJobs(): JobStatus[] {
    return [...this.jobs.values()].filter((j) => j.phase !== 'done' && j.phase !== 'failed');
  }

  cleanup(maxAgeMs: number = 30 * 60 * 1000): void {
    const now = Date.now();
    for (const [id, job] of this.jobs) {
      if (job.completedAt && now - job.completedAt.getTime() > maxAgeMs) {
        this.jobs.delete(id);
      }
    }
  }

  formatSummary(): string {
    const active = this.getActiveJobs();
    if (active.length === 0) return '';
    return active.map((j) => `• ${j.projectName}: ${j.phase}`).join('\n');
  }
}
