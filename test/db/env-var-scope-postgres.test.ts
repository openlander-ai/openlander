import postgres from 'postgres';
import { describe, expect, it } from 'vitest';

import { Database } from '../../src/db/index.js';
import { EnvManager } from '../../src/pipeline/env.js';
import { resolveEnvVars } from '../../src/pipeline/resolve-env.js';

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

describeWithDatabase('env var scope storage on Postgres', () => {
  it('stores the same key separately for project/service shared and environment scopes', async () => {
    await withIsolatedPostgresDatabase('env_scope', async (url) => {
      const db = await Database.connect(url);
      try {
        const env = new EnvManager(db);
        const project = await db.createProject({
          id: 'p-env-scope',
          name: 'env-scope-app',
          repoUrl: 'https://github.com/example/env-scope-app',
        });
        const production = (await db.getEnvironmentsByProject(project.id)).find(
          (item) => item.type === 'production',
        );
        if (!production) throw new Error('production environment missing');
        const development = await db.createEnvironment({
          id: 'p-env-scope-development',
          projectId: project.id,
          type: 'development',
          branch: 'develop',
        });
        const serviceId = `${project.id}__svc`;

        await env.set(project.id, 'SHARED_KEY', 'project-shared');
        await env.set(project.id, 'SHARED_KEY', 'project-production', production.id);
        await env.set(project.id, 'SHARED_KEY', 'project-development', development.id);
        await env.setBulkForService(project.id, serviceId, { SHARED_KEY: 'service-shared' });
        await env.setBulkForService(
          project.id,
          serviceId,
          {
            SHARED_KEY: 'service-development',
          },
          development.id,
        );

        await expect(env.getAll(project.id)).resolves.toEqual({
          SHARED_KEY: 'project-shared',
        });
        await expect(env.getAll(project.id, production.id)).resolves.toEqual({
          SHARED_KEY: 'project-production',
        });
        await expect(env.getAll(project.id, development.id)).resolves.toEqual({
          SHARED_KEY: 'project-development',
        });
        await expect(env.getAllForService(project.id, serviceId)).resolves.toEqual({
          SHARED_KEY: 'service-shared',
        });
        await expect(env.getAllForService(project.id, serviceId, development.id)).resolves.toEqual({
          SHARED_KEY: 'service-development',
        });

        const resolved = await resolveEnvVars(
          {
            projectId: project.id,
            serviceId,
            environmentId: development.id,
            inlineEnvVars: { SHARED_KEY: 'inline' },
            runtimeEnvVars: { SHARED_KEY: 'generated' },
          },
          { env },
        );
        expect(resolved['SHARED_KEY']).toBe('generated');
      } finally {
        await db.close();
      }
    });
  });
});
