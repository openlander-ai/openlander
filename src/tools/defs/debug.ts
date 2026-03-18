import { ProjectNotFoundError } from '../../errors.js';
import type { ToolDef } from './types.js';
import { debugBuildErrorSchema } from './schemas.js';

export const debugToolDefs: ToolDef[] = [
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
