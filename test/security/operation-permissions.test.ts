import { describe, expect, it } from 'vitest';

import {
  assertDatabaseAccessAllowed,
  assertDestructiveActionAllowed,
  getOperationPermissionSnapshot,
  saveGlobalOperationPermissions,
  saveOperationPermissionOverride,
} from '../../src/security/operation-permissions.js';

class MemorySettingsStore {
  readonly values = new Map<string, string>();

  async getSetting(key: string): Promise<{ value: string } | null> {
    const value = this.values.get(key);
    return value === undefined ? null : { value };
  }

  async upsertSetting(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }

  async deleteSetting(key: string): Promise<boolean> {
    return this.values.delete(key);
  }
}

describe('operation permissions', () => {
  it('defaults both capabilities to allowed', async () => {
    const snapshot = await getOperationPermissionSnapshot(new MemorySettingsStore());

    expect(snapshot.effective).toEqual({
      destructive_actions: 'allow',
      database_access: 'allow',
    });
    expect(snapshot.sources).toEqual({
      destructive_actions: 'global',
      database_access: 'global',
    });
  });

  it('resolves service over project over global', async () => {
    const store = new MemorySettingsStore();
    await saveGlobalOperationPermissions(store, {
      destructive_actions: 'approval_required',
      database_access: 'block',
    });
    await saveOperationPermissionOverride(
      store,
      { projectId: 'project-1' },
      { destructive_actions: 'block', database_access: 'allow' },
    );
    const snapshot = await saveOperationPermissionOverride(
      store,
      { projectId: 'project-1', serviceId: 'service-1' },
      { destructive_actions: 'allow' },
    );

    expect(snapshot.effective).toEqual({
      destructive_actions: 'allow',
      database_access: 'allow',
    });
    expect(snapshot.sources).toEqual({
      destructive_actions: 'service',
      database_access: 'project',
    });
  });

  it('clears an override with null and returns to inheritance', async () => {
    const store = new MemorySettingsStore();
    await saveGlobalOperationPermissions(store, { database_access: 'block' });
    await saveOperationPermissionOverride(
      store,
      { projectId: 'project-1' },
      { database_access: 'allow' },
    );
    const snapshot = await saveOperationPermissionOverride(
      store,
      { projectId: 'project-1' },
      { database_access: null },
    );

    expect(snapshot.project_override).toBeNull();
    expect(snapshot.effective.database_access).toBe('block');
    expect(snapshot.sources.database_access).toBe('global');
  });

  it('rejects blocked operations with a machine-readable error', async () => {
    const store = new MemorySettingsStore();
    await saveGlobalOperationPermissions(store, {
      destructive_actions: 'block',
      database_access: 'block',
    });

    await expect(
      assertDestructiveActionAllowed(store, { projectId: 'project-1' }),
    ).rejects.toMatchObject({ code: 'OPERATION_PERMISSION_DENIED', statusCode: 403 });
    await expect(
      assertDatabaseAccessAllowed(store, { serviceId: 'service-1' }),
    ).rejects.toMatchObject({ code: 'OPERATION_PERMISSION_DENIED', statusCode: 403 });
  });
});
