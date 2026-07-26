import { createHash } from 'node:crypto';

import { expect, test } from '@playwright/test';

import { mcpCall, uniqueProjectName } from './fixtures/api.js';
import { authHeaders, OPENLANDER_URL } from './fixtures/config.js';

const FIXTURE_REPO = 'https://github.com/openlander-ai/test-single-dockerfile';
const FAIL_BRANCH = 'codex/fde-golden-fail';
const PASS_BRANCH = 'codex/fde-golden-pass';
const FAIL_COMMIT = '8598f707361120e31df16dcfa031618ab603206b';
const PASS_COMMIT = 'dbb15024f41d5015d5c1399f56b9fce5c1ce3ea2';
const DELIVERY_MANIFEST_SHA256 = '174fe99dfde36a59b113bf7505e4cf02c1784978539192839c385a4d1fe99e92';
const RUNNER_IMAGE = 'node:22-alpine';

type Composite = 'openlander_deploy' | 'openlander_project' | 'openlander_service';

type ToolCallEnvelope = {
  content?: Array<{ type?: string; text?: string }>;
  isError?: boolean;
};

type RunDetail = {
  run: Record<string, unknown>;
  checks: Array<Record<string, unknown>>;
};

type ProjectEnvironment = {
  environment_id: string;
  key: string;
};

function parseActionResult<T>(envelope: ToolCallEnvelope): T {
  const text = envelope.content?.find((item) => item.type === 'text')?.text;
  if (envelope.isError || typeof text !== 'string') {
    throw new Error(`Agent operation failed: ${text ?? JSON.stringify(envelope)}`);
  }
  return JSON.parse(text) as T;
}

async function callAction<T>(
  composite: Composite,
  action: string,
  params: Record<string, unknown>,
): Promise<T> {
  return parseActionResult<T>(
    (await mcpCall('tools/call', {
      name: composite,
      arguments: { action, params },
    })) as ToolCallEnvelope,
  );
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Agent operation omitted ${field}.`);
  }
  return value;
}

async function waitForRun(
  runId: string,
  predicate: (detail: RunDetail) => boolean,
): Promise<RunDetail> {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    const detail = await callAction<RunDetail>('openlander_project', 'get_delivery_run', {
      run_id: runId,
    });
    if (predicate(detail)) return detail;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Agent Run ${runId} did not reach the expected state.`);
}

async function waitForRelease(releaseId: string): Promise<{
  release: Record<string, unknown>;
  artifacts: Array<Record<string, unknown>>;
}> {
  for (let attempt = 0; attempt < 360; attempt += 1) {
    const detail = await callAction<{
      release: Record<string, unknown>;
      artifacts: Array<Record<string, unknown>>;
    }>('openlander_deploy', 'get_release', { release_id: releaseId });
    const status = detail.release['status'];
    if (status === 'ready') return detail;
    if (status === 'failed' || status === 'recalled') {
      throw new Error(`Release ${releaseId} failed: ${JSON.stringify(detail.release)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Release ${releaseId} did not become ready.`);
}

async function waitForPromotion(promotionId: string): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < 180; attempt += 1) {
    const detail = await callAction<{ promotion: Record<string, unknown> }>(
      'openlander_deploy',
      'evaluate_promotion',
      { promotion_id: promotionId },
    );
    const status = detail.promotion['status'];
    if (status === 'succeeded') return detail.promotion;
    if (status === 'failed') {
      throw new Error(`Promotion ${promotionId} failed: ${JSON.stringify(detail.promotion)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Promotion ${promotionId} did not finish.`);
}

async function getSingleServiceId(projectId: string): Promise<string> {
  const response = await fetch(`${OPENLANDER_URL}/api/projects/${projectId}/services`, {
    headers: authHeaders(),
  });
  const body = await response.text();
  expect(response.status, body).toBe(200);
  const parsed = JSON.parse(body) as
    Array<Record<string, unknown>> | { services?: Array<Record<string, unknown>> };
  const services = Array.isArray(parsed) ? parsed : (parsed.services ?? []);
  expect(services).toHaveLength(1);
  return requiredString(services[0]?.['id'], 'service.id');
}

async function promoteThrough(
  releaseId: string,
  environments: ProjectEnvironment[],
  keyPrefix: string,
): Promise<Array<Record<string, unknown>>> {
  const promotions: Array<Record<string, unknown>> = [];
  for (const environment of environments) {
    const started = await callAction<{ status: string; promotion_id: string }>(
      'openlander_deploy',
      'promote_release',
      {
        idempotency_key: `${keyPrefix}-${environment.key}`,
        release_id: releaseId,
        project_environment_id: environment.environment_id,
      },
    );
    expect(started.status).toBe('deploying');
    promotions.push(await waitForPromotion(started.promotion_id));
  }
  return promotions;
}

async function expectEnvironmentDigest(
  projectId: string,
  environmentIds: string[],
  digest: string,
): Promise<void> {
  const response = await fetch(`${OPENLANDER_URL}/api/projects/${projectId}/environments`, {
    headers: authHeaders(),
  });
  const body = await response.text();
  expect(response.status, body).toBe(200);
  const payload = JSON.parse(body) as { environments?: Array<Record<string, unknown>> };
  const promoted = (payload.environments ?? []).filter((environment) =>
    environmentIds.includes(String(environment['project_environment_id'])),
  );
  expect(promoted).toHaveLength(environmentIds.length);
  expect(promoted.map((environment) => environment['image_tag'])).toEqual(
    environmentIds.map(() => digest),
  );
}

async function receiptSha256(projectId: string, deliveryId: string): Promise<string> {
  const response = await fetch(
    `${OPENLANDER_URL}/api/projects/${projectId}/deliveries/${deliveryId}/receipt/download`,
    { headers: authHeaders() },
  );
  const body = Buffer.from(await response.arrayBuffer());
  expect(response.status, body.toString('utf8')).toBe(200);
  return createHash('sha256').update(body).digest('hex');
}

test.describe.configure({ mode: 'serial' });

test.describe('Quality Gate — external Agent FDE golden path', () => {
  test('fails, fixes, promotes one digest, reports, and finalizes evidence without Web forms', async () => {
    test.setTimeout(900_000);
    test.skip(
      process.env['OPENLANDER_E2E_EPHEMERAL'] !== '1',
      'The immutable Completion Evidence scenario requires an ephemeral runtime and database.',
    );

    await mcpCall('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'external-agent-fde-golden-path', version: '1.0.0' },
    });

    const projectName = uniqueProjectName('qg-agent-fde');
    const bootstrap = await callAction<Record<string, unknown>>(
      'openlander_project',
      'bootstrap_engagement',
      {
        idempotency_key: `${projectName}-bootstrap`,
        customer_name: 'Synthetic FDE Customer',
        title: 'External Agent FDE golden path',
        summary: 'Public synthetic fixture only. No customer data.',
        project: {
          name: projectName,
          display_name: 'Agent-built synthetic Application',
          tags: ['synthetic', 'fde-golden'],
        },
      },
    );
    const engagementId = requiredString(bootstrap['engagement_id'], 'engagement_id');
    const projectId = requiredString(bootstrap['project_id'], 'project_id');

    const deployed = await callAction<Record<string, unknown>>('openlander_deploy', 'deploy_app', {
      repo_url: FIXTURE_REPO,
      branch: FAIL_BRANCH,
      name: projectName,
      target_project_id: projectId,
      wait: true,
      wait_healthy: false,
      timeout: 240,
    });
    expect(deployed['status']).toBe('done');
    expect(deployed['project_id']).toBe(projectId);
    const serviceId = await getSingleServiceId(projectId);

    const manifest = await callAction<{
      status: string;
      environments: ProjectEnvironment[];
    }>('openlander_project', 'apply_project_manifest', {
      idempotency_key: `${projectName}-environments`,
      project_id: projectId,
      manifest_path: '.openlander/project.yml',
      manifest_sha256: '4'.repeat(64),
      environments: [
        {
          key: 'dev',
          display_name: 'Development',
          tier: 'development',
          promotion_order: 0,
          health_timeout_seconds: 30,
          smoke_path: '/',
          soak_seconds: 0,
        },
        {
          key: 'qa',
          display_name: 'QA',
          tier: 'validation',
          promotion_order: 1,
          health_timeout_seconds: 30,
          smoke_path: '/',
          soak_seconds: 0,
        },
        {
          key: 'customer-validation',
          display_name: 'Customer Validation',
          tier: 'validation',
          promotion_order: 2,
          health_timeout_seconds: 30,
          smoke_path: '/',
          soak_seconds: 0,
        },
        {
          key: 'production',
          display_name: 'Production',
          tier: 'production',
          promotion_order: 3,
          health_timeout_seconds: 30,
          smoke_path: '/',
          soak_seconds: 0,
        },
      ],
    });
    expect(manifest.status).toBe('applied');
    expect(manifest.environments.map((environment) => environment.key)).toEqual([
      'dev',
      'qa',
      'customer-validation',
      'production',
    ]);

    const deliveryPlan = await callAction<Record<string, unknown>>(
      'openlander_project',
      'plan_delivery',
      {
        idempotency_key: `${projectName}-delivery`,
        project_id: projectId,
        title: 'Agent-built production candidate',
        summary: 'Failure correction, immutable promotion, reporting, and completion evidence.',
        objective: 'Ship the synthetic Application through the complete external Agent workflow.',
        definition_of_done: [
          'Scenario QA passes at the exact implementation commit.',
          'Every Environment runs the same immutable Release digest.',
          'Weekly reports and Completion Evidence are immutable and downloadable.',
        ],
        manifest_path: '.openlander/delivery.yml',
        delivery_type: 'software_release',
        maturity: 'release_candidate',
        auto_finalize: true,
        gates: [{ gate_key: 'qa', gate_type: 'qa', label: 'Scenario QA', required: true }],
      },
    );
    const deliveryId = requiredString(deliveryPlan['delivery_id'], 'delivery_id');

    const failedRunStart = await callAction<Record<string, unknown>>(
      'openlander_project',
      'start_delivery_run',
      {
        idempotency_key: `${projectName}-run-fail`,
        delivery_id: deliveryId,
        commit_sha: FAIL_COMMIT,
        manifest_path: '.openlander/delivery.yml',
        manifest_sha256: DELIVERY_MANIFEST_SHA256,
        runner_image: RUNNER_IMAGE,
        runner_image_digest: null,
        phase: 'scenario_qa',
      },
    );
    const failedRunId = requiredString(failedRunStart['run_id'], 'failed_run_id');
    await callAction('openlander_project', 'run_quality_gates', {
      idempotency_key: `${projectName}-quality-fail`,
      run_id: failedRunId,
    });
    const failedRun = await waitForRun(failedRunId, (detail) => detail.run['status'] === 'failed');
    expect(failedRun.run).toMatchObject({ status: 'failed' });
    expect(failedRun.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ check_key: 'scenario-qa', status: 'failed', exit_code: 1 }),
      ]),
    );

    const sourceUpdate = await callAction<Record<string, unknown>>(
      'openlander_service',
      'update_application_source',
      {
        service_id: serviceId,
        source: 'git',
        repo_url: FIXTURE_REPO,
        branch: PASS_BRANCH,
      },
    );
    expect(sourceUpdate).toMatchObject({ status: 'updated', needs_redeploy: true });

    const passingRunStart = await callAction<Record<string, unknown>>(
      'openlander_project',
      'start_delivery_run',
      {
        idempotency_key: `${projectName}-run-pass`,
        delivery_id: deliveryId,
        commit_sha: PASS_COMMIT,
        manifest_path: '.openlander/delivery.yml',
        manifest_sha256: DELIVERY_MANIFEST_SHA256,
        runner_image: RUNNER_IMAGE,
        runner_image_digest: null,
        phase: 'implementation_fixed',
      },
    );
    const passingRunId = requiredString(passingRunStart['run_id'], 'passing_run_id');

    const handoff = await callAction<Record<string, unknown>>(
      'openlander_project',
      'record_delivery_run_progress',
      {
        idempotency_key: `${projectName}-handoff`,
        run_id: passingRunId,
        phase: 'verification',
        summary: 'The implementation was fixed at a new commit and is ready for verification.',
        detail: { previous_run_id: failedRunId, changed_path: 'quality-gate-state.json' },
        handoff_summary: 'Verify Scenario QA, then build and promote the exact passing commit.',
      },
    );
    expect(handoff['status']).toBe('paused');
    const resumed = await callAction<Record<string, unknown>>(
      'openlander_project',
      'resume_delivery_run',
      {
        idempotency_key: `${projectName}-resume`,
        run_id: passingRunId,
        summary: 'A second external Agent accepted the evidence-linked handoff.',
      },
    );
    expect(resumed['status']).toBe('running');

    await callAction('openlander_project', 'run_quality_gates', {
      idempotency_key: `${projectName}-quality-pass`,
      run_id: passingRunId,
    });
    const passingRun = await waitForRun(
      passingRunId,
      (detail) => detail.run['current_phase'] === 'quality_gates_passed',
    );
    expect(passingRun.run).toMatchObject({
      status: 'running',
      current_phase: 'quality_gates_passed',
      commit_sha: PASS_COMMIT,
    });
    expect(passingRun.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          check_key: 'scenario-qa',
          status: 'passed',
          exit_code: 0,
          report_artifact_id: expect.any(String),
        }),
      ]),
    );
    const failedRunAfterFix = await callAction<RunDetail>(
      'openlander_project',
      'get_delivery_run',
      { run_id: failedRunId },
    );
    expect(failedRunAfterFix.run['status']).toBe('failed');

    const releaseStarted = await callAction<Record<string, unknown>>(
      'openlander_deploy',
      'create_release',
      {
        idempotency_key: `${projectName}-release`,
        run_id: passingRunId,
        version: `golden-${Date.now().toString(36)}`,
      },
    );
    expect(releaseStarted['status']).toBe('building');
    const releaseId = requiredString(releaseStarted['release_id'], 'release_id');
    const release = await waitForRelease(releaseId);
    expect(release.artifacts).toHaveLength(1);
    const digest = requiredString(release.artifacts[0]?.['image_digest'], 'image_digest');
    expect(digest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(release.artifacts[0]?.['image_reference']).toBe(digest);
    expect(release.artifacts[0]?.['build_provenance']).toMatchObject({
      commit_sha: PASS_COMMIT,
      manifest_sha256: DELIVERY_MANIFEST_SHA256,
    });

    const promotions = await promoteThrough(
      releaseId,
      manifest.environments,
      `${projectName}-promotion`,
    );
    expect(promotions.map((promotion) => promotion['status'])).toEqual([
      'succeeded',
      'succeeded',
      'succeeded',
      'succeeded',
    ]);
    await expectEnvironmentDigest(
      projectId,
      manifest.environments.map((environment) => environment.environment_id),
      digest,
    );
    const productionPromotion = promotions.at(-1);
    const productionPromotionId = requiredString(
      productionPromotion?.['id'],
      'production_promotion_id',
    );

    const reportDraft = await callAction<Record<string, unknown>>(
      'openlander_project',
      'generate_weekly_report',
      {
        idempotency_key: `${projectName}-report`,
        engagement_id: engagementId,
        period_start: '2026-07-20',
        period_end: '2026-07-26',
      },
    );
    const draft = reportDraft['report'] as Record<string, unknown> | undefined;
    const reportId = requiredString(draft?.['id'], 'report_id');
    const published = await callAction<Record<string, unknown>>(
      'openlander_project',
      'publish_weekly_report',
      {
        idempotency_key: `${projectName}-publish-report`,
        report_id: reportId,
      },
    );
    const report = published['report'] as Record<string, unknown> | undefined;
    expect(published['status']).toBe('published');
    expect(report).toMatchObject({
      status: 'published',
      evidence_sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      internal_sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      customer_sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });

    const [internalReport, customerReport] = await Promise.all([
      fetch(
        `${OPENLANDER_URL}/api/engagements/${engagementId}/weekly-reports/${reportId}/internal/html`,
        { headers: authHeaders() },
      ),
      fetch(
        `${OPENLANDER_URL}/api/engagements/${engagementId}/weekly-reports/${reportId}/customer/html`,
        { headers: authHeaders() },
      ),
    ]);
    const [internalHtml, customerHtml] = await Promise.all([
      internalReport.text(),
      customerReport.text(),
    ]);
    expect(internalReport.status, internalHtml).toBe(200);
    expect(customerReport.status, customerHtml).toBe(200);
    expect(internalHtml).toContain('Agent Run');
    expect(internalHtml).toContain('log sha256');
    expect(customerHtml).not.toContain('Agent Run');
    expect(customerHtml).not.toContain('log sha256');

    const completed = await callAction<Record<string, unknown>>(
      'openlander_project',
      'complete_delivery',
      {
        idempotency_key: `${projectName}-complete`,
        delivery_id: deliveryId,
        run_id: passingRunId,
        release_id: releaseId,
        promotion_id: productionPromotionId,
        limitations: 'Synthetic fixture only; no customer data or production dependency.',
      },
    );
    expect(completed['status']).toBe('completed');
    const receiptId = requiredString(completed['receipt_id'], 'receipt_id');
    const completionSha = requiredString(completed['pdf_sha256'], 'pdf_sha256');
    expect(completionSha).toMatch(/^[a-f0-9]{64}$/);
    expect(await receiptSha256(projectId, deliveryId)).toBe(completionSha);

    const archived = await callAction<Record<string, unknown>>(
      'openlander_project',
      'archive_engagement',
      {
        idempotency_key: `${projectName}-archive`,
        engagement_id: engagementId,
      },
    );
    expect(archived['status']).toBe('archived');
    expect(await receiptSha256(projectId, deliveryId)).toBe(completionSha);

    const detailResponse = await fetch(
      `${OPENLANDER_URL}/api/projects/${projectId}/deliveries/${deliveryId}`,
      { headers: authHeaders() },
    );
    const detailBody = await detailResponse.text();
    expect(detailResponse.status, detailBody).toBe(200);
    const detail = JSON.parse(detailBody) as {
      receipt?: { id?: string; pdf_sha256?: string } | null;
    };
    expect(detail.receipt).toMatchObject({ id: receiptId, pdf_sha256: completionSha });
  });
});
