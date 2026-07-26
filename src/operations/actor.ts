import type { ToolContext } from '../tools/defs/types.js';
import type { ApplicationOperationActor } from './types.js';

export function applicationOperationActorFromToolContext(
  context: ToolContext,
): ApplicationOperationActor {
  const identity = context.identity;
  const instanceId = context.appCtx.config.mcp.instanceId?.trim() || 'unconfigured-instance';
  if (identity?.mcpScopeKind === 'project') {
    return {
      source: 'mcp',
      scope: 'project',
      instanceId,
      projectId: identity.mcpScopeProjectId ?? undefined,
      label: identity.initiatedBy ?? 'project-scoped-agent',
    };
  }
  if (identity?.mcpScopeKind === 'service') {
    return {
      source: 'mcp',
      scope: 'service',
      instanceId,
      projectId: identity.mcpScopeProjectId ?? undefined,
      serviceId: identity.mcpScopeServiceId ?? undefined,
      label: identity.initiatedBy ?? 'service-scoped-agent',
    };
  }
  return {
    source: 'mcp',
    scope: 'org',
    instanceId,
    label: identity?.initiatedBy ?? 'instance-agent',
  };
}

export function applicationOperationActorForRest(input: {
  instanceId: string;
  authKind: 'session' | 'api_token';
}): ApplicationOperationActor {
  return {
    source: input.authKind === 'session' ? 'web' : 'rest',
    scope: 'instance',
    instanceId: input.instanceId,
    label: input.authKind === 'session' ? 'web-session' : 'api-token',
  };
}

export function applicationOperationActorScopeKey(actor: ApplicationOperationActor): string {
  if (actor.scope === 'service') return `service:${actor.serviceId ?? 'missing'}`;
  if (actor.scope === 'project') return `project:${actor.projectId ?? 'missing'}`;
  return `instance:${actor.instanceId}`;
}
