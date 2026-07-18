import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import postgres from 'postgres';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/pipeline/git.js', () => ({
  cloneRepo: vi.fn(),
  redactRepoUrl: vi.fn((value: string) => value),
}));

vi.mock('../../src/pipeline/preflight.js', () => ({
  preflightCheckOrThrow: vi.fn().mockResolvedValue({ warnings: [] }),
}));

vi.mock('../../src/lib/logger.js', () => ({
  createModuleLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import type { AppContext } from '../../src/app.js';
import type { OpenLanderConfig } from '../../src/config/index.js';
import { Database } from '../../src/db/index.js';
import { projectIdToDeployableServiceId } from '../../src/db/service-ids.js';
import { createCompositeTools, type CompositeTool } from '../../src/mcp/composite-tools.js';
import { EnvManager } from '../../src/pipeline/env.js';
import { PlanEngine } from '../../src/pipeline/deploy-plan/engine.js';
import type { ServiceManager } from '../../src/pipeline/service-manager.js';
import { DeployPipeline } from '../../src/pipeline/deploy.js';
import { cloneRepo } from '../../src/pipeline/git.js';
import { deployPlanToolDefs } from '../../src/tools/defs/deploy-plan.js';
import { deployToolDefs } from '../../src/tools/defs/deploy.js';
import { projectOpsToolDefs } from '../../src/tools/defs/project-ops.js';
import { serviceToolDefs } from '../../src/tools/defs/service.js';
import type { Docker } from '../../src/pipeline/docker.js';

const databaseUrl = process.env.OPENLANDER_DATABASE_URL ?? process.env.DATABASE_URL ?? '';
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const mockCloneRepo = cloneRepo as unknown as ReturnType<typeof vi.fn>;

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
    ensureProjectNetwork: vi.fn(async (name: string) => `ol-${name}`),
    stopContainer: vi.fn().mockResolvedValue(undefined),
    removeContainer: vi.fn().mockResolvedValue(undefined),
    safeRemoveContainer: vi.fn().mockResolvedValue(undefined),
    runContainer: vi.fn().mockResolvedValue('container-123'),
    startContainer: vi.fn().mockResolvedValue(undefined),
    getImageExposedPort: vi.fn().mockResolvedValue(3000),
    listManagedContainers: vi.fn().mockResolvedValue([]),
    listContainers: vi.fn().mockResolvedValue([]),
    listAllContainers: vi.fn().mockResolvedValue([]),
    inspectContainer: vi.fn().mockResolvedValue(null),
    getLogs: vi.fn().mockResolvedValue(''),
    cleanupSecretFiles: vi.fn(),
    buildImage: vi.fn().mockResolvedValue(undefined),
    pullImage: vi.fn().mockResolvedValue(undefined),
    tagImage: vi.fn().mockResolvedValue(undefined),
    cancelBuild: vi.fn().mockReturnValue(false),
  } as unknown as Docker;
}

function createJobManager() {
  const jobs = new Map<
    string,
    {
      projectId: string;
      projectName: string;
      phase: string;
      startedAt: Date;
      completedAt?: Date;
    }
  >();

  return {
    trackJob: vi.fn((projectId: string, projectName: string) => {
      jobs.set(projectId, { projectId, projectName, phase: 'building', startedAt: new Date() });
    }),
    updatePhase: vi.fn((projectId: string, phase: string) => {
      const current = jobs.get(projectId);
      if (!current) return;
      current.phase = phase;
      if (phase === 'done' || phase === 'failed') {
        current.completedAt = new Date();
      }
    }),
    getStatus: vi.fn((id: string) => jobs.get(id) ?? null),
    getStatuses: vi.fn(() => Array.from(jobs.values())),
  };
}

function createServiceManager(db: Database): ServiceManager {
  return {
    create: vi.fn(async (opts: { name: string; projectId?: string; template?: string }) => {
      const id = `svc-${opts.name}`;
      const connectionString = `postgresql://postgres:postgres@${opts.name}:5432/app`;
      await db.createService({
        id,
        name: opts.name,
        projectId: opts.projectId,
        type: opts.template ?? 'postgresql',
        image: 'postgres:16',
        containerName: `ol-svc-${opts.name}`,
        port: 5432,
        credentials: JSON.stringify({ connectionString }),
      });
      await db.updateService(id, { status: 'running', containerId: `container-${opts.name}` });
      const service = await db.getService(id);
      if (!service) {
        throw new Error(`failed to create service row: ${id}`);
      }
      return service;
    }),
    getSuggestedEnv: vi.fn(async (service: { credentials?: string | null }) => {
      const parsed =
        typeof service.credentials === 'string'
          ? (JSON.parse(service.credentials) as { connectionString?: string })
          : {};
      return [{ key: 'DATABASE_URL', value: parsed.connectionString ?? '' }];
    }),
    remove: vi.fn().mockResolvedValue(undefined),
    list: vi.fn(() => db.listServices()),
  } as unknown as ServiceManager;
}

function createAppHarness(db: Database) {
  const docker = createMockDocker();
  const env = new EnvManager(db);
  const jobManager = createJobManager();
  const config = { ai: { secretScan: { enabled: false } } } as OpenLanderConfig;
  const pipeline = new DeployPipeline(docker, db, env, config, jobManager as never);
  const deployEnvironment = vi.spyOn(pipeline, 'deployEnvironment').mockResolvedValue({
    success: true,
    projectId: 'placeholder',
    projectName: 'placeholder',
    buildDurationMs: 0,
  });
  const serviceManager = createServiceManager(db);
  const planEngine = new PlanEngine({
    db,
    pipeline,
    env,
    serviceManager,
    autoDetector: {},
    config,
    docker,
  });
  const appCtx = {
    db,
    docker,
    env,
    pipeline,
    planEngine,
    serviceManager,
    jobManager,
  } as unknown as AppContext;
  const composites = new Map(
    createCompositeTools([
      ...deployToolDefs,
      ...deployPlanToolDefs,
      ...projectOpsToolDefs,
      ...serviceToolDefs,
    ]).map((tool) => [tool.name, tool]),
  );

  return { appCtx, deployEnvironment, composites };
}

function getComposite(composites: Map<string, CompositeTool>, name: string): CompositeTool {
  const tool = composites.get(name);
  expect(tool).toBeDefined();
  return tool!;
}

async function callComposite(
  harness: ReturnType<typeof createAppHarness>,
  composite: string,
  action: string,
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return (await getComposite(harness.composites, composite).execute(
    { action, params },
    { target: 'mcp', appCtx: harness.appCtx },
  )) as Record<string, unknown>;
}

describeWithDatabase('MCP canonical DB-first flows on Postgres', () => {
  let repoPath: string;

  beforeEach(() => {
    repoPath = mkdtempSync(join(tmpdir(), 'openlander-mcp-db-first-'));
    writeFileSync(join(repoPath, 'Dockerfile'), 'FROM node:22\n');
    mockCloneRepo.mockResolvedValue({ path: repoPath, commitSha: 'mcp-db-first-sha' });
  });

  afterEach(() => {
    rmSync(repoPath, { recursive: true, force: true });
    mockCloneRepo.mockReset();
    vi.clearAllMocks();
  });

  it('runs create_project -> create_service(project_id) -> deploy_app(target_project_id)', async () => {
    await withIsolatedPostgresDatabase('mcp_deploy_app_db_first', async (url) => {
      const db = await Database.connect(url);
      try {
        const harness = createAppHarness(db);
        const createProject = await callComposite(harness, 'openlander_project', 'create_project', {
          name: 'mcp-db-first-app',
        });
        const projectId = String(createProject['project_id']);

        const createService = await callComposite(
          harness,
          'openlander_managed_service',
          'create_service',
          {
            name: 'mcp-db-first-app-postgres',
            template: 'postgresql',
            project_id: projectId,
          },
        );
        expect(createService).toMatchObject({
          status: 'created',
          attached_to: projectId,
          auto_injected_env_keys: ['DATABASE_URL'],
        });

        const deploy = await callComposite(harness, 'openlander_deploy', 'deploy_app', {
          repo_url: 'https://github.com/openlander-ai/urlnest',
          name: 'mcp-db-first-app',
          target_project_id: projectId,
          wait: false,
        });

        expect(deploy).toMatchObject({
          status: 'building',
          project_id: projectId,
          target_project_id: projectId,
          runtime_project_id: projectId,
          status_call: {
            tool: 'openlander_deploy',
            action: 'get_deploy_status',
          },
        });

        const serviceId = projectIdToDeployableServiceId(projectId);
        await vi.waitFor(async () => {
          await expect(db.getService(serviceId)).resolves.toMatchObject({
            id: serviceId,
            project_id: projectId,
          });
          expect(harness.deployEnvironment).toHaveBeenCalledWith(
            projectId,
            `${projectId}-production`,
            expect.objectContaining({
              envVars: expect.objectContaining({
                DATABASE_URL: 'postgresql://postgres:postgres@mcp-db-first-app-postgres:5432/app',
              }),
              _projectId: projectId,
            }),
          );
        });

        const status = await callComposite(harness, 'openlander_deploy', 'get_deploy_status', {
          project_id: projectId,
        });
        expect(status).toMatchObject({
          active: 1,
          jobs: [expect.objectContaining({ project_id: projectId })],
        });
      } finally {
        await db.close();
      }
    });
  });

  it('runs create_project -> create_service(project_id) -> create_deploy_plan(target_project_id) -> execute_deploy_plan', async () => {
    await withIsolatedPostgresDatabase('mcp_execute_plan_db_first', async (url) => {
      const db = await Database.connect(url);
      try {
        const harness = createAppHarness(db);
        const createProject = await callComposite(harness, 'openlander_project', 'create_project', {
          name: 'mcp-db-first-plan',
        });
        const projectId = String(createProject['project_id']);

        await callComposite(harness, 'openlander_managed_service', 'create_service', {
          name: 'mcp-db-first-plan-postgres',
          template: 'postgresql',
          project_id: projectId,
        });

        const plan = await callComposite(harness, 'openlander_deploy', 'create_deploy_plan', {
          repo_url: 'https://github.com/openlander-ai/urlnest',
          name: 'mcp-db-first-plan',
          target_project_id: projectId,
        });
        expect(plan).toMatchObject({
          status: 'ready',
          plan_id: expect.any(String),
        });
        const storedPlan = await db.getDeployPlan(String(plan['plan_id']));
        expect(JSON.parse(storedPlan?.plan_json ?? '{}')).toMatchObject({
          target_project_id: projectId,
          execution: { targetProjectId: projectId },
        });

        const execute = await callComposite(harness, 'openlander_deploy', 'execute_deploy_plan', {
          plan_id: String(plan['plan_id']),
        });
        expect(execute).toMatchObject({
          status: 'building',
          project_id: projectId,
          target_project_id: projectId,
          runtime_project_id: projectId,
        });

        const serviceId = projectIdToDeployableServiceId(projectId);
        await vi.waitFor(async () => {
          await expect(db.getService(serviceId)).resolves.toMatchObject({
            id: serviceId,
            project_id: projectId,
          });
          expect(harness.deployEnvironment).toHaveBeenCalledWith(
            projectId,
            `${projectId}-production`,
            expect.objectContaining({
              envVars: expect.objectContaining({
                DATABASE_URL: 'postgresql://postgres:postgres@mcp-db-first-plan-postgres:5432/app',
              }),
              _projectId: projectId,
            }),
          );
        });
      } finally {
        await db.close();
      }
    });
  });
});
