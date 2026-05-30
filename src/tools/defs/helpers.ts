import {
  CircuitBreakerOpenError,
  DeployLockedError,
  ProjectArchivedError,
  ProjectNotFoundError,
  ProjectRecoveringError,
} from '../../errors.js';
import type { ProjectRow } from '../../db/index.js';
import { loadServiceViewRecords, serviceViewFromRows } from '../../db/views/service-view.js';
import { assertProjectMutable } from '../../pipeline/mutation-policy.js';
import type { ToolDef } from './types.js';

export type ToolDeployTrigger = 'chat' | 'webhook' | 'api';

const TOOL_DEPLOY_TRIGGERS: Record<Parameters<ToolDef['execute']>[1]['target'], ToolDeployTrigger> =
  {
    agent: 'chat',
    mcp: 'chat',
  };

export function deployTriggerForToolContext(
  context: Parameters<ToolDef['execute']>[1],
): ToolDeployTrigger {
  // deploy_logs only has chat/webhook/api. Both MCP and internal tool calls are
  // non-human tool-originated deploys, and Activity maps `chat` to the MCP actor.
  return TOOL_DEPLOY_TRIGGERS[context.target];
}

export async function getProjectByName(
  appCtx: Parameters<ToolDef['execute']>[1]['appCtx'],
  name: string,
) {
  const project = await appCtx.db.getProjectByName(name);
  if (!project) {
    throw new ProjectNotFoundError(name);
  }
  return project;
}

export async function getProductionEnvironmentId(
  appCtx: Parameters<ToolDef['execute']>[1]['appCtx'],
  projectId: string,
): Promise<string | undefined> {
  const environments = await appCtx.db.getEnvironmentsByProject(projectId);
  return environments.find((e) => e.type === 'production')?.id;
}

export function buildDeployLockedResponse(error: DeployLockedError) {
  return {
    success: false,
    error: 'DEPLOY_LOCKED',
    message: error.message,
    _agent_guidance: {
      message: 'Another deploy is in progress for this project.',
      next_steps: ['Wait 30 seconds and try again', 'Check deploy status with get_deploy_status'],
    },
  };
}

export async function tryAcquireDeployLockOrResponse(
  projectId: string,
  sessionId: string,
  context: Parameters<ToolDef['execute']>[1],
) {
  const locked = await context.appCtx.db.acquireDeployLock(projectId, sessionId);
  if (locked) {
    return null;
  }
  const lockInfo = await context.appCtx.db.getDeployLockInfo(projectId);
  const error = new DeployLockedError(projectId, lockInfo?.session ?? 'unknown');
  return buildDeployLockedResponse(error);
}

/**
 * Mutation-policy rejection response shape used by MCP / agent tools when
 * the pipeline boundary refuses to deploy / redeploy / rollback because the
 * project is archived, recovering, or under an open circuit breaker.
 *
 * Tools that fire-and-forget should call `tryRejectIfNotMutable` BEFORE
 * launching the background task, so users get an immediate clear response
 * instead of a fake "deploying" success.
 */
export function buildPolicyRejectionResponse(
  err: ProjectArchivedError | ProjectRecoveringError | CircuitBreakerOpenError,
  projectName: string,
) {
  return {
    success: false,
    status: 'rejected_by_policy' as const,
    error: err.code,
    project: projectName,
    message: err.message,
    _agent_guidance: {
      message: 'Project state does not allow this operation right now.',
      next_steps: [
        err instanceof ProjectArchivedError
          ? 'Restore the archived service in the web UI first, then retry.'
          : err instanceof ProjectRecoveringError
            ? 'Wait for recovery to complete, then try again.'
            : 'Wait for the circuit breaker cooldown to pass before retrying.',
      ],
    },
  };
}

/**
 * Sync mutation-policy pre-check for tools that intend to fire-and-forget the
 * pipeline call. Returns a typed rejection response when the policy blocks
 * the project; returns `null` otherwise so the caller can proceed.
 *
 * Without this guard, fire-and-forget tools (restart_service,
 * redeploy_app) would tell the user "deploying" while
 * the pipeline silently rejects in the background catch handler.
 */
export async function tryRejectIfNotMutable(
  project: ProjectRow,
  context: Parameters<ToolDef['execute']>[1],
) {
  try {
    const [serviceRecords, circuitOpen] = await Promise.all([
      typeof context.appCtx.db.getServices === 'function'
        ? loadServiceViewRecords(context.appCtx.db, [project])
        : Promise.resolve(
            new Map([
              [
                project.id,
                {
                  project,
                  service: null,
                  view: serviceViewFromRows(project, null),
                },
              ],
            ]),
          ),
      context.appCtx.db.isCircuitBreakerOpen(project.id),
    ]);
    assertProjectMutable(project, {
      db: {
        service: serviceRecords.get(project.id)?.service ?? null,
        isCircuitBreakerOpen: () => circuitOpen,
      },
    });
    return null;
  } catch (err) {
    if (
      err instanceof ProjectArchivedError ||
      err instanceof ProjectRecoveringError ||
      err instanceof CircuitBreakerOpenError
    ) {
      return buildPolicyRejectionResponse(err, project.name);
    }
    throw err;
  }
}
