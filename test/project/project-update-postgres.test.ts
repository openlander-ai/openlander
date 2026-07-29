import postgres from 'postgres';
import { describe, expect, it } from 'vitest';

import { Database } from '../../src/db/index.js';

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

async function withIsolatedDatabase(fn: (url: string) => Promise<void>): Promise<void> {
  const databaseName = `ol_project_updates_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const admin = postgres(maintenanceUrl(databaseUrl), { max: 1, prepare: false });
  const quotedName = quotePgIdentifier(databaseName);
  try {
    await admin.unsafe(`CREATE DATABASE ${quotedName}`);
    const isolated = new URL(databaseUrl);
    isolated.pathname = `/${databaseName}`;
    await fn(isolated.toString());
  } finally {
    await admin.unsafe(`DROP DATABASE IF EXISTS ${quotedName} WITH (FORCE)`).catch(async () => {
      await admin.unsafe(`DROP DATABASE IF EXISTS ${quotedName}`);
    });
    await admin.end({ timeout: 5 });
  }
}

describeWithDatabase('Project Update Postgres contract', () => {
  it('records durable context, links a Delivery snapshot, and detects later change', async () => {
    await withIsolatedDatabase(async (url) => {
      const db = await Database.connect(url);
      const raw = postgres(url, { max: 1, prepare: false });
      try {
        await db.createProjectGroup({ id: 'project-a', name: 'project-a' });
        await db.createProjectGroup({ id: 'project-b', name: 'project-b' });

        const first = await db.recordProjectUpdate({
          id: 'pupd-first',
          projectId: 'project-a',
          summary: 'Customer meeting clarified the next implementation slice.',
          occurredAt: '2026-07-29T01:00:00.000Z',
          sources: [{ source_type: 'meeting', label: '7/29 customer meeting' }],
          entries: [
            {
              kind: 'decision',
              title: 'Use a mock SI adapter first',
              detail: 'Keep the external interface replaceable until the contract is fixed.',
              status: 'accepted',
            },
            {
              kind: 'dependency',
              title: 'Confirm the SI API contract',
              detail: 'Payload, authentication, retry, and idempotency are still open.',
              status: 'open',
            },
          ],
          transitions: [],
          createdBy: 'agent-a',
        });
        const dependency = first.items.find((item) => item.kind === 'dependency');
        expect(dependency).toBeDefined();
        if (!dependency) throw new Error('Dependency item was not created');

        const context = await db.getProjectUpdateContext('project-a', 50, 10);
        expect(context.counts).toMatchObject({ 'decision:accepted': 1, 'dependency:open': 1 });
        expect(context.currentItems).toHaveLength(2);

        const delivery = await db.createDelivery({
          id: 'delivery-a',
          projectId: 'project-a',
          title: 'SI interface vertical slice',
          createdBy: 'agent-a',
          gates: [],
          sourceProjectUpdateItemIds: [dependency.id],
          contextLinkedBy: 'agent-a',
        });
        expect(delivery.id).toBe('delivery-a');
        expect(await db.listDeliveryProjectContext(delivery.id)).toMatchObject([
          { item: { id: dependency.id, status: 'open' }, contextChanged: false },
        ]);
        const receiptSha = 'f'.repeat(64);
        await raw.unsafe(`
          INSERT INTO artifact_blobs (id, sha256, mime_type, size_bytes, storage_key)
          VALUES ('blob-receipt', '${receiptSha}', 'application/pdf', 3, 'sha256/ff/${receiptSha}')
        `);
        await raw.unsafe(`
          INSERT INTO delivery_receipts (
            id, delivery_id, snapshot_json, pdf_blob_id, pdf_sha256, finalized_by, finalized_at
          ) VALUES (
            'receipt-a', 'delivery-a', '{"schema_version":1,"scope":"fixed"}',
            'blob-receipt', '${receiptSha}', 'agent-a', '2026-07-29T01:30:00.000Z'
          )
        `);
        const receiptBefore = await db.getDeliveryReceipt(delivery.id);
        const deliveryBefore = await db.requireDelivery(delivery.id);

        const resolved = await db.recordProjectUpdate({
          id: 'pupd-resolved',
          projectId: 'project-a',
          summary: 'The SI team supplied the initial interface contract.',
          occurredAt: '2026-07-29T02:00:00.000Z',
          sources: [
            {
              source_type: 'repository',
              label: 'SI interface contract',
              locator: 'docs/interfaces/si-api.md',
              revision: 'abc123',
            },
          ],
          entries: [],
          transitions: [
            {
              itemId: dependency.id,
              expectedStatus: 'open',
              status: 'resolved',
              note: 'Initial payload and authentication contract received.',
            },
          ],
          createdBy: 'agent-b',
        });
        expect(resolved.affectedDeliveryIds).toEqual(['delivery-a']);
        expect(await db.listDeliveryProjectContext(delivery.id)).toMatchObject([
          {
            item: { id: dependency.id, status: 'resolved' },
            linkedStatus: 'open',
            contextChanged: true,
          },
        ]);
        const receiptAfter = await db.getDeliveryReceipt(delivery.id);
        const deliveryAfter = await db.requireDelivery(delivery.id);
        expect(receiptAfter?.snapshot_json).toEqual(receiptBefore?.snapshot_json);
        expect(receiptAfter?.pdf_sha256).toBe(receiptBefore?.pdf_sha256);
        expect(deliveryAfter.evidence_version).toBe(deliveryBefore.evidence_version);

        await expect(
          db.recordProjectUpdate({
            id: 'pupd-conflict',
            projectId: 'project-a',
            summary: 'Stale agent tried to resolve the same dependency.',
            occurredAt: '2026-07-29T03:00:00.000Z',
            sources: [{ source_type: 'meeting', label: 'stale handoff' }],
            entries: [],
            transitions: [
              {
                itemId: dependency.id,
                expectedStatus: 'open',
                status: 'dismissed',
                note: 'Stale decision.',
              },
            ],
            createdBy: 'agent-c',
          }),
        ).rejects.toMatchObject({ code: 'PROJECT_UPDATE_ITEM_STATUS_CONFLICT' });
        await expect(db.getProjectUpdate('pupd-conflict')).resolves.toBeNull();

        const concurrentSource = await db.recordProjectUpdate({
          id: 'pupd-concurrent-source',
          projectId: 'project-a',
          summary: 'A new schedule risk needs one owner.',
          occurredAt: '2026-07-29T03:30:00.000Z',
          sources: [{ source_type: 'meeting', label: 'schedule review' }],
          entries: [
            {
              kind: 'risk',
              title: 'Storyboard receipt may slip',
              detail: 'The planned implementation start depends on the revised storyboard.',
              status: 'open',
            },
          ],
          transitions: [],
          createdBy: 'agent-a',
        });
        const concurrentItem = concurrentSource.items[0];
        if (!concurrentItem) throw new Error('Concurrent source item was not created');
        const concurrentResults = await Promise.allSettled([
          db.recordProjectUpdate({
            id: 'pupd-concurrent-resolve',
            projectId: 'project-a',
            summary: 'Storyboard received.',
            occurredAt: '2026-07-29T04:00:00.000Z',
            sources: [{ source_type: 'meeting', label: 'storyboard handoff' }],
            entries: [],
            transitions: [
              {
                itemId: concurrentItem.id,
                expectedStatus: 'open',
                status: 'resolved',
                note: 'The revised storyboard arrived.',
              },
            ],
            createdBy: 'agent-b',
          }),
          db.recordProjectUpdate({
            id: 'pupd-concurrent-dismiss',
            projectId: 'project-a',
            summary: 'The schedule risk no longer applies.',
            occurredAt: '2026-07-29T04:00:00.000Z',
            sources: [{ source_type: 'meeting', label: 'schedule follow-up' }],
            entries: [],
            transitions: [
              {
                itemId: concurrentItem.id,
                expectedStatus: 'open',
                status: 'dismissed',
                note: 'The date was replanned.',
              },
            ],
            createdBy: 'agent-c',
          }),
        ]);
        expect(concurrentResults.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
        expect(concurrentResults.filter((result) => result.status === 'rejected')).toHaveLength(1);
        const rejected = concurrentResults.find((result) => result.status === 'rejected');
        expect(rejected).toMatchObject({
          status: 'rejected',
          reason: { code: 'PROJECT_UPDATE_ITEM_STATUS_CONFLICT' },
        });

        await raw.unsafe(`DELETE FROM activity_log WHERE event_type = 'project.update_recorded'`);
        const durableContext = await db.getProjectUpdateContext('project-a', 50, 10);
        expect(durableContext.recentUpdates).toHaveLength(4);

        await raw.unsafe(`DELETE FROM deliveries WHERE id = 'delivery-a'`);
        const preserved = await db.requireProjectUpdate('pupd-first');
        expect(preserved.delivery_id).toBeNull();
        expect(await db.listDeliveryProjectContext('delivery-a')).toEqual([]);

        await expect(
          db.createDelivery({
            id: 'delivery-wrong-project',
            projectId: 'project-b',
            title: 'Wrong Project context',
            createdBy: 'agent-a',
            gates: [],
            sourceProjectUpdateItemIds: [dependency.id],
          }),
        ).rejects.toMatchObject({ code: 'PROJECT_UPDATE_PROJECT_MISMATCH' });
        await expect(db.getDelivery('delivery-wrong-project')).resolves.toBeNull();
      } finally {
        await db.close();
        await raw.end({ timeout: 5 });
      }
    });
  }, 120_000);
});
