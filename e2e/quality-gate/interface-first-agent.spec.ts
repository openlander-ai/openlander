import { expect, test } from '@playwright/test';

import { mcpCall, uniqueProjectName } from './fixtures/api.js';
import { authHeaders, OPENLANDER_URL } from './fixtures/config.js';

type ToolCallEnvelope = {
  content?: Array<{ type?: string; text?: string }>;
  isError?: boolean;
};

function parseActionResult(envelope: ToolCallEnvelope): Record<string, unknown> {
  const text = envelope.content?.find((item) => item.type === 'text')?.text;
  if (envelope.isError || typeof text !== 'string') {
    throw new Error(`Agent operation failed: ${text ?? JSON.stringify(envelope)}`);
  }
  const parsed: unknown = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Agent operation returned a non-object result.');
  }
  return parsed as Record<string, unknown>;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Agent operation omitted ${field}.`);
  }
  return value;
}

async function callProjectAction(
  action: string,
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const envelope = (await mcpCall('tools/call', {
    name: 'openlander_project',
    arguments: { action, params },
  })) as ToolCallEnvelope;
  return parseActionResult(envelope);
}

test.describe.configure({ mode: 'serial' });

test.describe('Quality Gate — Interface-first Agent workflow', () => {
  test('bootstraps, hands off, resumes, and publishes evidence through MCP', async () => {
    test.setTimeout(180_000);

    await mcpCall('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'interface-first-quality-gate', version: '1.0.0' },
    });

    const projectName = uniqueProjectName('qg-interface-agent');
    const bootstrapInput = {
      idempotency_key: `${projectName}-bootstrap`,
      customer_name: 'Synthetic Customer',
      title: 'Interface-first acceptance',
      summary: 'No customer data. Agent-only quality-gate fixture.',
      project: {
        name: projectName,
        display_name: 'Interface-first acceptance',
        tags: ['synthetic', 'quality-gate'],
      },
    };
    const bootstrap = await callProjectAction('bootstrap_engagement', bootstrapInput);
    const replay = await callProjectAction('bootstrap_engagement', bootstrapInput);
    const engagementId = requiredString(bootstrap['engagement_id'], 'engagement_id');
    const projectId = requiredString(bootstrap['project_id'], 'project_id');
    expect(bootstrap).toMatchObject({ status: 'created', replayed: false });
    expect(replay).toMatchObject({
      status: 'created',
      engagement_id: engagementId,
      project_id: projectId,
      replayed: true,
    });

    const projectManifestSha = '1'.repeat(64);
    const environmentResult = await callProjectAction('apply_project_manifest', {
      idempotency_key: `${projectName}-environments`,
      project_id: projectId,
      manifest_path: '.openlander/project.yml',
      manifest_sha256: projectManifestSha,
      environments: [
        {
          key: 'dev',
          display_name: 'Development',
          tier: 'development',
          promotion_order: 0,
          health_timeout_seconds: 30,
          smoke_path: null,
          soak_seconds: 0,
        },
        {
          key: 'qa',
          display_name: 'QA',
          tier: 'validation',
          promotion_order: 1,
          health_timeout_seconds: 30,
          smoke_path: null,
          soak_seconds: 0,
        },
        {
          key: 'production',
          display_name: 'Production',
          tier: 'production',
          promotion_order: 2,
          health_timeout_seconds: 30,
          smoke_path: null,
          soak_seconds: 0,
        },
      ],
    });
    expect(environmentResult['status']).toBe('applied');
    expect(environmentResult['environments']).toHaveLength(3);

    const deliveryPlan = await callProjectAction('plan_delivery', {
      idempotency_key: `${projectName}-delivery`,
      project_id: projectId,
      title: 'Agent workflow candidate',
      summary: 'Synthetic delivery plan for MCP contract verification.',
      objective: 'Verify that an external Agent can run the primary workflow without Web forms.',
      definition_of_done: [
        'The Agent Run can be handed off and resumed.',
        'Internal and customer reports share one evidence snapshot.',
      ],
      manifest_path: '.openlander/delivery.yml',
      delivery_type: 'software_release',
      maturity: 'release_candidate',
      auto_finalize: true,
      gates: [{ gate_key: 'qa', gate_type: 'qa', label: 'Scenario QA', required: true }],
    });
    const deliveryId = requiredString(deliveryPlan['delivery_id'], 'delivery_id');
    expect(deliveryPlan).toMatchObject({ status: 'planned', gate_count: 1 });

    const uploadTicket = await callProjectAction('create_evidence_upload', {
      idempotency_key: `${projectName}-evidence-ticket`,
      project_id: projectId,
      delivery_id: deliveryId,
      filename: 'agent-handoff.md',
      mime_type: 'text/markdown',
      logical_key: 'agent-handoff',
      revision: 1,
      kind: 'markdown',
      include_in_receipt: true,
      receipt_order: 1,
      companion_for_artifact_id: null,
    });
    const artifactId = requiredString(uploadTicket['artifact_id'], 'artifact_id');
    const uploadUrl = requiredString(uploadTicket['upload_url'], 'upload_url');
    const uploadResponse = await fetch(new URL(uploadUrl, OPENLANDER_URL), {
      method: 'PUT',
      headers: { 'Content-Type': 'text/markdown' },
      body: '# Synthetic handoff\n\nNo customer data.\n',
    });
    expect(uploadResponse.status, await uploadResponse.text()).toBe(201);

    const update = await callProjectAction('record_project_update', {
      idempotency_key: `${projectName}-project-update`,
      project_id: projectId,
      delivery_id: deliveryId,
      summary: 'Agent recorded the synthetic acceptance evidence.',
      source_artifact_ids: [artifactId],
      entries: [
        {
          kind: 'decision',
          title: 'Use the operation registry as the product contract',
          detail: 'MCP and REST remain adapters over one application operation.',
          status: 'accepted',
        },
      ],
    });
    expect(update).toMatchObject({ status: 'recorded', evidence_count: 1, entry_count: 1 });

    const deliveryManifestSha = '2'.repeat(64);
    const runStart = await callProjectAction('start_delivery_run', {
      idempotency_key: `${projectName}-run`,
      delivery_id: deliveryId,
      commit_sha: 'a'.repeat(40),
      manifest_path: '.openlander/delivery.yml',
      manifest_sha256: deliveryManifestSha,
      runner_image: 'node:22-bookworm-slim',
      runner_image_digest: null,
      phase: 'implementation',
    });
    const runId = requiredString(runStart['run_id'], 'run_id');
    expect(runStart).toMatchObject({ status: 'running', phase: 'implementation' });

    const handoff = await callProjectAction('record_delivery_run_progress', {
      idempotency_key: `${projectName}-handoff`,
      run_id: runId,
      phase: 'verification',
      summary: 'Implementation finished; another Agent should verify the evidence.',
      detail: { changed_paths: ['.openlander/project.yml', '.openlander/delivery.yml'] },
      handoff_summary: 'Resume from verification and publish the weekly report.',
    });
    expect(handoff).toMatchObject({ status: 'paused', phase: 'verification' });

    const resumed = await callProjectAction('resume_delivery_run', {
      idempotency_key: `${projectName}-resume`,
      run_id: runId,
      summary: 'Second Agent accepted the handoff and verified the evidence chain.',
    });
    expect(resumed).toMatchObject({ status: 'running', run_id: runId });

    const runDetail = await callProjectAction('get_delivery_run', { run_id: runId });
    expect(runDetail['status']).toBe('ok');
    expect(runDetail['events']).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event_type: 'handoff' }),
        expect.objectContaining({ event_type: 'resumed' }),
      ]),
    );

    const reportDraft = await callProjectAction('generate_weekly_report', {
      idempotency_key: `${projectName}-weekly-draft`,
      engagement_id: engagementId,
      period_start: '2026-07-20',
      period_end: '2026-07-26',
    });
    const report = reportDraft['report'];
    if (!report || typeof report !== 'object' || Array.isArray(report)) {
      throw new Error('Weekly report draft omitted report metadata.');
    }
    const reportId = requiredString((report as Record<string, unknown>)['id'], 'report.id');
    const published = await callProjectAction('publish_weekly_report', {
      idempotency_key: `${projectName}-weekly-publish`,
      report_id: reportId,
    });
    expect(published['status']).toBe('published');

    const reportResponse = await fetch(
      `${OPENLANDER_URL}/api/engagements/${engagementId}/weekly-reports`,
      { headers: authHeaders() },
    );
    const reportBody = await reportResponse.text();
    expect(reportResponse.status, reportBody).toBe(200);
    const reportList = JSON.parse(reportBody) as {
      reports?: Array<Record<string, unknown>>;
    };
    expect(reportList.reports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: reportId,
          status: 'published',
          internal_sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
          customer_sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      ]),
    );
  });
});
