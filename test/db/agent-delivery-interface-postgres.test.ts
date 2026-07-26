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

function postgresMaintenanceUrl(url: string): string {
  const parsed = new URL(url);
  parsed.pathname = '/postgres';
  return parsed.toString();
}

async function withIsolatedPostgresDatabase(
  label: string,
  fn: (url: string) => Promise<void>,
): Promise<void> {
  const databaseName = `ol_agent_delivery_${label}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
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

describeWithDatabase('Agent Delivery interface persistence on Postgres', () => {
  it('allows compatibility Deliveries with an explicitly empty Gate set', async () => {
    await withIsolatedPostgresDatabase('empty_gates', async (url) => {
      const db = await Database.connect(url);
      try {
        const project = await db.createProject({ id: 'project-empty-gates', name: 'empty-gates' });
        const delivery = await db.createDelivery({
          id: 'delivery-empty-gates',
          projectId: project.id,
          title: 'Implicit deployment record',
          gates: [],
        });

        expect(delivery.id).toBe('delivery-empty-gates');
        await expect(db.listDeliveryGates(delivery.id)).resolves.toEqual([]);
      } finally {
        await db.close();
      }
    });
  });

  it('keeps existing Deliveries manual and defaults new Deliveries to auto-finalize', async () => {
    await withIsolatedPostgresDatabase('upgrade_0015', async (url) => {
      const migrationDirectory = await mkdtemp(join(tmpdir(), 'openlander-0015-migrations-'));
      try {
        await mkdir(join(migrationDirectory, 'meta'), { recursive: true });
        const journal = JSON.parse(
          await readFile(join(process.cwd(), 'drizzle/meta/_journal.json'), 'utf8'),
        ) as {
          version: string;
          dialect: string;
          entries: Array<{ idx: number; tag: string }>;
        };
        const entries = journal.entries.filter((entry) => entry.idx <= 15);
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
        await partial.client.unsafe(
          `INSERT INTO projects (id, name) VALUES ('project-before-0016', 'before-0016')`,
        );
        await partial.client.unsafe(
          `INSERT INTO deliveries (id, project_id, title)
           VALUES ('delivery-before-0016', 'project-before-0016', 'Existing Delivery')`,
        );
        await partial.client.end({ timeout: 5 });

        const upgraded = await Database.connect(url);
        try {
          await expect(upgraded.requireDelivery('delivery-before-0016')).resolves.toMatchObject({
            auto_finalize: false,
          });
          const current = await upgraded.createDelivery({
            id: 'delivery-after-0016',
            projectId: 'project-before-0016',
            title: 'New Delivery',
          });
          expect(current.auto_finalize).toBe(true);
        } finally {
          await upgraded.close();
        }
      } finally {
        await rm(migrationDirectory, { recursive: true, force: true });
      }
    });
  });

  it('preserves ordered handoff events and enforces one active Run per Delivery', async () => {
    await withIsolatedPostgresDatabase('run_lifecycle', async (url) => {
      const db = await Database.connect(url);
      try {
        const project = await db.createProject({ id: 'project-run', name: 'project-run' });
        const delivery = await db.createDelivery({
          id: 'delivery-run',
          projectId: project.id,
          title: 'Agent Delivery',
          objective: 'Ship an evidence-backed release.',
          definitionOfDone: ['Tests pass', 'Smoke test passes'],
          manifestPath: '.openlander/delivery.yml',
        });
        const first = await db.startDeliveryAgentRun({
          id: 'run-first',
          deliveryId: delivery.id,
          commitSha: 'a'.repeat(40),
          manifestPath: '.openlander/delivery.yml',
          manifestSha256: 'a'.repeat(64),
          runnerImage: 'node:22',
          runnerImageDigest: `sha256:${'b'.repeat(64)}`,
          actor: 'agent-a',
        });
        expect(first.status).toBe('running');

        await expect(
          db.startDeliveryAgentRun({
            id: 'run-conflict',
            deliveryId: delivery.id,
            commitSha: 'b'.repeat(40),
            manifestPath: '.openlander/delivery.yml',
            manifestSha256: 'c'.repeat(64),
            runnerImage: 'node:22',
            actor: 'agent-b',
          }),
        ).rejects.toMatchObject({ code: 'DELIVERY_AGENT_RUN_CONFLICT' });

        const handoff = await db.recordDeliveryAgentRunProgress({
          runId: first.id,
          phase: 'implementation',
          summary: 'Implementation is ready for review.',
          handoffSummary: 'Continue from the focused gate tests.',
          actor: 'agent-a',
        });
        expect(handoff.run.status).toBe('paused');
        await expect(
          db.recordDeliveryAgentRunProgress({
            runId: first.id,
            phase: 'qa',
            summary: 'This must wait for an explicit resume.',
            actor: 'agent-b',
          }),
        ).rejects.toMatchObject({ code: 'DELIVERY_AGENT_RUN_STATE_INVALID' });

        await db.resumeDeliveryAgentRun({
          runId: first.id,
          summary: 'Agent B accepted the handoff.',
          actor: 'agent-b',
        });
        await db.recordDeliveryAgentRunProgress({
          runId: first.id,
          phase: 'qa',
          summary: 'Focused gates passed.',
          actor: 'agent-b',
        });
        await db.cancelDeliveryAgentRun({
          runId: first.id,
          reason: 'Scenario intentionally exercises cancellation.',
          actor: 'agent-b',
        });

        const events = await db.listDeliveryAgentRunEvents(first.id);
        expect(events.map((event) => [event.sequence, event.event_type])).toEqual([
          [1, 'started'],
          [2, 'handoff'],
          [3, 'resumed'],
          [4, 'progress'],
          [5, 'cancelled'],
        ]);

        await expect(
          db.startDeliveryAgentRun({
            id: 'run-second',
            deliveryId: delivery.id,
            commitSha: 'c'.repeat(40),
            manifestPath: '.openlander/delivery.yml',
            manifestSha256: 'd'.repeat(64),
            runnerImage: 'node:22',
            actor: 'agent-c',
          }),
        ).resolves.toMatchObject({ status: 'running' });
      } finally {
        await db.close();
      }
    });
  });

  it('reconciles interrupted Agent, check, Release, and Promotion state on restart', async () => {
    await withIsolatedPostgresDatabase('restart_reconciliation', async (url) => {
      const initial = await Database.connect(url);
      const project = await initial.createProject({
        id: 'project-restart',
        name: 'project-restart',
      });
      const delivery = await initial.createDelivery({
        id: 'delivery-restart',
        projectId: project.id,
        title: 'Restart-safe Delivery',
        manifestPath: '.openlander/delivery.yml',
        gates: [
          {
            gate_key: 'qa',
            gate_type: 'qa',
            label: 'Quality',
            required: true,
            source: 'manifest',
            definition_sha256: 'd'.repeat(64),
          },
        ],
      });
      const run = await initial.startDeliveryAgentRun({
        id: 'run-restart',
        deliveryId: delivery.id,
        commitSha: 'a'.repeat(40),
        manifestPath: '.openlander/delivery.yml',
        manifestSha256: 'b'.repeat(64),
        runnerImage: 'node:22',
        actor: 'agent-a',
      });
      const [gate] = await initial.listDeliveryGates(delivery.id);
      if (!gate) throw new Error('Restart test Gate was not created.');
      const check = await initial.startDeliveryRunCheck({
        runId: run.id,
        gateId: gate.id,
        checkKey: 'unit',
        command: ['npm', 'test'],
      });
      const [environment] = await initial.syncProjectEnvironments(project.id, 'c'.repeat(64), [
        {
          key: 'production',
          displayName: 'Production',
          tier: 'production',
          promotionOrder: 0,
        },
      ]);
      if (!environment) throw new Error('Restart test Environment was not created.');
      const release = await initial.createRelease({
        id: 'release-restart',
        deliveryId: delivery.id,
        agentRunId: run.id,
        version: '1.0.0',
        commitSha: run.commit_sha,
        createdBy: 'agent-a',
      });
      const promotion = await initial.createReleasePromotion({
        id: 'promotion-restart',
        releaseId: release.id,
        projectEnvironmentId: environment.id,
        idempotencyKey: 'promotion-restart',
        initiatedBy: 'agent-a',
      });
      await initial.close();

      const restarted = await Database.connect(url);
      try {
        await expect(restarted.requireDeliveryAgentRun(run.id)).resolves.toMatchObject({
          status: 'paused',
          handoff_summary: expect.stringContaining('restarted'),
        });
        await expect(restarted.listDeliveryRunChecks(run.id)).resolves.toEqual(
          expect.arrayContaining([expect.objectContaining({ id: check.id, status: 'cancelled' })]),
        );
        await expect(restarted.requireRelease(release.id)).resolves.toMatchObject({
          status: 'failed',
        });
        await expect(restarted.getReleasePromotion(promotion.id)).resolves.toMatchObject({
          status: 'failed',
          error_code: 'PROMOTION_INTERRUPTED',
        });
        await expect(restarted.listDeliveryAgentRunEvents(run.id)).resolves.toEqual(
          expect.arrayContaining([
            expect.objectContaining({ event_type: 'interrupted', actor: 'openlander-startup' }),
          ]),
        );
        await expect(
          restarted.resumeDeliveryAgentRun({
            runId: run.id,
            summary: 'A new Agent reviewed the interruption and resumed the Run.',
            actor: 'agent-b',
          }),
        ).resolves.toMatchObject({ status: 'running' });
      } finally {
        await restarted.close();
      }
    });
  });

  it('allows an explicit Project hard delete to cascade an immutable Receipt', async () => {
    await withIsolatedPostgresDatabase('receipt_hard_delete', async (url) => {
      const db = await Database.connect(url);
      const client = postgres(url, { max: 1, prepare: false });
      try {
        const project = await db.createProject({
          id: 'project-receipt-delete',
          name: 'project-receipt-delete',
        });
        const delivery = await db.createDelivery({
          id: 'delivery-receipt-delete',
          projectId: project.id,
          title: 'Finalized Delivery',
          gates: [],
        });
        const blobId = 'f'.repeat(64);
        await client`
          INSERT INTO artifact_blobs (id, sha256, mime_type, size_bytes, storage_key)
          VALUES (${blobId}, ${blobId}, 'application/pdf', 1, 'receipts/delete.pdf')
        `;
        await client`
          INSERT INTO delivery_receipts (
            id, delivery_id, revision, snapshot_json, pdf_blob_id, pdf_sha256,
            finalized_by, finalized_at
          ) VALUES (
            'receipt-hard-delete', ${delivery.id}, 1, '{}'::jsonb, ${blobId}, ${blobId},
            'admin', '2026-07-26T00:00:00.000Z'
          )
        `;

        await expect(db.deleteProject(project.id)).resolves.toBeUndefined();

        const [counts] = await client<
          Array<{ projects: number; deliveries: number; receipts: number }>
        >`
          SELECT
            (SELECT count(*)::integer FROM projects WHERE id = ${project.id}) AS projects,
            (SELECT count(*)::integer FROM deliveries WHERE id = ${delivery.id}) AS deliveries,
            (SELECT count(*)::integer FROM delivery_receipts WHERE delivery_id = ${delivery.id}) AS receipts
        `;
        expect(counts).toEqual({ projects: 0, deliveries: 0, receipts: 0 });
      } finally {
        await client.end({ timeout: 5 });
        await db.close();
      }
    });
  });
});
