import {
  OperationPermissionConfigurationError,
  OperationPermissionDeniedError,
} from '../errors.js';

export type DestructiveActionPermission = 'allow' | 'approval_required' | 'block';
export type DatabaseAccessPermission = 'allow' | 'block';
export type OperationPermissionSource = 'global' | 'project' | 'service';

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

interface PermissionSettingStore {
  getSetting?(key: string): Promise<{ value: string } | null>;
  upsertSetting?(key: string, value: string): Promise<void>;
  deleteSetting?(key: string): Promise<boolean>;
}

export interface OperationPermissionTarget {
  projectId?: string | null;
  serviceId?: string | null;
}

export const DEFAULT_OPERATION_PERMISSIONS: OperationPermissionValues = {
  destructive_actions: 'allow',
  database_access: 'allow',
};

const GLOBAL_SETTING_KEY = 'security.operation_permissions.global';

function projectSettingKey(projectId: string): string {
  return `security.operation_permissions.project.${projectId}`;
}

function serviceSettingKey(serviceId: string): string {
  return `security.operation_permissions.service.${serviceId}`;
}

function isDestructivePermission(value: unknown): value is DestructiveActionPermission {
  return value === 'allow' || value === 'approval_required' || value === 'block';
}

function isDatabasePermission(value: unknown): value is DatabaseAccessPermission {
  return value === 'allow' || value === 'block';
}

function parseStoredOverride(key: string, value: string): OperationPermissionOverride {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch (cause) {
    throw new OperationPermissionConfigurationError(key, { cause: String(cause) });
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new OperationPermissionConfigurationError(key);
  }

  const record = parsed as Record<string, unknown>;
  const override: OperationPermissionOverride = {};
  if (record['destructive_actions'] !== undefined) {
    if (!isDestructivePermission(record['destructive_actions'])) {
      throw new OperationPermissionConfigurationError(key);
    }
    override.destructive_actions = record['destructive_actions'];
  }
  if (record['database_access'] !== undefined) {
    if (!isDatabasePermission(record['database_access'])) {
      throw new OperationPermissionConfigurationError(key);
    }
    override.database_access = record['database_access'];
  }
  return override;
}

async function readOverride(
  store: PermissionSettingStore,
  key: string,
): Promise<OperationPermissionOverride | null> {
  if (!store.getSetting) return null;
  const row = await store.getSetting(key);
  return row ? parseStoredOverride(key, row.value) : null;
}

function applyOverride(
  current: OperationPermissionValues,
  sources: OperationPermissionSnapshot['sources'],
  override: OperationPermissionOverride | null,
  source: OperationPermissionSource,
): void {
  if (!override) return;
  if (override.destructive_actions !== undefined) {
    current.destructive_actions = override.destructive_actions;
    sources.destructive_actions = source;
  }
  if (override.database_access !== undefined) {
    current.database_access = override.database_access;
    sources.database_access = source;
  }
}

export async function getOperationPermissionSnapshot(
  store: PermissionSettingStore,
  target: OperationPermissionTarget = {},
): Promise<OperationPermissionSnapshot> {
  const [globalOverride, projectOverride, serviceOverride] = await Promise.all([
    readOverride(store, GLOBAL_SETTING_KEY),
    target.projectId ? readOverride(store, projectSettingKey(target.projectId)) : null,
    target.serviceId ? readOverride(store, serviceSettingKey(target.serviceId)) : null,
  ]);

  const global: OperationPermissionValues = {
    ...DEFAULT_OPERATION_PERMISSIONS,
    ...globalOverride,
  };
  const effective = { ...global };
  const sources: OperationPermissionSnapshot['sources'] = {
    destructive_actions: 'global',
    database_access: 'global',
  };
  applyOverride(effective, sources, projectOverride, 'project');
  applyOverride(effective, sources, serviceOverride, 'service');

  return {
    global,
    project_override: projectOverride,
    service_override: serviceOverride,
    effective,
    sources,
  };
}

export async function saveGlobalOperationPermissions(
  store: PermissionSettingStore,
  patch: OperationPermissionOverride,
): Promise<OperationPermissionSnapshot> {
  const current = await getOperationPermissionSnapshot(store);
  const next: OperationPermissionValues = { ...current.global, ...patch };
  if (!store.upsertSetting) throw new OperationPermissionConfigurationError('settings_store');
  await store.upsertSetting(GLOBAL_SETTING_KEY, JSON.stringify(next));
  return await getOperationPermissionSnapshot(store);
}

export async function saveOperationPermissionOverride(
  store: PermissionSettingStore,
  scope: { projectId?: string; serviceId?: string },
  patch: {
    destructive_actions?: DestructiveActionPermission | null;
    database_access?: DatabaseAccessPermission | null;
  },
): Promise<OperationPermissionSnapshot> {
  const key = scope.serviceId
    ? serviceSettingKey(scope.serviceId)
    : scope.projectId
      ? projectSettingKey(scope.projectId)
      : null;
  if (!key) throw new OperationPermissionConfigurationError('missing_scope');

  const existing = (await readOverride(store, key)) ?? {};
  const next: OperationPermissionOverride = { ...existing };
  if ('destructive_actions' in patch) {
    if (patch.destructive_actions === null) delete next.destructive_actions;
    else if (patch.destructive_actions !== undefined) {
      next.destructive_actions = patch.destructive_actions;
    }
  }
  if ('database_access' in patch) {
    if (patch.database_access === null) delete next.database_access;
    else if (patch.database_access !== undefined) next.database_access = patch.database_access;
  }

  if (!store.upsertSetting || !store.deleteSetting) {
    throw new OperationPermissionConfigurationError('settings_store');
  }
  if (Object.keys(next).length === 0) await store.deleteSetting(key);
  else await store.upsertSetting(key, JSON.stringify(next));

  return await getOperationPermissionSnapshot(store, scope);
}

export async function assertDestructiveActionAllowed(
  store: PermissionSettingStore,
  target: OperationPermissionTarget,
): Promise<OperationPermissionSnapshot> {
  const snapshot = await getOperationPermissionSnapshot(store, target);
  if (snapshot.effective.destructive_actions === 'block') {
    throw new OperationPermissionDeniedError('destructive_actions', target);
  }
  return snapshot;
}

export async function assertDatabaseAccessAllowed(
  store: PermissionSettingStore,
  target: OperationPermissionTarget,
): Promise<OperationPermissionSnapshot> {
  const snapshot = await getOperationPermissionSnapshot(store, target);
  if (snapshot.effective.database_access === 'block') {
    throw new OperationPermissionDeniedError('database_access', target);
  }
  return snapshot;
}
