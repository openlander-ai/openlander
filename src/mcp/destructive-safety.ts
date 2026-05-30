import type { AppContext } from '../app.js';
import type { RequestIdentity } from '../types/identity.js';
import {
  OperationRequiresHumanUiError,
  ProjectNotFoundError,
  ScopeMismatchError,
  ServiceNotFoundError,
} from '../errors.js';
import { MANAGED_SERVICE_KINDS } from '../db/repos/service.repo.js';
import { HUMAN_UI_ONLY_TOOL_SET, APPROVAL_HOLD_TOOL_SET } from './mcp-restricted-actions.js';
import type { ToolContext, ToolDef } from '../tools/defs/types.js';

// Derived from the single policy source (mcp-restricted-actions.ts). Only real
// tool defs land here; deployable/project lifecycle aliases live in that module's
// HUMAN_UI_ONLY_ALIASES and are intercepted by the composite, not blocked here.
const GROUP_A_HUMAN_UI_ONLY = HUMAN_UI_ONLY_TOOL_SET;
const GROUP_B_APPROVAL_HOLD = APPROVAL_HOLD_TOOL_SET;

interface SafetyResult {
  error?: string;
  code?: string;
  message?: string;
  status?: string;
  actionRunId?: string;
  tool?: string;
  projectId?: string;
  details?: Record<string, unknown>;
  _agent_guidance?: Record<string, unknown>;
}

function readString(args: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

async function resolveProjectIdByName(appCtx: AppContext, name: string): Promise<string | null> {
  if (!name) return null;
  const project = (await appCtx.db.getProject(name)) ?? (await appCtx.db.getProjectByName(name));
  if (!project) throw new ProjectNotFoundError(name);
  return project.id;
}

function isManagedKind(kind: string): boolean {
  return (MANAGED_SERVICE_KINDS as readonly string[]).includes(kind);
}

export async function resolveMcpTargetProjectId(
  appCtx: AppContext,
  args: Record<string, unknown>,
  identity?: RequestIdentity,
): Promise<string | null> {
  const explicitProjectId = readString(args, 'project_id', 'target_project_id', 'projectId');
  if (explicitProjectId) return explicitProjectId;

  const projectName = readString(args, 'project_name', 'projectName');
  const serviceId = readString(args, 'service_id', 'serviceId');
  if (serviceId) {
    const service = await appCtx.db.getService(serviceId);
    if (!service) throw new ServiceNotFoundError(serviceId);
    return service.project_id;
  }

  const serviceName = readString(args, 'service_name', 'serviceName');
  if (serviceName) {
    const services = await appCtx.db.listServices();
    const projectScopeId = projectName ? await resolveProjectIdByName(appCtx, projectName) : null;
    const identityScopeProjectId =
      identity?.mcpScopeKind === 'project' ? (identity.mcpScopeProjectId ?? null) : null;
    const scoped = services
      .filter((service) => service.name === serviceName)
      .filter((service) => !projectScopeId || service.project_id === projectScopeId)
      .filter(
        (service) =>
          !identityScopeProjectId ||
          projectScopeId ||
          service.project_id === identityScopeProjectId,
      )
      .filter((service) => !isManagedKind(service.kind));

    if (scoped.length === 1) return scoped[0]?.project_id ?? null;
    if (projectScopeId) return projectScopeId;
    return null;
  }

  if (projectName) return await resolveProjectIdByName(appCtx, projectName);
  return null;
}

export function assertMcpActiveScope(
  _appCtx: AppContext,
  targetProjectId: string | null,
  atExecute = false,
  identity?: RequestIdentity,
): Promise<void> {
  // Scope only: this intentionally does not reject archived lifecycle state.
  // ToolDefs/pipeline own lifecycle mutability so restore actions can target archived services.
  if (!targetProjectId) return Promise.resolve();

  if (identity?.mcpScopeKind === 'project') {
    const tokenScopeProjectId = identity.mcpScopeProjectId ?? null;
    if (!tokenScopeProjectId || tokenScopeProjectId === targetProjectId) {
      return Promise.resolve();
    }
    return Promise.reject(new ScopeMismatchError(tokenScopeProjectId, targetProjectId, atExecute));
  }

  // v0.1 retracted the Active Project chip. Keep the DB column cold for v0.2,
  // but do not let stale upgraded rows pin org-scoped tokens invisibly.
  return Promise.resolve();
}

function buildHumanUiOnlyResponse(toolName: string): SafetyResult {
  const error = new OperationRequiresHumanUiError(toolName);
  const target =
    toolName === 'cleanup_docker'
      ? 'OpenLander web UI host cleanup or an operator-run maintenance workflow'
      : 'the OpenLander web UI typed-confirm flow for that project, service, volume, or bucket';
  return {
    error: error.code,
    code: error.code,
    message: error.message,
    details: error.details,
    _agent_guidance: {
      message: `This destructive operation is intentionally blocked from MCP in OpenLander 0.1. Tell the user to use ${target}; do not substitute another MCP cleanup or removal tool.`,
    },
  };
}

function isAllowedMcpPreview(def: ToolDef, args: Record<string, unknown>): boolean {
  // Keep this narrow: only read-only previews may bypass the human-UI-only MCP gate.
  if (def.name !== 'platform_cleanup_orphans') return false;
  return args['dry_run'] !== false;
}

export async function maybeHandleMcpSafety(
  def: ToolDef,
  args: Record<string, unknown>,
  context: ToolContext,
): Promise<SafetyResult | undefined> {
  if (context.target !== 'mcp') return undefined;

  const targetProjectId = await resolveMcpTargetProjectId(context.appCtx, args, context.identity);
  await assertMcpActiveScope(context.appCtx, targetProjectId, false, context.identity);

  if (GROUP_A_HUMAN_UI_ONLY.has(def.name) && !isAllowedMcpPreview(def, args)) {
    return buildHumanUiOnlyResponse(def.name);
  }

  const shouldHold =
    def.name === 'archive_service' ||
    def.name === 'unarchive_service' ||
    def.name === 'remove_secret_file' ||
    (def.name === 'bulk_delete_env_vars' && args['confirm'] === true);
  if (!GROUP_B_APPROVAL_HOLD.has(def.name) || !shouldHold) return undefined;

  const plan = {
    type: 'destructive_mcp',
    tool: def.name,
    args,
    targetProjectId,
    identity: context.identity
      ? {
          source: context.identity.source,
          initiatedBy: context.identity.initiatedBy,
          mcpTokenId: context.identity.mcpTokenId,
          mcpTokenType: context.identity.mcpTokenType,
          mcpScopeKind: context.identity.mcpScopeKind,
          mcpScopeProjectId: context.identity.mcpScopeProjectId,
        }
      : undefined,
    requestedAt: new Date().toISOString(),
  };
  const actionRunId = await context.appCtx.db.createPendingMcpApproval({
    projectId: targetProjectId ?? '',
    toolName: def.name,
    plan: JSON.stringify(plan),
  });

  return {
    status: 'pending_approval',
    actionRunId,
    tool: def.name,
    projectId: targetProjectId ?? undefined,
    _agent_guidance: {
      message:
        'This destructive MCP action is waiting for human approval. Poll mcp_action_status with the returned actionRunId.',
    },
  };
}

export function isGroupBMcpHoldTool(toolName: string): boolean {
  return GROUP_B_APPROVAL_HOLD.has(toolName);
}
