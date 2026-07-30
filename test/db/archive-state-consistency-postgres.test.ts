import postgres from 'postgres';
import { describe, expect, it, vi } from 'vitest';

import type { OpenLanderConfig } from '../../src/config/index.js';
import { Database } from '../../src/db/index.js';
import { DeployPipeline } from '../../src/pipeline/deploy.js';
import type { Docker } from '../../src/pipeline/docker.js';
import { EnvManager } from '../../src/pipeline/env.js';

const databaseUrl = process.env.OPENLANDER_DATABASE_URL ?? process.env.DATABASE_URL ?? '';
const describeWithDatabase = databaseUrl ? describe : describe.skip;

function quotePgIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function postgresMaintenanceUrl(url: string): string {
  const parsed = new URL(url);
  parsed.pathname = '/postgres';
  return parsed.toString();
}

async function withIsolatedPostgresDatabase(
  label: string,
  fn: (url: string) => Promise<void>,
): Promise<void> {
  const dbName = `ol_${label}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const admin = postgres(postgresMaintenanceUrl(databaseUrl), { max: 1, prepare: false });
  const quotedDbName = quotePgIdentifier(dbName);

  try {
    await admin.unsafe(`CREATE DATABASE ${quotedDbName}`);
    const isolatedUrl = new URL(databaseUrl);
    isolatedUrl.pathname = `/${dbName}`;
    await fn(isolatedUrl.toString());
  } finally {
    await admin.unsafe(`DROP DATABASE IF EXISTS ${quotedDbName} WITH (FORCE)`).catch(async () => {
      await admin.unsafe(`DROP DATABASE IF EXISTS ${quotedDbName}`);
    });
    await admin.end({ timeout: 5 });
  }
}

function createRuntime(): Docker {
  return {
    listManagedContainers: vi.fn().mockResolvedValue([]),
    stopContainer: vi.fn().mockResolvedValue(undefined),
    removeContainer: vi.fn().mockResolvedValue(undefined),
    removeImage: vi.fn().mockResolvedValue(undefined),
  } as unknown as Docker;
}

const testConfig = {
  ai: { secretScan: { enabled: false } },
  traefik: { mode: 'managed' },
} as OpenLanderConfig;

describeWithDatabase('archive state consistency on Postgres', () => {
  it('treats a building environment as stale when no deployment owns the lock', async () => {
    await withIsolatedPostgresDatabase('archive_stale_building', async (url) => {
      const db = await Database.connect(url);
      try {
        const project = await db.createProject({
          id: 'archive-stale-building',
          name: 'archive-stale-building',
          repoUrl: 'https://github.com/example/archive-stale-building',
          branch: 'main',
        });
        const production = (await db.getEnvironmentsByProject(project.id))[0];
        expect(production).toBeDefined();
        await db.updateEnvironment(production!.id, { status: 'building' });
        const pipeline = new DeployPipeline(createRuntime(), db, new EnvManager(db), testConfig);

        await pipeline.archive(project.id);

        expect((await db.getProject(project.id))?.archived_at).not.toBeNull();
        expect((await db.getDeployableForProject(project.id))?.status).toBe('stopped');
        expect((await db.getEnvironment(production!.id))?.status).toBe('stopped');
        expect(await db.getDeployLockInfo(project.id)).toBeNull();
      } finally {
        await db.close();
      }
    });
  });

  it('uses the active deployment lock instead of persisted building state', async () => {
    await withIsolatedPostgresDatabase('archive_active_lock', async (url) => {
      const db = await Database.connect(url);
      try {
        const project = await db.createProject({
          id: 'archive-active-lock',
          name: 'archive-active-lock',
          repoUrl: 'https://github.com/example/archive-active-lock',
          branch: 'main',
        });
        const production = (await db.getEnvironmentsByProject(project.id))[0];
        expect(production).toBeDefined();
        await db.updateEnvironment(production!.id, { status: 'building' });
        await db.acquireDeployLock(project.id, 'deploy-live-session');
        const pipeline = new DeployPipeline(createRuntime(), db, new EnvManager(db), testConfig);

        await expect(pipeline.archive(project.id)).rejects.toMatchObject({
          code: 'DEPLOY_LOCKED',
          details: { projectId: project.id, lockedBySession: 'deploy-live-session' },
        });

        expect((await db.getProject(project.id))?.archived_at).toBeNull();
        expect((await db.getEnvironment(production!.id))?.status).toBe('building');
        expect((await db.getDeployLockInfo(project.id))?.session).toBe('deploy-live-session');
      } finally {
        await db.releaseDeployLock('archive-active-lock', 'deploy-live-session');
        await db.close();
      }
    });
  });

  it('pre-acquires Compose child locks before archiving any resource', async () => {
    await withIsolatedPostgresDatabase('archive_compose_lock', async (url) => {
      const db = await Database.connect(url);
      try {
        const parent = await db.createProject({
          id: 'archive-compose-parent',
          name: 'archive-compose-parent',
          repoUrl: 'https://github.com/example/archive-compose-parent',
          branch: 'main',
          buildMethod: 'compose',
        });
        const child = await db.createProject({
          id: 'archive-compose-child',
          name: 'archive-compose-child',
          repoUrl: 'https://github.com/example/archive-compose-parent',
          branch: 'main',
          parentProjectId: parent.id,
        });
        await db.acquireDeployLock(child.id, 'deploy-child-session');
        const pipeline = new DeployPipeline(createRuntime(), db, new EnvManager(db), testConfig);

        await expect(pipeline.archive(parent.id)).rejects.toMatchObject({
          code: 'DEPLOY_LOCKED',
          details: { projectId: child.id, lockedBySession: 'deploy-child-session' },
        });

        expect((await db.getProject(parent.id))?.archived_at).toBeNull();
        expect((await db.getProject(child.id))?.archived_at).toBeNull();
        expect(await db.getDeployLockInfo(parent.id)).toBeNull();
        expect((await db.getDeployLockInfo(child.id))?.session).toBe('deploy-child-session');
      } finally {
        await db.releaseDeployLock('archive-compose-child', 'deploy-child-session');
        await db.close();
      }
    });
  });

  it('archives and restores a Stateful Compose child with one marker and the same container', async () => {
    await withIsolatedPostgresDatabase('archive_compose_restore_set', async (url) => {
      const db = await Database.connect(url);
      try {
        const parent = await db.createProject({
          id: 'archive-restore-parent',
          name: 'archive-restore-parent',
          repoUrl: 'https://github.com/example/archive-restore-parent',
          branch: 'main',
          buildMethod: 'compose',
        });
        const child = await db.createProject({
          id: 'archive-restore-db',
          name: 'archive-restore-parent/db',
          repoUrl: 'https://github.com/example/archive-restore-parent',
          branch: 'main',
          parentProjectId: parent.id,
          runtimeRole: 'resource',
        });
        const childService = await db.getDeployableForProject(child.id);
        expect(childService).toBeDefined();
        await db.updateService(childService!.id, {
          status: 'running',
          runtimeRole: 'resource',
          containerId: 'archive-db-container-1234567890',
          containerName: 'ol-archive-restore-parent-db',
          imageTag: 'postgres:17-alpine',
        });
        const runtime = {
          listManagedContainers: vi.fn().mockResolvedValue([]),
          listAllContainers: vi.fn().mockResolvedValue([]),
          stopContainer: vi.fn().mockResolvedValue(undefined),
          startContainer: vi.fn().mockResolvedValue(undefined),
          removeContainer: vi.fn().mockResolvedValue(undefined),
          removeImage: vi.fn().mockResolvedValue(undefined),
          disconnectContainerFromNetwork: vi.fn().mockResolvedValue(undefined),
          connectContainerToNetwork: vi.fn().mockResolvedValue(undefined),
          renameContainer: vi.fn().mockResolvedValue(undefined),
          ensureProjectNetwork: vi.fn().mockResolvedValue('ol-archive-restore-parent'),
          inspectContainer: vi.fn().mockRejectedValue(
            new Error('No such container: ol-archive-restore-parent-db'),
          ),
        } as unknown as Docker;
        const pipeline = new DeployPipeline(runtime, db, new EnvManager(db), testConfig);

        await pipeline.archive(parent.id);

        const archivedParent = await db.getProject(parent.id);
        const archivedChild = await db.getProject(child.id);
        const archivedChildService = await db.getDeployableForProject(child.id);
        expect(archivedParent?.archived_at).not.toBeNull();
        expect(archivedChild?.archived_at).toBe(archivedParent?.archived_at);
        expect(archivedChildService).toMatchObject({
          archived_at: archivedParent?.archived_at,
          status: 'stopped',
          container_id: 'archive-db-container-1234567890',
          container_name: 'ol-archive-restore-parent-db-archived-archive-db-c',
          image_tag: 'postgres:17-alpine',
        });
        expect(runtime.removeContainer).not.toHaveBeenCalledWith(
          'archive-db-container-1234567890',
        );

        await pipeline.unarchive(parent.id);

        const restoredChildService = await db.getDeployableForProject(child.id);
        expect((await db.getProject(parent.id))?.archived_at).toBeNull();
        expect((await db.getProject(child.id))?.archived_at).toBeNull();
        expect(restoredChildService).toMatchObject({
          archived_at: null,
          status: 'running',
          container_id: 'archive-db-container-1234567890',
          container_name: 'ol-archive-restore-parent-db',
          image_tag: 'postgres:17-alpine',
        });
        expect(runtime.connectContainerToNetwork).toHaveBeenCalledWith(
          'archive-db-container-1234567890',
          'ol-archive-restore-parent',
          ['db'],
        );
        expect(runtime.startContainer).toHaveBeenCalledWith('archive-db-container-1234567890');
      } finally {
        await db.close();
      }
    });
  });

  it('keeps attached runtime Projects in the reconciliation sweep', async () => {
    await withIsolatedPostgresDatabase('archive_attached_runtime_reconcile', async (url) => {
      const db = await Database.connect(url);
      try {
        const target = await db.createProjectGroup({
          id: 'visible-project',
          name: 'visible-project',
        });
        const runtime = await db.createProject({
          id: 'hidden-runtime',
          name: 'hidden-runtime',
          repoUrl: 'https://github.com/example/hidden-runtime',
          branch: 'main',
        });
        const runtimeService = await db.getDeployableForProject(runtime.id);
        expect(runtimeService).toBeDefined();
        await db.attachServiceToProject(runtimeService!.id, target.id);

        expect((await db.listProjects()).map((project) => project.id)).not.toContain(runtime.id);
        expect(
          (await db.listRuntimeProjectsForReconciliation()).map((project) => project.id),
        ).toContain(runtime.id);
      } finally {
        await db.close();
      }
    });
  });
});
