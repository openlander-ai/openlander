import postgres from 'postgres';
import { describe, expect, it } from 'vitest';

import { Database } from '../../src/db/index.js';
import { buildDeterministicAiOpsBriefing } from '../../src/monitor/ai-ops-briefing.js';

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

describeWithDatabase('AI Ops briefing persistence on Postgres', () => {
  it('creates, lists, and gets deterministic briefing rows', async () => {
    await withIsolatedPostgresDatabase('ai_ops_briefing', async (url) => {
      const db = await Database.connect(url);
      try {
        const project = await db.createProjectGroup({
          id: 'p-ai-ops',
          name: 'ai-ops-app',
        });
        const service = await db.ensureDeployableServiceForProject(project.id, {
          source: 'git',
          repoUrl: 'https://github.com/example/ai-ops-app',
          branch: 'main',
        });
        const briefing = buildDeterministicAiOpsBriefing({
          projectId: project.id,
          serviceId: service.id,
          representativeTraffic: {
            status: 'failed',
            severity: 'fail',
            path: '/',
            status_code: 500,
          },
        });

        const created = await db.createAiOpsBriefing({
          projectId: briefing.projectId,
          serviceId: briefing.serviceId,
          dedupeKey: briefing.dedupeKey,
          fingerprint: briefing.fingerprint,
          classification: briefing.classification,
          severity: briefing.severity,
          title: briefing.title,
          deterministicSummary: briefing.deterministicSummary,
          suggestedCall: briefing.suggestedCall,
          evidence: briefing.evidence,
        });

        expect(created.project_id).toBe(project.id);
        expect(created.service_id).toBe(service.id);
        expect(created.classification).toBe('traffic_health_mismatch');

        const listed = await db.listAiOpsBriefingsByProject(project.id);
        expect(listed).toHaveLength(1);
        expect(listed[0]?.id).toBe(created.id);

        const fetched = await db.getAiOpsBriefing(created.id);
        expect(fetched?.suggested_call_json).toContain('diagnose_service');
        expect(fetched?.evidence_json).toContain('representativeTraffic');
      } finally {
        await db.close();
      }
    });
  });

  it('upserts pending user inputs atomically under concurrent diagnosis calls', async () => {
    await withIsolatedPostgresDatabase('ai_ops_pending_input', async (url) => {
      const db = await Database.connect(url);
      try {
        const project = await db.createProjectGroup({
          id: 'p-ai-ops-pending',
          name: 'ai-ops-pending-app',
        });
        const service = await db.ensureDeployableServiceForProject(project.id, {
          source: 'git',
          repoUrl: 'https://github.com/example/ai-ops-pending-app',
          branch: 'main',
        });

        const rows = await Promise.all(
          Array.from({ length: 4 }, (_, index) =>
            db.upsertAiOpsPendingInput({
              projectId: project.id,
              serviceId: service.id,
              field: 'EXCHANGE_API_URL',
              reason: `dependency unreachable ${index}`,
            }),
          ),
        );

        expect(new Set(rows.map((row) => row.id)).size).toBe(1);

        const listed = await db.listPendingAiOpsInputsForServiceKeys(service.id, [
          'EXCHANGE_API_URL',
        ]);
        expect(listed).toHaveLength(1);
        expect(listed[0]?.field).toBe('EXCHANGE_API_URL');
        expect(listed[0]?.status).toBe('pending');
      } finally {
        await db.close();
      }
    });
  });
});
