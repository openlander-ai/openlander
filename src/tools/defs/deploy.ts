import { ProjectNotFoundError } from '../../errors.js';
import type { ToolDef } from './types.js';
import {
  cleanupPreviewSchema,
  deployBlueGreenSchema,
  deployProjectSchema,
  deployStatusSchema,
  listPreviewsSchema,
  previewDeploySchema,
  redeployProjectSchema,
  rollbackProjectSchema,
} from './schemas.js';

export const deployToolDefs: ToolDef[] = [
  {
    name: 'deploy_project',
    description:
      'Start deploying a project from a git repository URL. Returns immediately with { projectId, projectName, status: "building" } while the build runs in the background. ALWAYS follow up with get_deploy_status to check progress and report the result to the user. Errors: CLONE_FAILED (bad URL or private repo without SSH key), BUILD_FAILED (Dockerfile error — suggest debug_build_error next), ALREADY_EXISTS (project name taken). Only works with repos that have a Dockerfile.',
    mcpDescription:
      'Start deploying a project from a git repository URL. Returns immediately while build runs in background.',
    inputSchema: deployProjectSchema,
    execute: async (args, context) => {
      const appCtx = context.appCtx;
      const result = await appCtx.pipeline.startDeploy({
        repoUrl: args['repo_url'] as string,
        branch: (args['branch'] as string | undefined) ?? undefined,
        name: (args['name'] as string | undefined) ?? undefined,
        dockerfilePath: (args['dockerfile_path'] as string | undefined) ?? undefined,
        preferDockerfile: (args['prefer_dockerfile'] as boolean | undefined) ?? undefined,
        sshKeyPath: appCtx.config.git.sshKeyPath || undefined,
        trigger: context.target === 'agent' ? 'chat' : 'api',
      });

      if (context.target === 'mcp' && result.status === 'preflight_failed') {
        return {
          ...result,
          error: result.preflightError,
          hint: 'Fix the preflight issues and try again.',
        };
      }

      return { ...result, hint: 'Use get_deploy_status to check progress.' };
    },
  },
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
    name: 'redeploy_project',
    description: 'Redeploy an existing project.',
    mcpDescription: 'Redeploy an existing project.',
    inputSchema: redeployProjectSchema,
    execute: async (args, context) => {
      const projectName = args['project_name'] as string;
      const project = context.appCtx.db.getProjectByName(projectName);
      if (!project) {
        throw new ProjectNotFoundError(projectName);
      }
      return context.appCtx.pipeline.redeploy(project.id);
    },
    targets: ['mcp'],
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
      'Get real-time deployment status for one or all projects currently being built. Shows phase (queued/cloning/building/starting/done/failed) and timing. Use when user asks "is it done yet?" or "what is building?" during a deploy. Returns { active, jobs[] }. If no deploys are in progress, returns { active: 0, jobs: [] }.',
    mcpDescription: 'Get real-time deployment status for active builds.',
    inputSchema: deployStatusSchema,
    execute: (args, context) => {
      const appCtx = context.appCtx;
      const projectName = args['project_name'] as string | undefined;

      if (projectName) {
        const project = appCtx.db.getProjectByName(projectName);
        if (!project) {
          throw new ProjectNotFoundError(projectName);
        }

        const status = appCtx.jobManager.getStatus(project.id);
        const isActive = status && status.phase !== 'done' && status.phase !== 'failed';

        if (context.target === 'mcp') {
          return Promise.resolve({
            active: isActive ? 1 : 0,
            jobs: status ? [{ name: projectName, phase: status.phase }] : [],
          });
        }

        return Promise.resolve({
          active: isActive ? 1 : 0,
          jobs: status
            ? [
                {
                  name: projectName,
                  phase: status.phase,
                  elapsed: `${String(Math.round((Date.now() - status.startedAt.getTime()) / 1000))}s`,
                  error: status.errorSummary,
                },
              ]
            : [],
        });
      }

      const jobs = appCtx.jobManager.getActiveJobs();
      if (context.target === 'mcp') {
        return Promise.resolve({
          active: jobs.length,
          jobs: jobs.map((job) => ({ name: job.projectName, phase: job.phase })),
        });
      }

      return Promise.resolve({
        active: jobs.length,
        jobs: jobs.map((job) => ({
          name: job.projectName,
          phase: job.phase,
          elapsed: `${String(Math.round((Date.now() - job.startedAt.getTime()) / 1000))}s`,
          error: job.errorSummary,
        })),
      });
    },
  },
];
