import { ProjectNotFoundError } from '../../errors.js';
import type { ToolDef } from './types.js';
import { debugBuildErrorSchema, getBuildLogSchema } from './schemas.js';

export const debugToolDefs: ToolDef[] = [
  {
    name: 'get_build_log',
    description:
      'Get the raw build log for a project deployment. Returns the full unprocessed build output. Use this instead of debug_build_error when you need to parse the log yourself. Returns { status, build_log, duration_ms, created_at }. Errors: PROJECT_NOT_FOUND, NO_DEPLOY_LOGS.',
    inputSchema: getBuildLogSchema,
    execute: (args, { appCtx }) => {
      const projectName = args['project_name'] as string;
      const project = appCtx.db.getProjectByName(projectName);
      if (!project) throw new ProjectNotFoundError(projectName);

      const index = (args['deploy_index'] as number | undefined) ?? 0;
      const logs = appCtx.db.getDeployLogs(project.id, index + 1);
      const log = logs[index];
      if (!log) {
        return Promise.resolve({ error: 'NO_DEPLOY_LOGS', message: 'No deploy logs found.' });
      }

      return Promise.resolve({
        status: log.status,
        build_log: log.build_log ?? 'No build log captured.',
        duration_ms: log.duration_ms,
        created_at: log.created_at,
      });
    },
  },
  {
    name: 'debug_build_error',
    description:
      'Analyze a failed build and suggest fixes using AI. Matches against known error patterns first (fast), then uses LLM analysis (thorough). Use when a deploy_project call failed or user reports a build error. Returns { summary, rootCause, suggestedFixes[] }. Errors: PROJECT_NOT_FOUND, NO_FAILED_BUILD if the last deploy succeeded, NO_LLM if build debugger is not configured.',
    inputSchema: debugBuildErrorSchema,
    execute: async (args, { target, appCtx }) => {
      if (!appCtx.buildDebugger) {
        return {
          error:
            target === 'agent'
              ? 'Build debugger requires an LLM provider. Configure one first.'
              : 'Build debugger requires an LLM provider.',
        };
      }

      const projectName = args['project_name'] as string;
      const project = appCtx.db.getProjectByName(projectName);
      if (!project) {
        throw new ProjectNotFoundError(projectName);
      }

      const lastDeploy = appCtx.db.getLastDeployLog(project.id);
      if (!lastDeploy || lastDeploy.status !== 'failed') {
        return { error: 'No failed build found for this project.' };
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
        imageTag: project.image_tag ?? `openlander/${projectName}:latest`,
        failedStep: 'build',
      });
    },
  },
];
