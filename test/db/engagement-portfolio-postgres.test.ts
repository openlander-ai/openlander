import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { describe, expect, it } from 'vitest';
import { Database } from '../../src/db/index.js';
import { createDrizzleDatabase } from '../../src/db/drizzle.js';
import { EngagementService } from '../../src/engagement/engagement-service.js';

const databaseUrl = process.env.OPENLANDER_DATABASE_URL ?? process.env.DATABASE_URL ?? '';
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const NOW = '2026-07-25T00:00:00.000Z';

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
  const databaseName = `ol_engagement_${label}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const admin = postgres(postgresMaintenanceUrl(databaseUrl), { max: 1, prepare: false });
  try {
    await admin.unsafe(`CREATE DATABASE ${quotePgIdentifier(databaseName)}`);
    const isolatedUrl = new URL(databaseUrl);
    isolatedUrl.pathname = `/${databaseName}`;
    await fn(isolatedUrl.toString());
  } finally {
    await admin
      .unsafe(`DROP DATABASE IF EXISTS ${quotePgIdentifier(databaseName)} WITH (FORCE)`)
      .catch(async () => {
        await admin.unsafe(`DROP DATABASE IF EXISTS ${quotePgIdentifier(databaseName)}`);
      });
    await admin.end({ timeout: 5 });
  }
}

async function applyMigrationsThrough(url: string, maximumIndex: number): Promise<void> {
  const migrationDirectory = await mkdtemp(join(tmpdir(), `openlander-00${maximumIndex}-`));
  try {
    await mkdir(join(migrationDirectory, 'meta'), { recursive: true });
    const journal = JSON.parse(
      await readFile(join(process.cwd(), 'drizzle/meta/_journal.json'), 'utf8'),
    ) as {
      version: string;
      dialect: string;
      entries: Array<{ idx: number; tag: string }>;
    };
    const entries = journal.entries.filter((entry) => entry.idx <= maximumIndex);
    await writeFile(
      join(migrationDirectory, 'meta/_journal.json'),
      JSON.stringify({ ...journal, entries }, null, 2),
    );
    await Promise.all(
      entries.map(async (entry) => {
        await cp(
          join(process.cwd(), `drizzle/${entry.tag}.sql`),
          join(migrationDirectory, `${entry.tag}.sql`),
        );
      }),
    );
    const partial = createDrizzleDatabase(url);
    await migrate(partial.db, { migrationsFolder: migrationDirectory });
    await partial.client.end({ timeout: 5 });
  } finally {
    await rm(migrationDirectory, { recursive: true, force: true });
  }
}

describeWithDatabase('Engagement Portfolio persistence on Postgres', () => {
  for (const baseline of [13, 14]) {
    it(`upgrades an existing 00${baseline} database without assigning existing Projects`, async () => {
      await withIsolatedPostgresDatabase(`upgrade_${baseline}`, async (url) => {
        await applyMigrationsThrough(url, baseline);
        const partial = createDrizzleDatabase(url);
        await partial.db.insert((await import('../../src/db/schema.drizzle.js')).projects).values({
          id: `project-existing-${baseline}`,
          name: `existing-${baseline}`,
          display_name: `Existing ${baseline}`,
        });
        await partial.client.end({ timeout: 5 });

        const upgraded = await Database.connect(url);
        try {
          const service = new EngagementService(upgraded);
          const created = await service.create({
            customerName: 'Upgrade Synthetic',
            title: `Upgrade ${baseline}`,
          });
          expect(created.project_count).toBe(0);
          await expect(
            service.getProjectReference(`project-existing-${baseline}`),
          ).resolves.toBeNull();
          await expect(service.listUnassignedProjects()).resolves.toEqual(
            expect.arrayContaining([
              expect.objectContaining({ id: `project-existing-${baseline}` }),
            ]),
          );
        } finally {
          await upgraded.close();
        }
      });
    });
  }

  it('enforces single Project ownership, archive rules, audit events, and cascade cleanup', async () => {
    await withIsolatedPostgresDatabase('domain', async (url) => {
      const db = await Database.connect(url);
      const service = new EngagementService(db);
      try {
        await db.createProject({ id: 'project-atlas-web', name: 'atlas-web' });
        await db.createProject({ id: 'project-atlas-api', name: 'atlas-api' });
        const atlas = await service.create({
          customerName: 'Atlas Synthetic',
          title: 'Atlas rollout',
        });
        const northwind = await service.create({
          customerName: 'Northwind Synthetic',
          title: 'Northwind rollout',
        });

        await service.linkProject(atlas.id, 'project-atlas-web');
        await expect(service.linkProject(northwind.id, 'project-atlas-web')).rejects.toMatchObject({
          code: 'PROJECT_ALREADY_ASSIGNED_TO_ENGAGEMENT',
          statusCode: 409,
        });

        const archived = await service.archive(atlas.id);
        expect(archived).toMatchObject({
          status: 'archived',
          project_count: 1,
        });
        await expect(
          service.update(atlas.id, { title: 'Blocked while archived' }),
        ).rejects.toMatchObject({ code: 'ENGAGEMENT_STATE_INVALID' });
        await expect(service.linkProject(atlas.id, 'project-atlas-api')).rejects.toMatchObject({
          code: 'ENGAGEMENT_STATE_INVALID',
        });
        await expect(service.unlinkProject(atlas.id, 'project-atlas-web')).rejects.toMatchObject({
          code: 'ENGAGEMENT_STATE_INVALID',
        });

        await service.unarchive(atlas.id);
        await db.deleteProject('project-atlas-web');
        await expect(service.get(atlas.id)).resolves.toMatchObject({ project_count: 0 });
        await expect(service.getProjectReference('project-atlas-web')).resolves.toBeNull();

        const activity = await db.findActivityLogRecent(20, {
          correlation_id: atlas.id,
          activity_type: 'engagement',
        });
        expect(activity.map((entry) => entry.event_type)).toEqual(
          expect.arrayContaining([
            'engagement:created',
            'engagement:project_linked',
            'engagement:archived',
            'engagement:unarchived',
          ]),
        );
        const metadataByEvent = new Map(
          activity.map((entry) => [
            entry.event_type,
            JSON.parse(entry.metadata) as Record<string, unknown>,
          ]),
        );
        expect(metadataByEvent.get('engagement:created')).toMatchObject({
          schema_version: 1,
          engagement_id: atlas.id,
          engagement_title: 'Atlas rollout',
          customer_name: 'Atlas Synthetic',
          engagement_status: 'active',
          actor: 'admin',
        });
        expect(metadataByEvent.get('engagement:project_linked')).toMatchObject({
          schema_version: 1,
          engagement_id: atlas.id,
          engagement_title: 'Atlas rollout',
          project_id: 'project-atlas-web',
          project_name: 'atlas-web',
        });
        expect(metadataByEvent.get('engagement:archived')).toMatchObject({
          previous_status: 'active',
          engagement_status: 'archived',
          linked_projects_changed: false,
          deliveries_changed: false,
        });
      } finally {
        await db.close();
      }
    });
  });

  it('serializes archive against concurrent edits and Project links', async () => {
    await withIsolatedPostgresDatabase('archive_race', async (url) => {
      const db = await Database.connect(url);
      const service = new EngagementService(db);
      const blocker = postgres(url, { max: 1, prepare: false });
      let blockerOpen = false;
      try {
        await db.createProject({ id: 'project-archive-race', name: 'archive-race' });
        const engagement = await service.create({
          customerName: 'Race Synthetic',
          title: 'Archive serialization',
        });

        await blocker.unsafe('BEGIN');
        blockerOpen = true;
        await blocker.unsafe('SELECT id FROM engagements WHERE id = $1 FOR UPDATE', [
          engagement.id,
        ]);

        let archiveSettled = false;
        const archivePromise = service.archive(engagement.id).finally(() => {
          archiveSettled = true;
        });
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(archiveSettled).toBe(false);

        const updateRejection = expect(
          service.update(engagement.id, { status: 'on_hold' }),
        ).rejects.toMatchObject({
          code: 'ENGAGEMENT_STATE_INVALID',
        });
        const linkRejection = expect(
          service.linkProject(engagement.id, 'project-archive-race'),
        ).rejects.toMatchObject({
          code: 'ENGAGEMENT_STATE_INVALID',
        });
        await new Promise((resolve) => setTimeout(resolve, 50));
        await blocker.unsafe('COMMIT');
        blockerOpen = false;

        await expect(archivePromise).resolves.toMatchObject({ status: 'archived' });
        await updateRejection;
        await linkRejection;
        await expect(service.get(engagement.id)).resolves.toMatchObject({
          status: 'archived',
          project_count: 0,
        });
      } finally {
        if (blockerOpen) await blocker.unsafe('ROLLBACK').catch(() => undefined);
        await blocker.end({ timeout: 5 });
        await db.close();
      }
    });
  });

  it('never mutates a finalized Receipt snapshot, PDF hash, or evidence version', async () => {
    await withIsolatedPostgresDatabase('receipt_invariant', async (url) => {
      const db = await Database.connect(url);
      const service = new EngagementService(db);
      try {
        const project = await db.createProject({
          id: 'project-receipt-invariant',
          name: 'receipt-invariant',
        });
        const delivery = await db.createDelivery({
          id: 'delivery-receipt-invariant',
          projectId: project.id,
          title: 'Synthetic finalized package',
          deliveryType: 'artifact_delivery',
        });
        const blob = await db.upsertArtifactBlob({
          sha256: 'f'.repeat(64),
          mimeType: 'application/pdf',
          sizeBytes: 100,
          storageKey: `sha256/ff/${'f'.repeat(64)}`,
        });
        const approved = await db.setDeliveryStatus(delivery.id, 'approved');
        const previewed = await db.recordDeliveryReceiptPreview(
          delivery.id,
          approved.evidence_version,
        );
        await db.finalizeDeliveryReceipt({
          id: 'receipt-invariant',
          deliveryId: delivery.id,
          snapshotJson: {
            schema_version: 1,
            generated_at: NOW,
            customer: 'Synthetic only',
          },
          pdfBlobId: blob.id,
          pdfSha256: blob.sha256,
          finalizedBy: 'admin',
          finalizedAt: NOW,
          expectedEvidenceVersion: previewed.evidence_version,
        });
        const beforeReceipt = await db.getDeliveryReceipt(delivery.id);
        const beforeDelivery = await db.requireDelivery(delivery.id);

        const engagement = await service.create({
          customerName: 'Invariant Synthetic',
          title: 'Receipt invariant',
        });
        await service.update(engagement.id, { summary: 'Classification changed' });
        await service.linkProject(engagement.id, project.id);
        await service.archive(engagement.id);
        await service.unarchive(engagement.id);
        await service.unlinkProject(engagement.id, project.id);

        const afterReceipt = await db.getDeliveryReceipt(delivery.id);
        const afterDelivery = await db.requireDelivery(delivery.id);
        expect(afterReceipt?.snapshot_json).toEqual(beforeReceipt?.snapshot_json);
        expect(afterReceipt?.pdf_sha256).toBe(beforeReceipt?.pdf_sha256);
        expect(afterReceipt?.pdf_blob_id).toBe(beforeReceipt?.pdf_blob_id);
        expect(afterDelivery.evidence_version).toBe(beforeDelivery.evidence_version);
        expect(afterDelivery.previewed_evidence_version).toBe(
          beforeDelivery.previewed_evidence_version,
        );
      } finally {
        await db.close();
      }
    });
  });
});
