import { apiGet, apiPatch } from './client';

export type DestructiveActionPermission = 'allow' | 'approval_required' | 'block';
export type DatabaseAccessPermission = 'allow' | 'block';
export type OperationPermissionSource = 'global' | 'project' | 'service';
export type OperationPermissionScope = OperationPermissionSource;

export interface OperationPermissionValues {
  destructive_actions: DestructiveActionPermission;
  database_access: DatabaseAccessPermission;
}

export interface OperationPermissionOverride {
  destructive_actions?: DestructiveActionPermission;
  database_access?: DatabaseAccessPermission;
}

export interface OperationPermissionSnapshot {
  global: OperationPermissionValues;
  project_override: OperationPermissionOverride | null;
  service_override: OperationPermissionOverride | null;
  effective: OperationPermissionValues;
  sources: {
    destructive_actions: OperationPermissionSource;
    database_access: OperationPermissionSource;
  };
}

export interface OperationPermissionResponse {
  scope: OperationPermissionScope;
  project_id?: string | null;
  service_id?: string;
  permissions: OperationPermissionSnapshot;
}

export interface OperationPermissionPatch {
  destructive_actions?: DestructiveActionPermission | null;
  database_access?: DatabaseAccessPermission | null;
}

function permissionPath(scope: OperationPermissionScope, id?: string): string {
  if (scope === 'global') return '/api/security/permissions';
  if (!id) throw new Error(`A ${scope} id is required for operation permissions.`);
  return scope === 'project'
    ? `/api/projects/${id}/security/permissions`
    : `/api/services/${id}/security/permissions`;
}

export function getOperationPermissions(
  scope: OperationPermissionScope,
  id?: string,
): Promise<OperationPermissionResponse> {
  return apiGet<OperationPermissionResponse>(permissionPath(scope, id));
}

export function updateOperationPermissions(
  scope: OperationPermissionScope,
  patch: OperationPermissionPatch,
  id?: string,
): Promise<OperationPermissionResponse> {
  return apiPatch<OperationPermissionResponse>(permissionPath(scope, id), patch);
}
