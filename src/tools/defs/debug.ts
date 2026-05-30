import { ProjectNotFoundError } from '../../errors.js';
import type { ToolDef } from './types.js';
import { getBuildLogSchema } from './schemas.js';

export const debugToolDefs: ToolDef[] = [
  {
    name: 'get_build_log',
    riskLevel: 'low',
    description:
      'Get the raw build log for a project deployment. Returns the full unprocessed build output so an external MCP agent can analyze failures. Returns { status, build_log, duration_ms, created_at }. Errors: PROJECT_NOT_FOUND, NO_DEPLOY_LOGS.',
    mcpDescription: 'Get raw Docker build output for debugging build failures.',
    inputSchema: getBuildLogSchema,
    execute: async (args, { appCtx }) => {
      const deployId = args['deploy_id'] as string | undefined;
      const projectId = args['project_id'] as string | undefined;
      const projectName = args['project_name'] as string | undefined;
      const index = (args['deploy_index'] as number | undefined) ?? 0;
      const project = deployId
        ? undefined
        : projectId
          ? await appCtx.db.getProject(projectId)
          : await appCtx.db.getProjectByName(projectName ?? '');
      if (!deployId && !project) throw new ProjectNotFoundError(projectId ?? projectName ?? '');

      const log = deployId
        ? await appCtx.db.getDeployLog(deployId)
        : project
          ? (await appCtx.db.getDeployLogs(project.id, index + 1))[index]
          : undefined;
      if (!log) {
        const activeJob = project ? appCtx.jobManager.getStatus(project.id) : undefined;
        if (activeJob && activeJob.phase !== 'done' && activeJob.phase !== 'failed') {
          throw new Error(
            `DEPLOY_IN_PROGRESS: Deploy is currently ${activeJob.phase}. Logs will be available after completion.`,
          );
        }
        throw new Error('NO_DEPLOY_LOGS: No deploy logs found.');
      }

      const rawBuildLog = log.build_log ?? 'No build log captured.';
      let buildLog = rawBuildLog;
      const tail = args['tail'] as number | undefined;
      if (tail && log.build_log) {
        const lines = log.build_log.split('\n');
        buildLog = lines.slice(-tail).join('\n');
      }
      const truncated = buildLog.length < rawBuildLog.length;

      return Promise.resolve({
        id: log.id,
        status: log.status,
        build_log: buildLog,
        full_log: !truncated,
        returned_chars: buildLog.length,
        total_chars: rawBuildLog.length,
        truncated,
        duration_ms: log.duration_ms,
        created_at: log.created_at,
      });
    },
  },
];
