import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { Database } from '../src/db/index.js';
import { ProjectNotFoundError, RepoPersistenceError } from '../src/errors.js';

const databaseUrl = process.env.OPENLANDER_DATABASE_URL ?? process.env.DATABASE_URL ?? '';
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const projectRepoSource = readFileSync(
  resolve(process.cwd(), 'src/db/repos/project.repo.ts'),
  'utf8',
);
const serviceRuntimeRoutesSource = readFileSync(
  resolve(process.cwd(), 'src/web/api/service-runtime-routes.ts'),
  'utf8',
);

function uniqueId(label: string): string {
  return `attach-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

describeWithDatabase('Database.attachServiceToProject behavior', () => {
  let db: Database;
  let projectIds: string[] = [];
  let serviceIds: string[] = [];

  beforeAll(async () => {
    db = await Database.connect(databaseUrl);
  });

  afterEach(async () => {
    for (const serviceId of [...serviceIds].reverse()) {
      await db.deleteService(serviceId).catch(() => undefined);
    }
    for (const projectId of [...projectIds].reverse()) {
      await db.deleteProject(projectId).catch(() => undefined);
    }
    projectIds = [];
    serviceIds = [];
  });

  afterAll(async () => {
    if (db) await db.close();
  });

  async function createTestProject(
    label: string,
    options: { buildMethod?: 'compose'; parentProjectId?: string; buildContext?: string } = {},
  ) {
    const id = uniqueId(label);
    projectIds.push(id);
    serviceIds.push(`${id}__svc`);
    await db.createProject({
      id,
      name: id,
      repoUrl: `https://example.test/${id}`,
      ...(options.buildMethod ? { buildMethod: options.buildMethod } : {}),
      ...(options.parentProjectId ? { parentProjectId: options.parentProjectId } : {}),
      ...(options.buildContext ? { buildContext: options.buildContext } : {}),
    });
    return id;
  }

  it('moves service.project_id to the target while preserving and hiding the runtime project row', async () => {
    const target = await createTestProject('target');
    const source = await createTestProject('source');

    const svcBefore = await db.getService(`${source}__svc`);
    expect(svcBefore?.project_id).toBe(source);

    const result = await db.attachServiceToProject(`${source}__svc`, target);
    expect(result.sourceProjectId).toBe(source);
    expect(result.targetProjectId).toBe(target);

    const svcAfter = await db.getService(`${source}__svc`);
    expect(svcAfter?.project_id).toBe(target);

    expect(await db.getProject(source)).toBeDefined();
    expect(await db.getProject(target)).toBeDefined();

    const listedIds = (await db.listProjects()).map((project) => project.id);
    expect(listedIds).toContain(target);
    expect(listedIds).not.toContain(source);

    await db.archiveProject(source);
    const archivedIds = (await db.listArchivedProjects()).map((project) => project.id);
    expect(archivedIds).not.toContain(source);
  });

  it('promotes runtime group env vars to service overrides without changing target defaults', async () => {
    const target = await createTestProject('target');
    const source = await createTestProject('source');

    await db.setEnvVar(target, 'DATABASE_URL', 'postgres://target');
    await db.setEnvVar(target, 'API_KEY', 'target-secret');
    await db.setEnvVar(source, 'DATABASE_URL', 'postgres://source');
    await db.setEnvVar(source, 'NEW_VAR', 'source-only');

    const result = await db.attachServiceToProject(`${source}__svc`, target);

    expect(await db.getEnvVars(target)).toEqual({
      DATABASE_URL: 'postgres://target',
      API_KEY: 'target-secret',
    });
    expect(await db.getEnvVarsForService(target, `${source}__svc`)).toEqual({
      DATABASE_URL: 'postgres://source',
      NEW_VAR: 'source-only',
    });

    expect(result.droppedEnvVarKeys).toEqual([]);
    expect(result.droppedSecretFiles).toEqual([]);
    expect(await db.getEnvVars(source)).toEqual({});
  });

  it('preserves service-scoped env vars and build context while attaching', async () => {
    const target = await createTestProject('target');
    const source = await createTestProject('source', { buildContext: '.' });
    const serviceId = `${source}__svc`;

    await db.setEnvVar(target, 'DATABASE_URL', 'postgres://target');
    await db.setEnvVarForService(source, serviceId, 'DATABASE_URL', 'postgres://source');
    await db.setEnvVarForService(source, serviceId, 'NEXT_PUBLIC_API_BASE_URL', '/backend');

    await db.attachServiceToProject(serviceId, target);

    expect(await db.getEnvVarsForService(target, serviceId)).toEqual({
      DATABASE_URL: 'postgres://source',
      NEXT_PUBLIC_API_BASE_URL: '/backend',
    });
    expect(await db.getEnvVarsForService(source, serviceId)).toEqual({
      DATABASE_URL: 'postgres://source',
      NEXT_PUBLIC_API_BASE_URL: '/backend',
    });
    expect(await db.getEnvVars(target)).toEqual({ DATABASE_URL: 'postgres://target' });
    expect((await db.getService(serviceId))?.build_context).toBe('.');
  });

  it('marks only never-successful failed deployments as initial deploy attempts', async () => {
    const project = await createTestProject('failed-attempt');
    const serviceId = `${project}__svc`;

    await db.updateService(serviceId, { status: 'error', containerId: null });
    await db.createDeployLog({
      id: uniqueId('failed-log'),
      projectId: project,
      status: 'failed',
      trigger: 'api',
      buildLog: 'build failed',
    });

    let listed = await db.listProjectsWithMetadata();
    expect(listed.find((entry) => entry.project.id === project)?.failedInitialDeploy).toBe(true);

    await db.createDeployLog({
      id: uniqueId('success-log'),
      projectId: project,
      status: 'success',
      trigger: 'api',
      buildLog: 'build succeeded',
    });

    listed = await db.listProjectsWithMetadata();
    expect(listed.find((entry) => entry.project.id === project)?.failedInitialDeploy).toBe(false);
  });

  it('attaches two selected Dockerfile Applications to the same Project sequentially', async () => {
    const target = await createTestProject('target');
    const api = await createTestProject('api');
    const worker = await createTestProject('worker');

    await db.attachServiceToProject(`${api}__svc`, target);
    await db.attachServiceToProject(`${worker}__svc`, target);

    expect((await db.getService(`${api}__svc`))?.project_id).toBe(target);
    expect((await db.getService(`${worker}__svc`))?.project_id).toBe(target);
    expect(await db.getProject(api)).toBeDefined();
    expect(await db.getProject(worker)).toBeDefined();
  });

  it('attaches a Compose parent and every child in one transaction while preserving hierarchy', async () => {
    const target = await createTestProject('target');
    const sibling = await createTestProject('sibling');
    const parent = await createTestProject('stack', { buildMethod: 'compose' });
    const child = await createTestProject('stack-api', { parentProjectId: parent });
    const postgresId = uniqueId('postgres');
    serviceIds.push(postgresId);
    await db.createService({
      id: postgresId,
      name: postgresId,
      projectId: target,
      type: 'postgresql',
      image: 'postgres:17',
      containerName: `ol-svc-${postgresId}`,
      port: 5432,
    });

    await db.attachServiceToProject(`${sibling}__svc`, target);
    await db.attachServiceToProject(`${parent}__svc`, target);

    const parentService = await db.getService(`${parent}__svc`);
    const childService = await db.getService(`${child}__svc`);
    const siblingService = await db.getService(`${sibling}__svc`);
    const postgresService = await db.getService(postgresId);
    expect(parentService?.project_id).toBe(target);
    expect(childService?.project_id).toBe(target);
    expect(childService?.parent_service_id).toBe(`${parent}__svc`);
    expect(siblingService?.project_id).toBe(target);
    expect(postgresService).toMatchObject({ project_id: target, kind: 'postgres' });
    expect(await db.getProject(parent)).toBeDefined();
    expect(await db.getProject(child)).toBeDefined();
  });

  it('is a no-op when source equals target', async () => {
    const project = await createTestProject('same');

    const result = await db.attachServiceToProject(`${project}__svc`, project);
    expect(result).toMatchObject({
      sourceProjectId: project,
      targetProjectId: project,
      droppedEnvVarKeys: [],
      droppedSecretFiles: [],
    });

    expect(await db.getProject(project)).toBeDefined();
    expect((await db.getService(`${project}__svc`))?.project_id).toBe(project);
  });

  it('throws on missing service', async () => {
    const target = await createTestProject('target');
    await expect(db.attachServiceToProject(`${uniqueId('missing')}__svc`, target)).rejects.toThrow(
      RepoPersistenceError,
    );
  });

  it('throws on missing target project', async () => {
    const source = await createTestProject('source');
    await expect(
      db.attachServiceToProject(`${source}__svc`, uniqueId('missing-target')),
    ).rejects.toThrow(ProjectNotFoundError);
  });
});

describe('Database.attachServiceToProject source guards', () => {
  it('keeps runtime rows hidden from project lists and deleted only with the service', () => {
    expect(projectRepoSource).toContain('service-level redeploy/rollback still');
    expect(projectRepoSource).not.toContain(
      'await tx.delete(projects).where(eq(projects.id, sourceProjectId))',
    );
    expect(projectRepoSource).toContain('excludesAttachedRuntimeProjectRows()');
    expect(serviceRuntimeRoutesSource).toContain('await ctx.db.deleteService(service.id)');
    expect(serviceRuntimeRoutesSource).toContain('remainingRuntimeDeployables.length === 0');
    expect(serviceRuntimeRoutesSource).toContain('await ctx.db.deleteProject(runtimeProject.id)');
  });
});
