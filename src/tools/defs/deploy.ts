import { ProjectNotFoundError } from '../../errors.js';
import { getProjectUrls } from '../../pipeline/traefik.js';
import type { ToolDef } from './types.js';
import {
  cleanupPreviewSchema,
  deployBlueGreenSchema,
  deployStatusSchema,
  listPreviewsSchema,
  previewDeploySchema,
  rollbackProjectSchema,
} from './schemas.js';

export const deployToolDefs: ToolDef[] = [
  {
    name: 'preview_deploy',
    description:
      'Deploy an ephemeral preview environment for a specific branch. Creates a separate container that does not affect the main deployment. Use when user wants to test a PR or feature branch before merging. Returns { previewId, branch, url, port }. The preview is temporary — clean up with cleanup_preview when done.',
    mcpDescription: 'Deploy an ephemeral preview environment for a branch.',
    inputSchema: previewDeploySchema,
    execute: (args, context) => {
      const appCtx = context.appCtx;
      return appCtx.previewDeployer.deploy({
        repoUrl: args['repo_url'] as string,
        branch: args['branch'] as string,
        sshKeyPath: appCtx.config.git.sshKeyPath || undefined,
      });
    },
  },
  {
    name: 'rollback_project',
    description:
      'Rollback a project to its previous Docker image. Use when a recent deploy broke something and user wants to revert. Returns the rollback result with previous image info. Errors: PROJECT_NOT_FOUND, NO_PREVIOUS_IMAGE if this is the first deploy.',
    mcpDescription: 'Rollback a project to its previous image when available.',
    inputSchema: rollbackProjectSchema,
    execute: async (args, context) => {
      const projectName = args['project_name'] as string;
      const project = context.appCtx.db.getProjectByName(projectName);
      if (!project) {
        throw new ProjectNotFoundError(projectName);
      }
      return context.appCtx.pipeline.rollback(project.id);
    },
  },
  {
    name: 'deploy_blue_green',
    description:
      'Deploy a project with zero downtime using blue-green strategy. Builds a new version alongside the current one, runs health checks, then switches traffic atomically. Use for production projects where downtime is unacceptable. Returns deployment result with old/new container info. Errors: PROJECT_NOT_FOUND, HEALTH_CHECK_FAILED (new version unhealthy — old version kept running).',
    mcpDescription: 'Deploy with zero downtime using blue-green strategy.',
    inputSchema: deployBlueGreenSchema,
    execute: async (args, context) => {
      const projectName = args['project_name'] as string;
      const project = context.appCtx.db.getProjectByName(projectName);
      if (!project) {
        throw new ProjectNotFoundError(projectName);
      }
      return context.appCtx.blueGreen.deploy(project.id);
    },
  },
  {
    name: 'cleanup_preview',
    description:
      'Remove an ephemeral preview deployment created by preview_deploy. Pass the preview_id that was returned. Use when testing is done or to free resources. Returns { status, previewId }. Errors: PREVIEW_NOT_FOUND if the ID is invalid.',
    mcpDescription: 'Remove an ephemeral preview deployment.',
    inputSchema: cleanupPreviewSchema,
    execute: async (args, context) => {
      const previewId = args['preview_id'] as string;
      await context.appCtx.previewDeployer.cleanup(previewId);
      return { status: 'cleaned_up', previewId };
    },
  },
  {
    name: 'list_previews',
    description:
      'List all active preview deployments with branch, URL, port, and creation time. Use to check what previews exist before creating new ones or to find a preview URL. Returns { count, previews[] }. Always available, no errors.',
    mcpDescription: 'List all active preview deployments.',
    inputSchema: listPreviewsSchema,
    execute: (_args, context) => {
      const previews = context.appCtx.previewDeployer.list();
      return Promise.resolve({
        count: previews.length,
        previews: previews.map((preview) => ({
          branch: preview.branch,
          url: preview.url,
          port: preview.port,
          createdAt: preview.createdAt.toISOString(),
        })),
      });
    },
  },
  {
    name: 'get_deploy_status',
    description:
      'Get real-time deployment status for one or all projects currently being built. Shows phase (queued/cloning/building/starting/done/failed), timing, and build progress details. When building, includes current phase and last few lines of build output. When failed, includes error summary and build log tail. Use when user asks "is it done yet?" or "what is building?" during a deploy. Returns { active, jobs[] }. If no deploys are in progress, returns { active: 0, jobs: [] }.',
    mcpDescription:
      'Get real-time deployment status. During build phase, includes build_step, build_step_total, build_step_desc for progress tracking. Poll this tool to monitor deployment progress.',
    inputSchema: deployStatusSchema,
    execute: (args, context) => {
      const appCtx = context.appCtx;
      const projectName = args['project_name'] as string | undefined;

      const formatJob = (job: {
        projectName: string;
        phase: string;
        startedAt: Date;
        errorSummary?: string;
        buildLogTail?: string;
        buildStep?: number;
        buildStepTotal?: number;
        buildStepDesc?: string;
      }) => ({
        name: job.projectName,
        phase: job.phase,
        elapsed: `${String(Math.round((Date.now() - job.startedAt.getTime()) / 1000))}s`,
        error: job.errorSummary,
        ...(job.phase === 'done' ? { urls: getProjectUrls(job.projectName) } : {}),
        ...(job.buildLogTail && (job.phase === 'building' || job.phase === 'failed')
          ? { build_log_tail: job.buildLogTail }
          : {}),
        ...(job.phase === 'building' &&
        job.buildStep !== undefined &&
        job.buildStepTotal !== undefined
          ? {
              build_step: job.buildStep,
              build_step_total: job.buildStepTotal,
              ...(job.buildStepDesc ? { build_step_desc: job.buildStepDesc } : {}),
            }
          : {}),
      });

      if (projectName) {
        const project = appCtx.db.getProjectByName(projectName);
        if (!project) {
          throw new ProjectNotFoundError(projectName);
        }

        const status = appCtx.jobManager.getStatus(project.id);
        const isActive = status && status.phase !== 'done' && status.phase !== 'failed';

        return Promise.resolve({
          active: isActive ? 1 : 0,
          jobs: status ? [formatJob(status)] : [],
        });
      }

      const allJobs = appCtx.jobManager.getStatuses();
      const recentJobs = allJobs.filter(
        (j) =>
          (j.phase !== 'done' && j.phase !== 'failed') ||
          (j.completedAt && Date.now() - j.completedAt.getTime() < 5 * 60 * 1000),
      );
      const activeCount = recentJobs.filter(
        (j) => j.phase !== 'done' && j.phase !== 'failed',
      ).length;

      return Promise.resolve({
        active: activeCount,
        jobs: recentJobs.map(formatJob),
      });
    },
  },
];
