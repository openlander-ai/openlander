import { ProjectNotFoundError } from '../../errors.js';
import type { ToolDef } from './types.js';
import { debugBuildErrorSchema, getBuildLogSchema } from './schemas.js';

export const debugToolDefs: ToolDef[] = [
  {
    name: 'get_build_log',
    riskLevel: 'low',
    description:
      'Get the raw build log for a project deployment. Returns the full unprocessed build output. Use this instead of debug_build_error when you need to parse the log yourself. Returns { status, build_log, duration_ms, created_at }. Errors: PROJECT_NOT_FOUND, NO_DEPLOY_LOGS.',
    mcpDescription: 'Get raw Docker build output for debugging build failures.',
    inputSchema: getBuildLogSchema,
    execute: async (args, { appCtx }) => {
      const projectName = args['project_name'] as string;
      const project = await appCtx.db.getProjectByName(projectName);
      if (!project) throw new ProjectNotFoundError(projectName);

      const index = (args['deploy_index'] as number | undefined) ?? 0;
      const logs = await appCtx.db.getDeployLogs(project.id, index + 1);
      const log = logs[index];
      if (!log) {
        const activeJob = appCtx.jobManager.getStatus(project.id);
        if (activeJob && activeJob.phase !== 'done' && activeJob.phase !== 'failed') {
          throw new Error(
            `DEPLOY_IN_PROGRESS: Deploy is currently ${activeJob.phase}. Logs will be available after completion.`,
          );
        }
        throw new Error('NO_DEPLOY_LOGS: No deploy logs found.');
      }

      let buildLog = log.build_log ?? 'No build log captured.';
      const tail = args['tail'] as number | undefined;
      if (tail && log.build_log) {
        const lines = log.build_log.split('\n');
        buildLog = lines.slice(-tail).join('\n');
      }

      return Promise.resolve({
        status: log.status,
        build_log: buildLog,
        duration_ms: log.duration_ms,
        created_at: log.created_at,
      });
    },
  },
  {
    name: 'debug_build_error',
    riskLevel: 'low',
    description:
      'Analyze a failed build and suggest fixes using AI. Matches against known error patterns first (fast), then uses LLM analysis (thorough). Use when a deployment failed or user reports a build error. Returns { summary, rootCause, suggestedFixes[] }. Errors: PROJECT_NOT_FOUND, NO_FAILED_BUILD if the last deploy succeeded, NO_LLM if build debugger is not configured.',
    mcpDescription: 'Analyze build errors with actionable fix suggestions.',
    inputSchema: debugBuildErrorSchema,
    execute: async (args, { target, appCtx }) => {
      if (!appCtx.buildDebugger) {
        throw new Error(
          target === 'agent'
            ? 'Build debugger requires an LLM provider. Configure one first.'
            : 'Build debugger requires an LLM provider.',
        );
      }

      const projectName = args['project_name'] as string;
      const project = await appCtx.db.getProjectByName(projectName);
      if (!project) {
        throw new ProjectNotFoundError(projectName);
      }

      const lastDeploy = await appCtx.db.getLastDeployLog(project.id);
      if (!lastDeploy || lastDeploy.status !== 'failed') {
        throw new Error('No failed build found for this project.');
      }

      const inputBuildLog = (args['build_log'] as string | undefined) ?? undefined;
      const deployErrorValue = (lastDeploy as unknown as Record<string, unknown>)['error'];
      const deployError = typeof deployErrorValue === 'string' ? deployErrorValue.trim() : '';
      const buildLog =
        inputBuildLog?.trim() ||
        lastDeploy.build_log?.trim() ||
        deployError ||
        'No build log available';

      return appCtx.buildDebugger.diagnose({
        buildLog,
        projectName,
        // PR 4.5: canonical-first read of image_tag with `??` fallback.
        imageTag:
          (await appCtx.db.getDeployableForProject(project.id))?.image_tag ??
          project.image_tag ??
          `openlander/${projectName}:latest`,
        failedStep: 'build',
      });
    },
  },
];
