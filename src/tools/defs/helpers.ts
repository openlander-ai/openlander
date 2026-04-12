import { DeployLockedError, ProjectNotFoundError } from '../../errors.js';
import type { ToolDef } from './types.js';

export function getProjectByName(
  appCtx: Parameters<ToolDef['execute']>[1]['appCtx'],
  name: string,
) {
  const project = appCtx.db.getProjectByName(name);
  if (!project) {
    throw new ProjectNotFoundError(name);
  }
  return project;
}

export function getProductionEnvironmentId(
  appCtx: Parameters<ToolDef['execute']>[1]['appCtx'],
  projectId: string,
): string | undefined {
  return appCtx.db.getEnvironmentsByProject(projectId).find((e) => e.type === 'production')?.id;
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

export function tryAcquireDeployLockOrResponse(
  projectId: string,
  sessionId: string,
  context: Parameters<ToolDef['execute']>[1],
) {
  const locked = context.appCtx.db.acquireDeployLock(projectId, sessionId);
  if (locked) {
    return null;
  }
  const lockInfo = context.appCtx.db.getDeployLockInfo(projectId);
  const error = new DeployLockedError(projectId, lockInfo?.session ?? 'unknown');
  return buildDeployLockedResponse(error);
}
