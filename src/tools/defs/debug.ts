import { ProjectNotFoundError } from '../../errors.js';
import type { ToolDef } from './types.js';
import { getBuildLogSchema } from './schemas.js';
import { resolveDeployableTarget } from './deployable-target.js';

function formatLog(
  rawLog: string,
  tail: number | undefined,
): {
  log: string;
  fullLog: boolean;
  returnedChars: number;
  totalChars: number;
  truncated: boolean;
} {
  let log = rawLog;
  if (tail) {
    log = rawLog.split('\n').slice(-tail).join('\n');
  }
  const truncated = log.length < rawLog.length;
  return {
    log,
    fullLog: !truncated,
    returnedChars: log.length,
    totalChars: rawLog.length,
    truncated,
  };
}

export const debugToolDefs: ToolDef[] = [
  {
    name: 'get_build_log',
    riskLevel: 'low',
    description:
      'Get the raw build log for an Application/Compose service, deploy_id, or compatibility Project target. Returns the full unprocessed build output and, when captured, the deployment runtime log so an external MCP agent can analyze failures. Returns { status, build_log, runtime_log, duration_ms, created_at }. Errors: PROJECT_NOT_FOUND, NO_DEPLOY_LOGS.',
    mcpDescription:
      'Get raw Docker build output and captured runtime logs for debugging deploy failures.',
    inputSchema: getBuildLogSchema,
    execute: async (args, { appCtx }) => {
      const deployId = args['deploy_id'] as string | undefined;
      const serviceId = args['service_id'] as string | undefined;
      const serviceName = args['service_name'] as string | undefined;
      const projectId = args['project_id'] as string | undefined;
      const projectName = args['project_name'] as string | undefined;
      const index = (args['deploy_index'] as number | undefined) ?? 0;
      const resolved = deployId
        ? undefined
        : serviceId || serviceName
          ? await resolveDeployableTarget(appCtx, args, 'get_build_log')
          : undefined;
      const project = deployId
        ? undefined
        : resolved
          ? resolved.project
          : projectId
            ? await appCtx.db.getProject(projectId)
            : await appCtx.db.getProjectByName(projectName ?? '');
      if (!deployId && !project) {
        throw new ProjectNotFoundError(projectId ?? projectName ?? serviceId ?? serviceName ?? '');
      }

      const projectDeployables =
        !deployId && !resolved && project && typeof appCtx.db.getDeployablesByGroup === 'function'
          ? await appCtx.db.getDeployablesByGroup(project.id)
          : [];
      const projectTargetService =
        projectDeployables.length === 1 ? projectDeployables[0] : undefined;
      const targetServiceId = resolved?.service.id ?? projectTargetService?.id;

      const log = deployId
        ? await appCtx.db.getDeployLog(deployId)
        : targetServiceId
          ? (await appCtx.db.getDeployLogsForService(targetServiceId, index + 1))[index]
          : project
            ? (await appCtx.db.getDeployLogs(project.id, index + 1))[index]
            : undefined;
      if (!log) {
        const activeJob = resolved
          ? appCtx.jobManager.getStatus(resolved.runtimeProject.id)
          : project
            ? appCtx.jobManager.getStatus(project.id)
            : undefined;
        if (activeJob && activeJob.phase !== 'done' && activeJob.phase !== 'failed') {
          throw new Error(
            `DEPLOY_IN_PROGRESS: Deploy is currently ${activeJob.phase}. Logs will be available after completion.`,
          );
        }
        throw new Error('NO_DEPLOY_LOGS: No deploy logs found.');
      }

      const tail = args['tail'] as number | undefined;
      const build = formatLog(log.build_log ?? 'No build log captured.', tail);
      const runtime = log.runtime_log ? formatLog(log.runtime_log, tail) : undefined;

      return Promise.resolve({
        id: log.id,
        status: log.status,
        build_log: build.log,
        full_log: build.fullLog,
        returned_chars: build.returnedChars,
        total_chars: build.totalChars,
        truncated: build.truncated,
        ...(runtime
          ? {
              runtime_log: runtime.log,
              runtime_full_log: runtime.fullLog,
              runtime_returned_chars: runtime.returnedChars,
              runtime_total_chars: runtime.totalChars,
              runtime_truncated: runtime.truncated,
            }
          : {}),
        duration_ms: log.duration_ms,
        created_at: log.created_at,
      });
    },
  },
];
