import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PlatformUpdateStateStore } from '../../src/update/state-store.js';
import type { PlatformUpdateOperation } from '../../src/update/types.js';

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe('PlatformUpdateStateStore', () => {
  it('restores sanitized operation state after a process restart', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'openlander-update-state-'));
    tempDirectories.push(dataDir);
    const operation: PlatformUpdateOperation = {
      id: 'update-1',
      sourceVersion: '0.2.13-rc.7',
      targetVersion: '0.2.14-rc.1',
      phase: 'pulling',
      startedAt: '2026-07-30T00:00:00.000Z',
      updatedAt: '2026-07-30T00:01:00.000Z',
      message: null,
      errorCode: null,
      runnerContainerId: 'runner-id',
    };
    await new PlatformUpdateStateStore(dataDir).writeOperation(operation);
    const restartedStore = new PlatformUpdateStateStore(dataDir);
    await expect(restartedStore.readOperation()).resolves.toEqual(operation);
    expect(await readFile(restartedStore.operationPath(), 'utf8')).not.toContain('password');
  });

  it('returns null for missing or malformed state instead of inventing progress', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'openlander-update-state-'));
    tempDirectories.push(dataDir);
    const store = new PlatformUpdateStateStore(dataDir);
    await expect(store.readOperation()).resolves.toBeNull();
  });
});
