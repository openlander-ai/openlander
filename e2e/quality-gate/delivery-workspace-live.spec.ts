import { createHash } from 'node:crypto';

import { expect, test } from '@playwright/test';

import {
  deleteProject,
  deployGitProject,
  getDeployments,
  uniqueProjectName,
  waitForStatus,
} from './fixtures/api.js';
import { authHeaders, isNoAuthMode, OPENLANDER_URL } from './fixtures/config.js';

const TEST_REPO_URL = 'https://github.com/openlander-ai/test-single-dockerfile';
const SCENARIO_TIMEOUT_MS = 180_000;

interface DeliveryRow {
  id: string;
  status: string;
  evidence_version?: number;
  previewed_evidence_version?: number | null;
}

interface ArtifactUploadResponse {
  artifact: {
    id: string;
  };
}

interface FeedbackRow {
  id: string;
}

interface WorkItemDraftResponse {
  work_items: Array<{
    id: string;
  }>;
}

interface DeliveryReadiness {
  ready: boolean;
  blockers: string[];
  checks: Array<{
    key: string;
    passed: boolean;
  }>;
}

interface ReceiptRow {
  id: string;
  pdf_sha256: string;
}

interface DeliveryDetailResponse {
  delivery: DeliveryRow;
  receipt: ReceiptRow | null;
}

interface DeployRow {
  id?: string;
  status?: string;
}

async function apiRequest(path: string, init?: RequestInit): Promise<Response> {
  return await fetch(`${OPENLANDER_URL}${path}`, {
    ...init,
    headers: {
      ...authHeaders(),
      ...(init?.headers as Record<string, string> | undefined),
    },
  });
}

async function jsonRequest<T>(path: string, init: RequestInit, expectedStatus: number): Promise<T> {
  const response = await apiRequest(path, init);
  const body = await response.text();
  expect(response.status, `${init.method ?? 'GET'} ${path}: ${body}`).toBe(expectedStatus);
  return JSON.parse(body) as T;
}

async function uploadArtifact(
  deliveryPath: string,
  input: {
    content: string;
    filename: string;
    mimeType: string;
    logicalKey: string;
    kind: 'markdown' | 'qa_report';
    includeInReceipt: boolean;
    receiptOrder: number;
  },
): Promise<ArtifactUploadResponse> {
  const form = new FormData();
  form.set('file', new Blob([input.content], { type: input.mimeType }), input.filename);
  form.set('logical_key', input.logicalKey);
  form.set('revision', '1');
  form.set('kind', input.kind);
  form.set('include_in_receipt', String(input.includeInReceipt));
  form.set('receipt_order', String(input.receiptOrder));
  return await jsonRequest<ArtifactUploadResponse>(
    `${deliveryPath}/artifacts`,
    {
      method: 'POST',
      headers: { 'Idempotency-Key': `${input.logicalKey}-r1` },
      body: form,
    },
    201,
  );
}

async function loginAsAdmin(): Promise<string> {
  const response = await fetch(`${OPENLANDER_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'e2e-quality-gate' }),
  });
  const body = await response.text();
  expect(response.status, `Admin session login failed: ${body}`).toBe(200);
  const session = response.headers.get('set-cookie')?.match(/ol_session=([^;]+)/)?.[1];
  expect(session, 'Admin login did not return an ol_session cookie').toBeTruthy();
  return session ?? '';
}

test.describe.configure({ mode: 'serial' });

test.describe('Quality Gate — live Delivery Workspace release', () => {
  let projectId: string | null = null;

  test.afterAll(async () => {
    if (!projectId || process.env['OPENLANDER_E2E_EPHEMERAL'] === '1') return;
    try {
      await deleteProject(projectId);
    } catch (error) {
      console.warn(
        `Failed to delete live Delivery Workspace project ${projectId}:`,
        error instanceof Error ? error.message : String(error),
      );
    }
  });

  test('deploys the exact release and finalizes an immutable Receipt', async () => {
    test.setTimeout(300_000);
    test.skip(
      process.env['OPENLANDER_E2E_EPHEMERAL'] !== '1',
      'Finalized Receipts are immutable; this smoke requires an ephemeral runtime and database.',
    );
    expect(
      isNoAuthMode(),
      'Live Delivery Workspace smoke requires auth so finalization proves the admin-session boundary.',
    ).toBe(false);

    const projectName = uniqueProjectName('qg-delivery-live');
    const deployment = await deployGitProject(TEST_REPO_URL, 'main', undefined, {
      name: projectName,
    });
    expect(deployment.success).toBe(true);
    expect(deployment.projectId).toBeTruthy();
    projectId = deployment.projectId;

    const project = await waitForStatus(projectId, 'running', SCENARIO_TIMEOUT_MS);
    expect(project.status).toBe('running');
    expect(project.container_id).not.toBeNull();

    const basePath = `/api/projects/${projectId}/deliveries`;
    const delivery = await jsonRequest<DeliveryRow>(
      basePath,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Synthetic production release',
          summary: 'Dedicated RC smoke for the live Delivery Workspace release path.',
          delivery_type: 'software_release',
          maturity: 'release_candidate',
          limitations: 'Synthetic fixture only; no customer data.',
        }),
      },
      201,
    );
    const deliveryPath = `${basePath}/${delivery.id}`;

    const releaseArtifact = await uploadArtifact(deliveryPath, {
      content:
        '# Synthetic production release\n\n' +
        '- Source: public OpenLander quality-gate fixture\n' +
        '- Customer data: none\n',
      filename: 'synthetic-release.md',
      mimeType: 'text/markdown',
      logicalKey: 'release-notes',
      kind: 'markdown',
      includeInReceipt: true,
      receiptOrder: 1,
    });
    const qaArtifact = await uploadArtifact(deliveryPath, {
      content:
        '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<testsuite name="delivery-live" tests="1" failures="0" errors="0" skipped="0"/>\n',
      filename: 'qa-junit.xml',
      mimeType: 'application/junit+xml',
      logicalKey: 'qa-junit',
      kind: 'qa_report',
      includeInReceipt: false,
      receiptOrder: 2,
    });

    for (const artifactId of [releaseArtifact.artifact.id, qaArtifact.artifact.id]) {
      await jsonRequest<unknown>(
        `${deliveryPath}/artifacts/${artifactId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'approved' }),
        },
        200,
      );
    }

    const feedback = await jsonRequest<FeedbackRow>(
      `${deliveryPath}/feedback`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_type: 'meeting',
          author_display_name: 'Synthetic reviewer',
          raw_text: 'Approve after the production smoke question is resolved.',
          occurred_at: new Date().toISOString(),
        }),
      },
      201,
    );
    const workItems = await jsonRequest<WorkItemDraftResponse>(
      `${deliveryPath}/work-items/drafts`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: [
            {
              feedback_source_id: feedback.id,
              kind: 'question',
              title: 'Did the production container reach running?',
              detail: 'Resolve only after the real deployment succeeds.',
            },
          ],
        }),
      },
      201,
    );
    const workItemId = workItems.work_items[0]?.id;
    expect(workItemId).toBeTruthy();
    await jsonRequest<unknown>(
      `${deliveryPath}/work-items/${workItemId ?? ''}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'confirmed' }),
      },
      200,
    );
    await jsonRequest<unknown>(
      `${deliveryPath}/work-items/${workItemId ?? ''}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'resolved',
          resolution: 'The dedicated Docker deployment reached running.',
        }),
      },
      200,
    );

    await jsonRequest<unknown>(
      `${deliveryPath}/approvals`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          artifact_ids: [releaseArtifact.artifact.id, qaArtifact.artifact.id],
          approver_display_name: 'Synthetic customer approver',
          approval_excerpt: 'Approved for the dedicated RC smoke.',
          source_type: 'meeting',
          approved_at: new Date().toISOString(),
        }),
      },
      201,
    );

    await jsonRequest<unknown>(
      `${deliveryPath}/gates/review/result`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': `${delivery.id}-review-passed`,
        },
        body: JSON.stringify({
          status: 'passed',
          summary: 'Synthetic review gate passed on the dedicated RC host.',
        }),
      },
      200,
    );
    await jsonRequest<unknown>(
      `${deliveryPath}/gates/qa/result`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': `${delivery.id}-qa-passed`,
        },
        body: JSON.stringify({
          status: 'passed',
          summary: 'One synthetic test passed.',
          report_artifact_id: qaArtifact.artifact.id,
        }),
      },
      200,
    );

    for (const status of ['in_review', 'approved']) {
      await jsonRequest<DeliveryRow>(
        `${deliveryPath}/transition`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status }),
        },
        200,
      );
    }

    const deploys = (await getDeployments(projectId)) as DeployRow[];
    const successfulDeploy = deploys.find(
      (candidate): candidate is DeployRow & { id: string } =>
        candidate.status === 'success' && typeof candidate.id === 'string',
    );
    expect(successfulDeploy, 'No successful Production deployment was recorded').toBeTruthy();
    await jsonRequest<unknown>(
      `${deliveryPath}/deployments`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deploy_id: successfulDeploy?.id,
          relation: 'released',
        }),
      },
      201,
    );

    const readiness = await jsonRequest<DeliveryReadiness>(
      `${deliveryPath}/readiness`,
      { method: 'GET' },
      200,
    );
    expect(readiness.blockers).toEqual([]);
    expect(readiness.checks.every((check) => check.passed)).toBe(true);
    expect(readiness.ready).toBe(true);

    const preview = await apiRequest(`${deliveryPath}/receipt/preview`, { method: 'POST' });
    const previewError = preview.ok ? '' : await preview.text();
    expect(preview.status, previewError).toBe(200);
    expect(preview.headers.get('content-type')).toContain('application/pdf');
    expect((await preview.arrayBuffer()).byteLength).toBeGreaterThan(1_000);

    const previewedDetail = await jsonRequest<DeliveryDetailResponse>(
      deliveryPath,
      { method: 'GET' },
      200,
    );
    expect(previewedDetail.delivery.status).toBe('ready');
    expect(previewedDetail.delivery.previewed_evidence_version).toBe(
      previewedDetail.delivery.evidence_version,
    );

    const adminSession = await loginAsAdmin();
    const finalize = await fetch(`${OPENLANDER_URL}${deliveryPath}/receipt/finalize`, {
      method: 'POST',
      headers: { Cookie: `ol_session=${adminSession}` },
    });
    const finalizeBody = await finalize.text();
    expect(finalize.status, finalizeBody).toBe(200);
    const receipt = JSON.parse(finalizeBody) as ReceiptRow;
    expect(receipt.id).toBeTruthy();
    expect(receipt.pdf_sha256).toMatch(/^[a-f0-9]{64}$/);

    const download = await apiRequest(`${deliveryPath}/receipt/download`, { method: 'GET' });
    const downloadError = download.ok ? '' : await download.text();
    expect(download.status, downloadError).toBe(200);
    expect(download.headers.get('content-type')).toContain('application/pdf');
    const downloadedSha256 = createHash('sha256')
      .update(Buffer.from(await download.arrayBuffer()))
      .digest('hex');
    expect(downloadedSha256).toBe(receipt.pdf_sha256);

    const detail = await jsonRequest<DeliveryDetailResponse>(deliveryPath, { method: 'GET' }, 200);
    expect(detail.delivery.status).toBe('delivered');
    expect(detail.receipt?.id).toBe(receipt.id);
    expect(detail.receipt?.pdf_sha256).toBe(receipt.pdf_sha256);
  });
});
