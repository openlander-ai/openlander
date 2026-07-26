import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Database } from '../../src/db/index.js';
import { ArtifactStore, type StoredArtifact } from '../../src/delivery/artifact-store.js';
import type { EngagementService } from '../../src/engagement/engagement-service.js';
import { WeeklyReportService } from '../../src/reporting/weekly-report-service.js';

const temporaryDirectories: string[] = [];

async function createHarness() {
  const dataDir = await mkdtemp(join(tmpdir(), 'openlander-weekly-report-'));
  temporaryDirectories.push(dataDir);
  const artifacts = new ArtifactStore(dataDir);
  const engagement = {
    id: 'engagement-1',
    customer_name: 'Synthetic Customer',
    title: 'Claims modernization',
    runtime_health: 'healthy',
    blocker_count: 0,
    projects: [{ id: 'project-1', display_name: 'Claims API', runtime_status: 'running' }],
    deliveries: [{ id: 'delivery-1', title: 'Weekly increment', status: 'ready' }],
    blockers: [],
  };
  const evidence = {
    deliveries: [{ id: 'delivery-1', status: 'ready' }],
    gates: [{ id: 'gate-1', status: 'passed' }],
    runs: [{ id: 'run-1', status: 'running', current_phase: 'quality_gates_passed' }],
    checks: [
      {
        id: 'check-1',
        check_key: 'qa',
        attempt: 1,
        status: 'passed',
        log_sha256: 'a'.repeat(64),
      },
    ],
    releases: [{ id: 'release-1', version: '1.0.0', status: 'ready', commit_sha: 'b'.repeat(40) }],
    releaseArtifacts: [
      {
        release_id: 'release-1',
        service_id: 'service-1',
        image_digest: `sha256:${'c'.repeat(64)}`,
      },
    ],
    promotions: [
      {
        id: 'promotion-1',
        project_environment_id: 'environment-production',
        status: 'succeeded',
        health_status: 'healthy',
      },
    ],
    environments: [
      { id: 'environment-production', display_name: 'Production', tier: 'production' },
    ],
    activity: [
      {
        created_at: '2026-07-21T12:00:00.000Z',
        title: 'Internal diagnosis',
        description: 'API_KEY=customer-secret should stay internal',
      },
    ],
  };
  let report: Record<string, unknown> | null = null;
  const stored = new Map<string, StoredArtifact>();
  const db = {
    collectWeeklyReportEvidence: vi.fn(async () => evidence),
    createWeeklyReport: vi.fn(async (input: Record<string, unknown>) => {
      report = {
        id: 'report-1',
        engagement_id: input['engagementId'],
        period_start: input['periodStart'],
        period_end: input['periodEnd'],
        revision: 1,
        status: 'draft',
        evidence_snapshot: JSON.parse(JSON.stringify(input['evidenceSnapshot'])) as Record<
          string,
          unknown
        >,
        evidence_sha256: input['evidenceSha256'],
        internal_html_blob_id: null,
        internal_pdf_blob_id: null,
        customer_html_blob_id: null,
        customer_pdf_blob_id: null,
        internal_sha256: null,
        customer_sha256: null,
        published_at: null,
      };
      return report;
    }),
    getWeeklyReport: vi.fn(async () => report),
    listWeeklyReports: vi.fn(async () => (report ? [report] : [])),
    getArtifactBlob: vi.fn(async (id: string) => {
      const artifact = stored.get(id);
      return artifact
        ? {
            id,
            sha256: artifact.sha256,
            mime_type: artifact.mimeType,
            size_bytes: artifact.sizeBytes,
            storage_key: artifact.storageKey,
          }
        : null;
    }),
    upsertArtifactBlob: vi.fn(async (artifact: StoredArtifact) => {
      stored.set(artifact.sha256, artifact);
      return { id: artifact.sha256, ...artifact };
    }),
    publishWeeklyReport: vi.fn(async (input: Record<string, unknown>) => {
      report = {
        ...(report ?? {}),
        status: 'published',
        internal_html_blob_id: input['internalHtmlBlobId'],
        internal_pdf_blob_id: input['internalPdfBlobId'],
        customer_html_blob_id: input['customerHtmlBlobId'],
        customer_pdf_blob_id: input['customerPdfBlobId'],
        internal_sha256: input['internalSha256'],
        customer_sha256: input['customerSha256'],
        published_at: '2026-07-26T00:00:00.000Z',
      };
      return report;
    }),
    insertActivityLog: vi.fn(async () => undefined),
  };
  const engagements = { get: vi.fn(async () => engagement) };
  const service = new WeeklyReportService(
    db as unknown as Database,
    engagements as unknown as EngagementService,
    artifacts,
  );
  return { service, db, engagement, artifacts, stored };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
}, 30_000);

describe('WeeklyReportService', () => {
  it('publishes internal and customer views from one immutable evidence snapshot', async () => {
    const harness = await createHarness();
    const draft = await harness.service.generate({
      engagementId: 'engagement-1',
      periodStart: '2026-07-20',
      periodEnd: '2026-07-26',
      actor: 'agent-a',
    });
    harness.engagement.title = 'Changed after snapshot';

    const published = await harness.service.publish(draft.id);
    const internalHtmlBlob = harness.stored.get(String(published.internal_html_blob_id));
    const customerHtmlBlob = harness.stored.get(String(published.customer_html_blob_id));
    expect(internalHtmlBlob).toBeDefined();
    expect(customerHtmlBlob).toBeDefined();
    if (!internalHtmlBlob || !customerHtmlBlob) throw new Error('Published HTML blobs are missing');
    const internalHtml = await harness.artifacts.read(internalHtmlBlob.storageKey);
    const customerHtml = await harness.artifacts.read(customerHtmlBlob.storageKey);

    expect(internalHtml.toString()).toContain('Claims modernization');
    expect(internalHtml.toString()).not.toContain('Changed after snapshot');
    expect(internalHtml.toString()).toContain('customer-secret');
    expect(customerHtml.toString()).toContain('Claims modernization');
    expect(customerHtml.toString()).not.toContain('customer-secret');
    expect(published.internal_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(published.customer_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(published.evidence_sha256).toBe(draft.evidence_sha256);
  }, 120_000);

  it('rejects periods that are not bounded weekly ranges', async () => {
    const harness = await createHarness();
    await expect(
      harness.service.generate({
        engagementId: 'engagement-1',
        periodStart: '2026-07-01',
        periodEnd: '2026-07-26',
        actor: 'agent-a',
      }),
    ).rejects.toMatchObject({ code: 'ENGAGEMENT_VALIDATION_FAILED' });
    expect(harness.db.createWeeklyReport).not.toHaveBeenCalled();
  });

  it('lists revisions only after validating the Engagement', async () => {
    const harness = await createHarness();
    await harness.service.generate({
      engagementId: 'engagement-1',
      periodStart: '2026-07-20',
      periodEnd: '2026-07-26',
      actor: 'agent-a',
    });

    await expect(harness.service.list('engagement-1')).resolves.toHaveLength(1);
    expect(harness.db.listWeeklyReports).toHaveBeenCalledWith('engagement-1');
  });

  it('serves only published artifacts that match the immutable PDF hash', async () => {
    const harness = await createHarness();
    const draft = await harness.service.generate({
      engagementId: 'engagement-1',
      periodStart: '2026-07-20',
      periodEnd: '2026-07-26',
      actor: 'agent-a',
    });
    await expect(
      harness.service.getPublishedArtifact({
        engagementId: 'engagement-1',
        reportId: draft.id,
        audience: 'customer',
        format: 'pdf',
      }),
    ).rejects.toMatchObject({ code: 'WEEKLY_REPORT_STATE_INVALID' });

    await harness.service.publish(draft.id);
    const artifact = await harness.service.getPublishedArtifact({
      engagementId: 'engagement-1',
      reportId: draft.id,
      audience: 'customer',
      format: 'pdf',
    });
    expect(artifact.blob.sha256).toBe(artifact.report.customer_sha256);
    expect(artifact.filename).toBe('report-1-customer-r1.pdf');

    harness.stored.set(String(artifact.report.customer_pdf_blob_id), {
      sha256: '0'.repeat(64),
      mimeType: 'application/pdf',
      sizeBytes: 1,
      storageKey: 'sha256/00/tampered',
    });
    await expect(
      harness.service.getPublishedArtifact({
        engagementId: 'engagement-1',
        reportId: draft.id,
        audience: 'customer',
        format: 'pdf',
      }),
    ).rejects.toMatchObject({ code: 'WEEKLY_REPORT_STATE_INVALID' });
  }, 120_000);
});
