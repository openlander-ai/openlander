import type { AppContext } from '../app.js';
import { MANAGED_SERVICE_KINDS } from '../db/repos/service.repo.js';
import type { ProjectRow, ServiceRow } from '../db/types.js';
import { ProjectNotFoundError, ScopeViolationError, ServiceNotFoundError } from '../errors.js';
import type { RequestIdentity } from '../types/identity.js';
import type { ToolContext, ToolDef } from '../tools/defs/types.js';

interface ScopeTarget {
  projectId: string | null;
  serviceId: string | null;
  resolvedFrom: string;
}

interface ScopeRejection {
  error: 'SCOPE_VIOLATION';
  code: 'SCOPE_VIOLATION';
  message: string;
  details: Record<string, unknown>;
  _agent_guidance: {
    message: string;
    next_steps: string[];
  };
}

const TARGETLESS_SCOPED_ACTION_ALLOWLIST = new Set(['get_instance_info', 'list_projects']);

function readString(args: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function isManagedKind(kind: string): boolean {
  return (MANAGED_SERVICE_KINDS as readonly string[]).includes(kind);
}

function isScopedIdentity(identity: RequestIdentity | undefined): boolean {
  return identity?.mcpScopeKind === 'project' || identity?.mcpScopeKind === 'service';
}

function identityScopeDetails(identity: RequestIdentity): Record<string, unknown> {
  return {
    tokenScopeKind: identity.mcpScopeKind ?? null,
    tokenScopeProjectId: identity.mcpScopeProjectId ?? null,
    tokenScopeServiceId: identity.mcpScopeServiceId ?? null,
  };
}

async function resolveProjectIdByName(appCtx: AppContext, name: string): Promise<string | null> {
  if (!name) return null;
  const project = (await appCtx.db.getProject(name)) ?? (await appCtx.db.getProjectByName(name));
  if (!project) throw new ProjectNotFoundError(name);
  return project.id;
}

function matchesServiceAlias(service: ServiceRow, value: string): boolean {
  const normalized = value.replace(/^\//, '').trim();
  return (
    service.id === value ||
    service.name === value ||
    service.container_id === value ||
    service.container_name === normalized
  );
}

async function targetFromService(
  appCtx: AppContext,
  serviceId: string,
  resolvedFrom = 'service_id',
): Promise<ScopeTarget> {
  const service = await appCtx.db.getService(serviceId);
  if (!service) throw new ServiceNotFoundError(serviceId);
  return { projectId: service.project_id, serviceId: service.id, resolvedFrom };
}

async function targetFromServiceName(
  appCtx: AppContext,
  serviceName: string,
  projectName: string,
  identity?: RequestIdentity,
): Promise<ScopeTarget | null> {
  const identityServiceId =
    identity?.mcpScopeKind === 'service' ? (identity.mcpScopeServiceId ?? null) : null;
  if (identityServiceId && !projectName) {
    const service = await appCtx.db.getService(identityServiceId);
    if (service && !isManagedKind(service.kind) && matchesServiceAlias(service, serviceName)) {
      return {
        projectId: service.project_id,
        serviceId: service.id,
        resolvedFrom: 'token_service',
      };
    }
  }

  const projectScopeId = projectName ? await resolveProjectIdByName(appCtx, projectName) : null;
  const services = await appCtx.db.listServices();
  const matches = services
    .filter((service) => !isManagedKind(service.kind))
    .filter((service) => matchesServiceAlias(service, serviceName))
    .filter((service) => !projectScopeId || service.project_id === projectScopeId);

  if (matches.length === 1 && matches[0]) {
    return {
      projectId: matches[0].project_id,
      serviceId: matches[0].id,
      resolvedFrom: projectScopeId ? 'service_name_project_scope' : 'service_name',
    };
  }
  if (projectScopeId)
    return { projectId: projectScopeId, serviceId: null, resolvedFrom: 'project_name' };
  return null;
}

async function targetFromDeployId(
  appCtx: AppContext,
  deployId: string,
): Promise<ScopeTarget | null> {
  const deploy = await appCtx.db.getDeployLog(deployId);
  if (!deploy) return null;
  return targetFromService(appCtx, deploy.service_id, 'deploy_id');
}

async function targetFromBriefingId(
  appCtx: AppContext,
  briefingId: string,
  identity?: RequestIdentity,
): Promise<ScopeTarget | null> {
  const briefing = await appCtx.db.getAiOpsBriefing(briefingId);
  if (!briefing) return null;
  if (!briefing.service_id && identity?.mcpScopeKind === 'service' && identity.mcpScopeServiceId) {
    const service = await appCtx.db.getService(identity.mcpScopeServiceId);
    if (service?.project_id === briefing.project_id) {
      return {
        projectId: briefing.project_id,
        serviceId: service.id,
        resolvedFrom: 'briefing_project_scope',
      };
    }
  }
  return {
    projectId: briefing.project_id,
    serviceId: briefing.service_id,
    resolvedFrom: 'briefing_id',
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readRecordString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function parseJsonRecord(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    return asRecord(JSON.parse(value) as unknown);
  } catch {
    return null;
  }
}

async function targetFromActionRunId(
  appCtx: AppContext,
  actionRunId: string,
): Promise<ScopeTarget | null> {
  const run = await appCtx.db.getActionRun(actionRunId);
  if (!run) return null;
  const plan = parseJsonRecord(run.plan);
  if (plan) {
    const targetServiceId = readRecordString(plan, 'targetServiceId');
    if (targetServiceId) return targetFromService(appCtx, targetServiceId, 'action_run_id');

    const args = asRecord(plan['args']);
    const serviceId = args ? readString(args, 'service_id', 'serviceId') : '';
    if (serviceId) return targetFromService(appCtx, serviceId, 'action_run_id');

    const targetProjectId = readRecordString(plan, 'targetProjectId');
    if (targetProjectId) {
      return { projectId: targetProjectId, serviceId: null, resolvedFrom: 'action_run_id' };
    }
  }
  return { projectId: run.project_id || null, serviceId: null, resolvedFrom: 'action_run_id' };
}

export async function resolveMcpTargetProjectId(
  appCtx: AppContext,
  args: Record<string, unknown>,
  identity?: RequestIdentity,
): Promise<string | null> {
  const target = await resolveMcpScopeTarget(appCtx, args, identity);
  return target?.projectId ?? null;
}

export async function resolveMcpScopeTarget(
  appCtx: AppContext,
  args: Record<string, unknown>,
  identity?: RequestIdentity,
): Promise<ScopeTarget | null> {
  const targets = await resolveMcpScopeTargets(appCtx, args, identity);
  return targets[0] ?? null;
}

async function resolveMcpScopeTargets(
  appCtx: AppContext,
  args: Record<string, unknown>,
  identity?: RequestIdentity,
): Promise<ScopeTarget[]> {
  const targets: ScopeTarget[] = [];
  const push = (target: ScopeTarget | null): void => {
    if (target) targets.push(target);
  };

  const deployId = readString(args, 'deploy_id', 'job_id');
  if (deployId) push(await targetFromDeployId(appCtx, deployId));

  const briefingId = readString(args, 'briefing_id');
  if (briefingId) push(await targetFromBriefingId(appCtx, briefingId, identity));

  const actionRunId = readString(args, 'action_run_id', 'action_id', 'actionRunId');
  if (actionRunId) push(await targetFromActionRunId(appCtx, actionRunId));

  const serviceId = readString(args, 'service_id', 'serviceId');
  if (serviceId) push(await targetFromService(appCtx, serviceId));

  const projectId = readString(args, 'project_id', 'target_project_id', 'projectId');
  const projectName = readString(args, 'project_name', 'projectName');
  const serviceName = readString(args, 'service_name', 'serviceName', 'container_name');
  if (serviceName)
    push(await targetFromServiceName(appCtx, serviceName, projectId || projectName, identity));

  if (projectId) push({ projectId, serviceId: null, resolvedFrom: 'project_id' });
  if (projectName) {
    push({
      projectId: await resolveProjectIdByName(appCtx, projectName),
      serviceId: null,
      resolvedFrom: 'project_name',
    });
  }

  return targets;
}

function buildScopeViolationResponse(
  identity: RequestIdentity,
  target: ScopeTarget | null,
  reason: string,
): ScopeRejection {
  const details = {
    ...identityScopeDetails(identity),
    targetProjectId: target?.projectId ?? null,
    targetServiceId: target?.serviceId ?? null,
    resolvedFrom: target?.resolvedFrom ?? null,
    reason,
  };
  return {
    error: 'SCOPE_VIOLATION',
    code: 'SCOPE_VIOLATION',
    message: 'MCP token scope does not allow this action target.',
    details,
    _agent_guidance: {
      message:
        'This MCP token is scoped. Retry with an explicit target inside that scope, or use an instance-wide token for cross-project or host-level operations.',
      next_steps:
        identity.mcpScopeKind === 'service'
          ? [
              'Retry with the scoped service_id.',
              'Do not inspect sibling services with this token.',
            ]
          : [
              'Retry with the scoped project_id.',
              'Use an instance-wide token for global operations.',
            ],
    },
  };
}

export async function maybeRejectMcpScope(
  def: ToolDef,
  args: Record<string, unknown>,
  context: ToolContext,
): Promise<ScopeRejection | undefined> {
  if (context.target !== 'mcp' || !isScopedIdentity(context.identity)) return undefined;
  const identity = context.identity;
  if (!identity) return undefined;

  if (TARGETLESS_SCOPED_ACTION_ALLOWLIST.has(def.name)) return undefined;

  const targets = await resolveMcpScopeTargets(context.appCtx, args, identity);
  if (targets.length === 0) {
    return buildScopeViolationResponse(identity, null, 'target_required');
  }

  for (const target of targets) {
    if (!target.projectId) {
      return buildScopeViolationResponse(identity, target, 'target_required');
    }

    if (identity.mcpScopeKind === 'project') {
      const tokenProjectId = identity.mcpScopeProjectId ?? null;
      if (tokenProjectId && tokenProjectId === target.projectId) continue;
      return buildScopeViolationResponse(identity, target, 'project_mismatch');
    }

    const tokenServiceId = identity.mcpScopeServiceId ?? null;
    if (tokenServiceId && target.serviceId === tokenServiceId) continue;
    return buildScopeViolationResponse(identity, target, 'service_mismatch');
  }

  return undefined;
}

export function assertMcpActiveScope(
  _appCtx: AppContext,
  targetProjectId: string | null,
  atExecute = false,
  identity?: RequestIdentity,
  targetServiceId?: string | null,
): Promise<void> {
  if (!targetProjectId || !identity || !isScopedIdentity(identity)) return Promise.resolve();

  if (identity.mcpScopeKind === 'project') {
    const tokenProjectId = identity.mcpScopeProjectId ?? null;
    if (tokenProjectId && tokenProjectId === targetProjectId) return Promise.resolve();
    return Promise.reject(
      new ScopeViolationError(
        'MCP token project scope does not match the target project.',
        {
          ...identityScopeDetails(identity),
          targetProjectId,
          reason: 'project_mismatch',
        },
        atExecute,
      ),
    );
  }

  if (identity.mcpScopeKind === 'service') {
    const tokenServiceId = identity.mcpScopeServiceId ?? null;
    if (tokenServiceId && tokenServiceId === targetServiceId) return Promise.resolve();
  }

  return Promise.reject(
    new ScopeViolationError(
      'MCP token service scope requires the exact scoped service target.',
      {
        ...identityScopeDetails(identity),
        targetProjectId,
        reason: 'service_target_required',
      },
      atExecute,
    ),
  );
}

export function projectVisibleToMcpScope(
  project: ProjectRow,
  deployables: ServiceRow[],
  identity?: RequestIdentity,
): boolean {
  if (!isScopedIdentity(identity)) return true;
  if (identity?.mcpScopeKind === 'project') return project.id === identity.mcpScopeProjectId;
  return deployables.some((service) => service.id === identity?.mcpScopeServiceId);
}

export function filterDeployablesForMcpScope(
  deployables: ServiceRow[],
  identity?: RequestIdentity,
): ServiceRow[] {
  if (identity?.mcpScopeKind !== 'service') return deployables;
  return deployables.filter((service) => service.id === identity.mcpScopeServiceId);
}
