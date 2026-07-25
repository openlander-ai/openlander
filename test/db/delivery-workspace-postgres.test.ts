import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { PDFDocument } from 'pdf-lib';
import postgres from 'postgres';
import { describe, expect, it } from 'vitest';
import { Database } from '../../src/db/index.js';
import { createDrizzleDatabase } from '../../src/db/drizzle.js';
import { ArtifactStore } from '../../src/delivery/artifact-store.js';
import { DeliveryService } from '../../src/delivery/delivery-service.js';

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
  const databaseName = `ol_delivery_${label}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
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

describeWithDatabase('Delivery Workspace persistence on Postgres', () => {
  it('upgrades an existing 0012 database to the Delivery Workspace schema', async () => {
    await withIsolatedPostgresDatabase('upgrade_0012', async (url) => {
      const migrationDirectory = await mkdtemp(join(tmpdir(), 'openlander-0012-migrations-'));
      try {
        await mkdir(join(migrationDirectory, 'meta'), { recursive: true });
        const journal = JSON.parse(
          await readFile(join(process.cwd(), 'drizzle/meta/_journal.json'), 'utf8'),
        ) as {
          version: string;
          dialect: string;
          entries: Array<{ idx: number; tag: string }>;
        };
        const entries = journal.entries.filter((entry) => entry.idx <= 12);
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

        const upgraded = await Database.connect(url);
        try {
          const project = await upgraded.createProject({
            id: 'project-upgraded',
            name: 'upgraded-project',
          });
          const delivery = await upgraded.createDelivery({
            id: 'delivery-upgraded',
            projectId: project.id,
            title: 'Upgraded Delivery',
          });
          expect(delivery.project_id).toBe(project.id);
          expect(await upgraded.listDeliveryGates(delivery.id)).toHaveLength(3);
        } finally {
          await upgraded.close();
        }
      } finally {
        await rm(migrationDirectory, { recursive: true, force: true });
      }
    });
  });

  it('creates default Gates and invalidates approval when a newer revision is added', async () => {
    await withIsolatedPostgresDatabase('revision', async (url) => {
      const db = await Database.connect(url);
      try {
        const project = await db.createProject({
          id: 'project-delivery',
          name: 'delivery-project',
        });
        const delivery = await db.createDelivery({
          id: 'delivery-1',
          projectId: project.id,
          title: 'Review package',
          deliveryType: 'software_release',
        });
        expect(await db.listDeliveryGates(delivery.id)).toMatchObject([
          { gate_key: 'review', required: true },
          { gate_key: 'qa', required: true },
          { gate_key: 'data', required: false },
        ]);

        const blob = await db.upsertArtifactBlob({
          sha256: 'a'.repeat(64),
          mimeType: 'application/pdf',
          sizeBytes: 20,
          storageKey: `sha256/aa/${'a'.repeat(64)}`,
        });
        const first = await db.createDeliveryArtifact({
          id: 'artifact-r1',
          deliveryId: delivery.id,
          blobId: blob.id,
          logicalKey: 'storyboard',
          revision: 1,
          kind: 'companion_pdf',
          originalFilename: 'storyboard-r1.pdf',
        });
        await db.updateDeliveryArtifact(first.id, { status: 'approved' });
        await db.createDeliveryApproval({
          deliveryId: delivery.id,
          artifactIds: [first.id],
          approverDisplayName: 'Customer',
          approvalExcerpt: 'Approved',
          sourceType: 'slack',
          approvedAt: NOW,
        });
        await db.setDeliveryStatus(delivery.id, 'approved');

        await db.createDeliveryArtifact({
          id: 'artifact-r2',
          deliveryId: delivery.id,
          blobId: blob.id,
          logicalKey: 'storyboard',
          revision: 2,
          kind: 'companion_pdf',
          originalFilename: 'storyboard-r2.pdf',
        });

        await expect(db.getDelivery(delivery.id)).resolves.toMatchObject({ status: 'in_review' });
        await expect(db.getDeliveryArtifact(first.id)).resolves.toMatchObject({
          status: 'superseded',
        });
        const approvals = await db.listDeliveryApprovals(delivery.id);
        expect(approvals[0]?.invalidated_at).toBeTruthy();
        expect(approvals[0]?.invalidated_reason).toContain('revision 2');
      } finally {
        await db.close();
      }
    });
  });

  it('serializes concurrent Receipt finalization and locks the delivered record', async () => {
    await withIsolatedPostgresDatabase('finalize', async (url) => {
      const db = await Database.connect(url);
      try {
        const project = await db.createProject({
          id: 'project-finalize',
          name: 'finalize-project',
        });
        const delivery = await db.createDelivery({
          id: 'delivery-finalize',
          projectId: project.id,
          title: 'Final package',
          deliveryType: 'artifact_delivery',
        });
        const blob = await db.upsertArtifactBlob({
          sha256: 'b'.repeat(64),
          mimeType: 'application/pdf',
          sizeBytes: 100,
          storageKey: `sha256/bb/${'b'.repeat(64)}`,
        });
        await db.setDeliveryStatus(delivery.id, 'approved');
        const approved = await db.requireDelivery(delivery.id);
        const previewed = await db.recordDeliveryReceiptPreview(
          delivery.id,
          approved.evidence_version,
        );

        const [first, second] = await Promise.all([
          db.finalizeDeliveryReceipt({
            id: 'receipt-1',
            deliveryId: delivery.id,
            snapshotJson: { schema_version: 1 },
            pdfBlobId: blob.id,
            pdfSha256: blob.sha256,
            finalizedBy: 'admin',
            finalizedAt: NOW,
            expectedEvidenceVersion: previewed.evidence_version,
          }),
          db.finalizeDeliveryReceipt({
            id: 'receipt-2',
            deliveryId: delivery.id,
            snapshotJson: { schema_version: 1 },
            pdfBlobId: blob.id,
            pdfSha256: blob.sha256,
            finalizedBy: 'admin',
            finalizedAt: NOW,
            expectedEvidenceVersion: previewed.evidence_version,
          }),
        ]);

        expect(second.id).toBe(first.id);
        await expect(db.getDelivery(delivery.id)).resolves.toMatchObject({ status: 'delivered' });
        await expect(
          db.updateDelivery(delivery.id, { title: 'Mutated after delivery' }),
        ).rejects.toMatchObject({ code: 'DELIVERY_STATE_INVALID' });
        await expect(
          db.createDeliveryArtifact({
            deliveryId: delivery.id,
            blobId: blob.id,
            logicalKey: 'late',
            revision: 1,
            kind: 'companion_pdf',
            originalFilename: 'late.pdf',
          }),
        ).rejects.toMatchObject({ code: 'DELIVERY_STATE_INVALID' });
      } finally {
        await db.close();
      }
    });
  });

  it('invalidates a Receipt preview when evidence changes before finalization', async () => {
    await withIsolatedPostgresDatabase('preview_version', async (url) => {
      const db = await Database.connect(url);
      try {
        const project = await db.createProject({
          id: 'project-preview-version',
          name: 'preview-version-project',
        });
        const delivery = await db.createDelivery({
          id: 'delivery-preview-version',
          projectId: project.id,
          title: 'Previewed package',
          deliveryType: 'artifact_delivery',
        });
        const blob = await db.upsertArtifactBlob({
          sha256: 'c'.repeat(64),
          mimeType: 'application/pdf',
          sizeBytes: 100,
          storageKey: `sha256/cc/${'c'.repeat(64)}`,
        });
        const approved = await db.setDeliveryStatus(delivery.id, 'approved');
        const previewed = await db.recordDeliveryReceiptPreview(
          delivery.id,
          approved.evidence_version,
        );

        await db.recordDeliveryGateResult({
          deliveryId: delivery.id,
          gateKey: 'review',
          status: 'passed',
          summary: 'Changed after preview',
        });

        await expect(
          db.finalizeDeliveryReceipt({
            id: 'receipt-stale',
            deliveryId: delivery.id,
            snapshotJson: { schema_version: 1 },
            pdfBlobId: blob.id,
            pdfSha256: blob.sha256,
            finalizedBy: 'admin',
            finalizedAt: NOW,
            expectedEvidenceVersion: previewed.evidence_version,
          }),
        ).rejects.toMatchObject({ code: 'DELIVERY_STATE_INVALID' });
        await expect(db.getDelivery(delivery.id)).resolves.toMatchObject({
          status: 'approved',
          previewed_evidence_version: previewed.evidence_version,
          evidence_version: previewed.evidence_version + 1,
        });
      } finally {
        await db.close();
      }
    });
  });

  it('replays durable Gate idempotency results and rejects key reuse with a new request', async () => {
    await withIsolatedPostgresDatabase('gate_idempotency', async (url) => {
      const db = await Database.connect(url);
      try {
        const project = await db.createProject({
          id: 'project-gate-idempotency',
          name: 'gate-idempotency-project',
        });
        const delivery = await db.createDelivery({
          id: 'delivery-gate-idempotency',
          projectId: project.id,
          title: 'Gate retry package',
        });
        const firstHash = '1'.repeat(64);
        const secondHash = '2'.repeat(64);

        const first = await db.recordDeliveryGateResult({
          deliveryId: delivery.id,
          gateKey: 'qa',
          status: 'passed',
          summary: 'First CI result',
          idempotencyKey: 'ci-run-1',
          requestSha256: firstHash,
        });
        await db.recordDeliveryGateResult({
          deliveryId: delivery.id,
          gateKey: 'qa',
          status: 'failed',
          summary: 'Later CI result',
          idempotencyKey: 'ci-run-2',
          requestSha256: secondHash,
        });
        const replay = await db.recordDeliveryGateResult({
          deliveryId: delivery.id,
          gateKey: 'qa',
          status: 'passed',
          summary: 'First CI result',
          idempotencyKey: 'ci-run-1',
          requestSha256: firstHash,
        });

        expect(replay).toEqual(first);
        await expect(db.listDeliveryGates(delivery.id)).resolves.toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              gate_key: 'qa',
              status: 'failed',
              summary: 'Later CI result',
            }),
          ]),
        );
        await expect(
          db.recordDeliveryGateResult({
            deliveryId: delivery.id,
            gateKey: 'qa',
            status: 'warning',
            summary: 'Conflicting retry',
            idempotencyKey: 'ci-run-1',
            requestSha256: '3'.repeat(64),
          }),
        ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_CONFLICT' });
      } finally {
        await db.close();
      }
    });
  });

  it('dogfoods a synthetic storyboard flow through immutable Receipt download', async () => {
    await withIsolatedPostgresDatabase('dogfood', async (url) => {
      const artifactDirectory = await mkdtemp(join(tmpdir(), 'openlander-delivery-dogfood-'));
      const db = await Database.connect(url);
      const service = new DeliveryService(db, new ArtifactStore(artifactDirectory));
      try {
        const project = await db.createProject({
          id: 'project-demo',
          name: 'demo-customer',
        });
        await db.createDeployLog({
          id: 'deploy-production',
          projectId: project.id,
          environmentId: `${project.id}-production`,
          status: 'success',
          trigger: 'api',
          commitSha: 'demo-release-sha',
        });
        const delivery = await service.createDelivery({
          projectId: project.id,
          title: 'DemoCo 스토리보드 검토본',
          summary: '고객 피드백을 반영한 릴리스 후보',
          deliveryType: 'software_release',
          maturity: 'release_candidate',
          limitations: '없음',
        });

        const html = await service.uploadArtifact({
          deliveryId: delivery.id,
          source: Readable.from(['<!doctype html><title>DemoCo storyboard</title>']),
          filename: '스토리보드.html',
          declaredMimeType: 'text/html',
          logicalKey: 'storyboard',
          revision: 1,
          kind: 'review_html',
          receiptOrder: 1,
        });
        const companionDocument = await PDFDocument.create();
        companionDocument.addPage([595, 842]);
        const companion = await service.uploadArtifact({
          deliveryId: delivery.id,
          source: Readable.from([await companionDocument.save()]),
          filename: '스토리보드.pdf',
          declaredMimeType: 'application/pdf',
          logicalKey: 'storyboard',
          revision: 1,
          kind: 'companion_pdf',
          receiptOrder: 2,
          companionForArtifactId: html.id,
        });
        const junit = await service.uploadArtifact({
          deliveryId: delivery.id,
          source: Readable.from([
            '<testsuite tests="12" failures="0" errors="0" skipped="0" time="1.5"/>',
          ]),
          filename: 'qa-junit.xml',
          declaredMimeType: 'application/junit+xml',
          logicalKey: 'qa-junit',
          revision: 1,
          kind: 'qa_report',
          includeInReceipt: false,
        });
        await service.setArtifactStatus(delivery.id, html.id, 'approved');
        await service.setArtifactStatus(delivery.id, companion.id, 'approved');

        const feedback = await service.recordFeedback({
          deliveryId: delivery.id,
          sourceType: 'slack',
          sourceUrl: 'https://example.slack.com/archives/review/thread',
          authorDisplayName: 'Customer reviewer',
          rawText: 'CTA 문구를 확정하고 이 버전으로 진행해 주세요.',
          occurredAt: NOW,
        });
        await service.attachExternalUrl({
          deliveryId: delivery.id,
          provider: 'slack',
          label: 'Customer review thread',
          url: 'https://example.slack.com/archives/review/thread',
        });
        const [decision, changeRequest] = await service.submitWorkItemDrafts(delivery.id, [
          {
            feedbackSourceId: feedback.id,
            kind: 'decision',
            title: 'CTA 문구 확정',
            detail: '현재 문구를 사용한다.',
          },
          {
            feedbackSourceId: feedback.id,
            kind: 'change_request',
            title: '검토 문구 반영',
            detail: '고객 코멘트를 최종본에 반영한다.',
          },
        ]);
        if (!decision || !changeRequest) throw new Error('Expected dogfood work items.');
        await service.updateWorkItem(delivery.id, decision.id, 'confirmed');
        await service.updateWorkItem(delivery.id, changeRequest.id, 'confirmed');
        await service.updateWorkItem(
          delivery.id,
          changeRequest.id,
          'resolved',
          '스토리보드 r1에 반영됨',
        );

        await service.transition(delivery.id, 'in_review');
        await service.recordApproval({
          deliveryId: delivery.id,
          artifactIds: [html.id, companion.id],
          approverDisplayName: 'Customer reviewer',
          approvalExcerpt: '이 버전으로 진행해 주세요.',
          sourceType: 'slack',
          sourceUrl: 'https://example.slack.com/archives/review/thread',
          approvedAt: NOW,
        });
        await service.recordGateResult({
          deliveryId: delivery.id,
          gateKey: 'review',
          status: 'passed',
          summary: 'Customer review complete',
        });
        await service.recordGateResult({
          deliveryId: delivery.id,
          gateKey: 'qa',
          status: 'passed',
          reportArtifactId: junit.id,
        });
        await service.linkDeploy({
          deliveryId: delivery.id,
          deployId: 'deploy-production',
          relation: 'released',
        });
        await service.transition(delivery.id, 'approved');

        await expect(service.getReadiness(delivery.id)).resolves.toMatchObject({ ready: true });
        const preview = await service.generateReceiptPreview(delivery.id);
        expect(preview.pageCount).toBeGreaterThan(1);
        const receipt = await service.finalizeReceipt(delivery.id, 'admin');
        const download = await service.getReceiptDownload(delivery.id);
        const receiptPdf = await PDFDocument.load(
          await service.artifactStore.read(download.blob.storage_key),
        );

        expect(download.receipt.id).toBe(receipt.id);
        expect(receiptPdf.getPageCount()).toBe(preview.pageCount);
        await expect(db.getDelivery(delivery.id)).resolves.toMatchObject({
          status: 'delivered',
        });
      } finally {
        await db.close();
        await rm(artifactDirectory, { recursive: true, force: true });
      }
    });
  }, 180_000);
});
