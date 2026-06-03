import postgres from 'postgres';
import { describe, expect, it, vi } from 'vitest';

import { Database } from '../../src/db/index.js';
import { projectIdToDeployableServiceId } from '../../src/db/service-ids.js';
import { DeployPipeline } from '../../src/pipeline/deploy.js';
import type { OpenLanderConfig } from '../../src/config/index.js';
import type { Docker } from '../../src/pipeline/docker.js';

vi.mock('../../src/lib/logger.js', () => ({
  createModuleLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

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

function createMockDocker(): Docker {
  return {
    stopContainer: vi.fn().mockResolvedValue(undefined),
    removeContainer: vi.fn().mockResolvedValue(undefined),
    safeRemoveContainer: vi.fn().mockResolvedValue(undefined),
    runContainer: vi.fn().mockResolvedValue('container-123'),
    startContainer: vi.fn().mockResolvedValue(undefined),
    getImageExposedPort: vi.fn().mockResolvedValue(3000),
    listContainers: vi.fn().mockResolvedValue([]),
    listAllContainers: vi.fn().mockResolvedValue([]),
    inspectContainer: vi.fn().mockResolvedValue(null),
    getLogs: vi.fn().mockResolvedValue(''),
    cleanupSecretFiles: vi.fn(),
    buildImage: vi.fn().mockResolvedValue(undefined),
    pullImage: vi.fn().mockResolvedValue(undefined),
    tagImage: vi.fn().mockResolvedValue(undefined),
  } as unknown as Docker;
}

function buildPipeline(db: Database): DeployPipeline {
  return new DeployPipeline(
    createMockDocker(),
    db,
    {
      getGlobalSecrets: vi.fn().mockReturnValue({}),
      getAll: vi.fn().mockReturnValue({}),
      getMergedForDeploy: vi.fn().mockReturnValue({}),
      getSecretFilesForDeploy: vi.fn().mockReturnValue([]),
    } as never,
    { ai: { secretScan: { enabled: false } } } as OpenLanderConfig,
  );
}

describeWithDatabase('DB-first Project/Application identity contracts on Postgres', () => {
  it('creates the first Application backing service before service-scoped environment/log rows', async () => {
    await withIsolatedPostgresDatabase('db_first_identity', async (url) => {
      const db = await Database.connect(url);
      try {
        const project = await db.createProjectGroup({
          id: 'p-db-first',
          name: 'db-first',
          displayName: 'DB First',
        });

        await db.createService({
          id: 'svc-db-first-postgres',
          name: 'db-first-postgres',
          projectId: project.id,
          type: 'postgresql',
          image: 'postgres:16',
          containerName: 'ol-svc-db-first-postgres',
          port: 5432,
        });

        const pipeline = buildPipeline(db);
        const deployEnvironment = vi.spyOn(pipeline, 'deployEnvironment').mockResolvedValue({
          success: true,
          projectId: project.id,
          projectName: project.name,
          buildDurationMs: 0,
        });

        await expect(
          pipeline.deploy({
            _projectId: project.id,
            _lockSessionId: 'contract-session',
            repoUrl: 'https://github.com/openlander-ai/urlnest',
            branch: 'main',
            name: project.name,
            envVars: {
              DATABASE_URL: 'postgres://placeholder/contract',
            },
          }),
        ).resolves.toMatchObject({
          success: true,
          projectId: project.id,
          projectName: project.name,
        });

        const serviceId = projectIdToDeployableServiceId(project.id);
        await expect(db.getService(serviceId)).resolves.toMatchObject({
          id: serviceId,
          project_id: project.id,
          kind: 'git',
          repo_url: 'https://github.com/openlander-ai/urlnest',
          branch: 'main',
        });

        const production = (await db.getEnvironmentsByProject(project.id)).find(
          (env) => env.type === 'production',
        );
        expect(production).toMatchObject({
          id: `${project.id}-production`,
          service_id: serviceId,
          project_id: project.id,
        });

        await expect(
          db.createDeployLog({
            id: 'deploy-log-contract',
            projectId: project.id,
            environmentId: production?.id,
            status: 'success',
            trigger: 'api',
            buildLog: 'contract deploy log',
            durationMs: 1,
          }),
        ).resolves.toBeUndefined();

        expect(deployEnvironment).toHaveBeenCalledWith(
          project.id,
          `${project.id}-production`,
          expect.objectContaining({
            _projectId: project.id,
            name: project.name,
          }),
        );
      } finally {
        await db.close();
      }
    });
  });
});
