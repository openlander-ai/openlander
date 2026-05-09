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
];
