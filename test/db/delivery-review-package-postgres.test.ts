import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { describe, expect, it } from 'vitest';

import { Database } from '../../src/db/index.js';
import { createDrizzleDatabase } from '../../src/db/drizzle.js';

const databaseUrl = process.env.OPENLANDER_DATABASE_URL ?? process.env.DATABASE_URL ?? '';
const describeWithDatabase = databaseUrl ? describe : describe.skip;

function quotePgIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function maintenanceUrl(url: string): string {
  const parsed = new URL(url);
  parsed.pathname = '/postgres';
  return parsed.toString();
}

async function withIsolatedDatabase(
  label: string,
  callback: (url: string) => Promise<void>,
): Promise<void> {
  const databaseName = `ol_review_package_${label}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const admin = postgres(maintenanceUrl(databaseUrl), { max: 1, prepare: false });
  try {
    await admin.unsafe(`CREATE DATABASE ${quotePgIdentifier(databaseName)}`);
    const isolated = new URL(databaseUrl);
    isolated.pathname = `/${databaseName}`;
    await callback(isolated.toString());
  } finally {
    await admin
      .unsafe(`DROP DATABASE IF EXISTS ${quotePgIdentifier(databaseName)} WITH (FORCE)`)
      .catch(async () => {
        await admin.unsafe(`DROP DATABASE IF EXISTS ${quotePgIdentifier(databaseName)}`);
      });
    await admin.end({ timeout: 5 });
  }
}

async function migrateThrough(url: string, lastIndex: number): Promise<void> {
  const migrationDirectory = await mkdtemp(join(tmpdir(), 'openlander-review-migrations-'));
  try {
    await mkdir(join(migrationDirectory, 'meta'), { recursive: true });
    const journal = JSON.parse(
      await readFile(join(process.cwd(), 'drizzle/meta/_journal.json'), 'utf8'),
    ) as {
      version: string;
      dialect: string;
      entries: Array<{ idx: number; tag: string }>;
    };
    const entries = journal.entries.filter((entry) => entry.idx <= lastIndex);
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

describeWithDatabase('Delivery review packages on Postgres', () => {
  it('upgrades 0022 without backfilling packages or changing finalized Receipt hashes', async () => {
    await withIsolatedDatabase('upgrade', async (url) => {
      await migrateThrough(url, 22);
      const client = postgres(url, { max: 1, prepare: false });
      const hash = '9'.repeat(64);
      await client`
        INSERT INTO projects (id, name, display_name)
        VALUES ('project-upgrade-package', 'project-upgrade-package', 'Upgrade')
      `;
      await client`
        INSERT INTO deliveries (id, project_id, title, status)
        VALUES ('delivery-upgrade-package', 'project-upgrade-package', 'Finalized review', 'delivered')
      `;
      await client`
        INSERT INTO artifact_blobs (id, sha256, mime_type, size_bytes, storage_key)
        VALUES (${hash}, ${hash}, 'application/pdf', 12, ${`sha256/99/${hash}`})
      `;
      await client`
        INSERT INTO delivery_receipts
          (id, delivery_id, snapshot_json, pdf_blob_id, pdf_sha256, finalized_by, finalized_at)
        VALUES
          ('receipt-upgrade-package', 'delivery-upgrade-package', ${client.json({ fixed: true })}, ${hash}, ${hash}, 'admin', '2026-07-28T00:00:00.000Z')
      `;
      await client.end({ timeout: 5 });

      const db = await Database.connect(url);
      try {
        expect(await db.listDeliveryReviewPackages('delivery-upgrade-package')).toEqual([]);
        await expect(db.getDeliveryReceipt('delivery-upgrade-package')).resolves.toMatchObject({
          id: 'receipt-upgrade-package',
          pdf_sha256: hash,
          snapshot_json: { fixed: true },
        });
      } finally {
        await db.close();
      }
    });
  });

  it('keeps staged files invisible, publishes one PDF row, and approves the whole package', async () => {
    await withIsolatedDatabase('publish', async (url) => {
      const db = await Database.connect(url);
      try {
        const project = await db.createProject({
          id: 'project-review-package',
          name: 'project-review-package',
        });
        const delivery = await db.createDelivery({
          id: 'delivery-review-package',
          projectId: project.id,
          title: 'Customer review',
          deliveryType: 'artifact_delivery',
          limitations: 'None',
        });
        const legacyBlob = await db.upsertArtifactBlob({
          sha256: '1'.repeat(64),
          mimeType: 'application/pdf',
          sizeBytes: 10,
          storageKey: `sha256/11/${'1'.repeat(64)}`,
        });
        await db.createDeliveryArtifact({
          id: 'legacy-review-r5',
          deliveryId: delivery.id,
          blobId: legacyBlob.id,
          logicalKey: 'legacy-review',
          revision: 5,
          kind: 'companion_pdf',
          originalFilename: 'legacy-r5.pdf',
        });
        const base = await db.requireDelivery(delivery.id);
        const prepared = await db.createDeliveryReviewPackage({
          deliveryId: delivery.id,
          reviewGateKey: 'review',
          reviewNote: 'Review these files together.',
          manifestSha256: 'a'.repeat(64),
          overview: { mode: 'update', summary: 'Current customer review package' },
          overviewBeforeSha256: 'b'.repeat(64),
          overviewAfterSha256: 'c'.repeat(64),
          files: [
            {
              role: 'review_document',
              filename: 'review.pdf',
              expected_sha256: '2'.repeat(64),
              expected_size_bytes: 20,
              mime_type: 'application/pdf',
            },
            {
              role: 'interactive_preview',
              filename: 'review.html',
              expected_sha256: '3'.repeat(64),
              expected_size_bytes: 30,
              mime_type: 'text/html',
            },
            {
              role: 'representative_image',
              filename: 'screen.png',
              expected_sha256: '4'.repeat(64),
              expected_size_bytes: 40,
              mime_type: 'image/png',
            },
          ],
          replaceDraft: false,
          createdBy: 'agent',
        });
        expect(prepared.package.revision).toBe(6);
        expect(await db.listDeliveryArtifacts(delivery.id)).toHaveLength(1);

        const pdfBlob = await db.upsertArtifactBlob({
          sha256: '2'.repeat(64),
          mimeType: 'application/pdf',
          sizeBytes: 20,
          storageKey: `sha256/22/${'2'.repeat(64)}`,
        });
        const htmlBlob = await db.upsertArtifactBlob({
          sha256: '3'.repeat(64),
          mimeType: 'text/html',
          sizeBytes: 30,
          storageKey: `sha256/33/${'3'.repeat(64)}`,
        });
        const pdfItem = prepared.items.find(({ item }) => item.role === 'review_document')?.item;
        const htmlItem = prepared.items.find(
          ({ item }) => item.role === 'interactive_preview',
        )?.item;
        if (!pdfItem || !htmlItem) throw new Error('prepared items missing');
        await db.recordDeliveryReviewPackageUploadSuccess({ itemId: pdfItem.id, blob: pdfBlob });

        await expect(
          db.publishDeliveryReviewPackage({
            packageId: prepared.package.id,
            expectedManifestSha256: prepared.package.manifest_sha256,
            expectedDeliveryEvidenceVersion: base.evidence_version,
            actor: 'agent',
          }),
        ).rejects.toMatchObject({ code: 'REVIEW_PACKAGE_NOT_READY' });
        expect(await db.listDeliveryArtifacts(delivery.id)).toHaveLength(1);

        await db.recordDeliveryReviewPackageUploadSuccess({ itemId: htmlItem.id, blob: htmlBlob });

        const published = await db.publishDeliveryReviewPackage({
          packageId: prepared.package.id,
          expectedManifestSha256: prepared.package.manifest_sha256,
          expectedDeliveryEvidenceVersion: base.evidence_version,
          actor: 'agent',
        });
        expect(published.artifacts).toHaveLength(2);
        expect(published.primaryArtifact.blob_id).toBe(pdfBlob.id);
        const htmlArtifact = published.artifacts.find(
          (artifact) => artifact.kind === 'review_html',
        );
        expect(htmlArtifact?.companion_pdf_artifact_id).toBe(published.primaryArtifact.id);
        expect(
          published.artifacts.filter((artifact) => artifact.blob_id === pdfBlob.id),
        ).toHaveLength(1);
        expect(published.gate).toMatchObject({
          status: 'pending',
          review_package_id: prepared.package.id,
          report_artifact_id: published.primaryArtifact.id,
        });
        expect(published.delivery).toMatchObject({
          status: 'in_review',
          summary: 'Current customer review package',
        });
        const replayed = await db.publishDeliveryReviewPackage({
          packageId: prepared.package.id,
          expectedManifestSha256: prepared.package.manifest_sha256,
          expectedDeliveryEvidenceVersion: base.evidence_version,
          actor: 'agent',
        });
        expect(replayed.artifacts.map((artifact) => artifact.id)).toEqual(
          published.artifacts.map((artifact) => artifact.id),
        );
        expect(await db.listDeliveryArtifacts(delivery.id)).toHaveLength(3);

        const accepted = await db.acceptDeliveryReviewPackage({
          deliveryId: delivery.id,
          gateKey: 'review',
          packageId: prepared.package.id,
          expectedManifestSha256: prepared.package.manifest_sha256,
          recordedBy: 'reviewer',
        });
        expect(accepted.artifacts.every((artifact) => artifact.status === 'approved')).toBe(true);
        expect(accepted.approval).toMatchObject({
          review_package_id: prepared.package.id,
          package_manifest_sha256: prepared.package.manifest_sha256,
          artifact_ids: expect.arrayContaining(published.artifacts.map((artifact) => artifact.id)),
        });

        const afterAcceptance = await db.requireDelivery(delivery.id);
        const nextPackage = await db.createDeliveryReviewPackage({
          deliveryId: delivery.id,
          reviewGateKey: 'review',
          reviewNote: 'Review the replacement package.',
          manifestSha256: 'd'.repeat(64),
          overview: { mode: 'keep', reason: 'The Delivery overview is still current.' },
          overviewBeforeSha256: 'e'.repeat(64),
          overviewAfterSha256: 'e'.repeat(64),
          files: [
            {
              role: 'review_document',
              filename: 'review-r7.pdf',
              expected_sha256: '5'.repeat(64),
              expected_size_bytes: 50,
              mime_type: 'application/pdf',
            },
          ],
          replaceDraft: false,
          createdBy: 'agent',
        });
        const nextBlob = await db.upsertArtifactBlob({
          sha256: '5'.repeat(64),
          mimeType: 'application/pdf',
          sizeBytes: 50,
          storageKey: `sha256/55/${'5'.repeat(64)}`,
        });
        const nextItem = nextPackage.items[0]?.item;
        if (!nextItem) throw new Error('replacement package item missing');
        await db.recordDeliveryReviewPackageUploadSuccess({ itemId: nextItem.id, blob: nextBlob });
        const replacement = await db.publishDeliveryReviewPackage({
          packageId: nextPackage.package.id,
          expectedManifestSha256: nextPackage.package.manifest_sha256,
          expectedDeliveryEvidenceVersion: afterAcceptance.evidence_version,
          actor: 'agent',
        });
        expect(replacement.package.revision).toBe(7);
        expect(replacement.gate).toMatchObject({
          status: 'pending',
          review_package_id: nextPackage.package.id,
        });
        expect(await db.listDeliveryApprovals(delivery.id)).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: accepted.approval.id,
              invalidated_at: expect.any(String),
            }),
          ]),
        );
      } finally {
        await db.close();
      }
    });
  });

  it('expires seven-day drafts and releases only unreferenced staged blob rows', async () => {
    await withIsolatedDatabase('cleanup', async (url) => {
      const db = await Database.connect(url);
      try {
        const project = await db.createProject({
          id: 'project-review-cleanup',
          name: 'project-review-cleanup',
        });
        const delivery = await db.createDelivery({
          id: 'delivery-review-cleanup',
          projectId: project.id,
          title: 'Cleanup review package',
          deliveryType: 'artifact_delivery',
        });
        const preparedAt = new Date('2026-07-01T00:00:00.000Z');
        const prepared = await db.createDeliveryReviewPackage({
          deliveryId: delivery.id,
          reviewGateKey: 'review',
          reviewNote: 'Temporary review package',
          manifestSha256: '6'.repeat(64),
          overview: { mode: 'keep', reason: 'Still current' },
          overviewBeforeSha256: '7'.repeat(64),
          overviewAfterSha256: '7'.repeat(64),
          files: [
            {
              role: 'review_document',
              filename: 'temporary.pdf',
              expected_sha256: '8'.repeat(64),
              expected_size_bytes: 80,
              mime_type: 'application/pdf',
            },
          ],
          replaceDraft: false,
          createdBy: 'agent',
          now: preparedAt,
        });
        const blob = await db.upsertArtifactBlob({
          sha256: '8'.repeat(64),
          mimeType: 'application/pdf',
          sizeBytes: 80,
          storageKey: `sha256/88/${'8'.repeat(64)}`,
        });
        const item = prepared.items[0]?.item;
        if (!item) throw new Error('cleanup package item missing');
        await db.recordDeliveryReviewPackageUploadSuccess({
          itemId: item.id,
          blob,
          now: preparedAt,
        });

        const result = await db.cleanupDeliveryReviewPackageStaging({
          now: new Date('2026-07-09T00:00:00.000Z'),
        });

        expect(result).toEqual({ expiredPackages: 1, releasedItems: 1, deletedBlobRows: 1 });
        expect(await db.getArtifactBlob(blob.id)).toBeNull();
        await expect(db.getDeliveryReviewPackage(prepared.package.id)).resolves.toMatchObject({
          package: { status: 'expired' },
          items: [{ item: { blob_id: null, actual_sha256: blob.sha256 } }],
        });
      } finally {
        await db.close();
      }
    });
  });
});
