export type JobPhase = 'queued' | 'cloning' | 'building' | 'starting' | 'done' | 'failed';

export interface JobStatus {
  projectId: string;
  projectName: string;
  phase: JobPhase;
  errorSummary?: string;
  buildLogTail?: string;
  buildStep?: number;
  buildStepTotal?: number;
  buildStepDesc?: string;
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
      job.buildStep = undefined;
      job.buildStepTotal = undefined;
      job.buildStepDesc = undefined;
    }
  }

  updateBuildStep(projectId: string, step: number, total: number, desc: string): void {
    const job = this.jobs.get(projectId);
    if (!job) return;
    job.buildStep = step;
    job.buildStepTotal = total;
    job.buildStepDesc = desc;
  }

  /** Parse Docker build step from output line (classic + BuildKit). Returns undefined if not a step line. */
  static parseDockerBuildStep(
    line: string,
  ): { step: number; total: number; desc: string } | undefined {
    // Classic format: "Step 3/11 : RUN pip install -r requirements.txt"
    const classic = line.match(/^Step (\d+)\/(\d+)\s*:\s*(.+)/);
    if (classic?.[1] && classic[2] && classic[3]) {
      return { step: parseInt(classic[1], 10), total: parseInt(classic[2], 10), desc: classic[3] };
    }
    // BuildKit format: "#5 [stage-0 3/7] RUN apt-get update" or "#8 [2/5] COPY ."
    const buildkit = line.match(/^#\d+\s+\[.*?(\d+)\/(\d+)\]\s+(.+)/);
    if (buildkit?.[1] && buildkit[2] && buildkit[3]) {
      return {
        step: parseInt(buildkit[1], 10),
        total: parseInt(buildkit[2], 10),
        desc: buildkit[3],
      };
    }
    return undefined;
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
