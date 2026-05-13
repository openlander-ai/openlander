import postgres from 'postgres';
import { describe, expect, it } from 'vitest';

import { Database } from '../../src/db/index.js';
import { ORPHAN_MANAGED_GROUP_ID } from '../../src/db/service-ids.js';
import { ServiceManager } from '../../src/pipeline/service-manager.js';
import { createMockDockerHarness } from '../helpers/docker-mocks.js';

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
    await admin
      .unsafe(`DROP DATABASE IF EXISTS ${quotedDbName} WITH (FORCE)`)
      .catch(async () => {
        await admin.unsafe(`DROP DATABASE IF EXISTS ${quotedDbName}`);
      });
    await admin.end({ timeout: 5 });
  }
}

describeWithDatabase('managed service creation on fresh Postgres', () => {
  it('creates the synthetic managed-service group before inserting service rows', async () => {
    await withIsolatedPostgresDatabase('managed_orphan_group', async (url) => {
      const db = await Database.connect(url);
      try {
        const dockerHarness = createMockDockerHarness();
        const manager = new ServiceManager(dockerHarness.docker, db);

        const service = await manager.create({ name: 'qa-redis', template: 'redis' });
        const orphanGroup = await db.getProject(ORPHAN_MANAGED_GROUP_ID);
        const persisted = await db.getService(service.id);

        expect(orphanGroup).toBeDefined();
        expect(orphanGroup?.id).toBe(ORPHAN_MANAGED_GROUP_ID);
        expect(persisted).toMatchObject({
          id: service.id,
          project_id: ORPHAN_MANAGED_GROUP_ID,
          name: 'qa-redis',
          kind: 'redis',
          source: 'image',
        });
        expect(dockerHarness.docker.runServiceContainer).toHaveBeenCalled();
      } finally {
        await db.close();
      }
    });
  });
});
