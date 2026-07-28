import { createHash } from 'node:crypto';
import { z } from 'zod';

import type { AppContext } from '../../app.js';
import { ApplicationOperationContractError, OperationRequiresHumanUiError } from '../../errors.js';
import type { ApplicationOperationDefinition } from '../types.js';

const sha256 = z.string().regex(/^[a-f0-9]{64}$/i);
const commitSha = z
  .string()
  .trim()
  .regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i);
const deliveryMaturity = z.enum([
  'concept',
  'functional_preview',
  'customer_review',
  'release_candidate',
  'production',
]);
const gateType = z.enum(['review', 'qa', 'data', 'custom']);
const artifactKind = z.enum([
  'review_html',
  'companion_pdf',
  'markdown',
  'qa_report',
  'data_report',
  'image',
  'other',
]);
const reviewState = z.enum([
  'not_requested',
  'pending',
  'changes_requested',
  'accepted',
  'waived',
  'stale',
]);
const reviewBlocker = z.enum([
  'review_not_requested',
  'artifact_not_found',
  'artifact_not_latest',
  'artifact_not_approved',
  'gate_pending',
  'gate_failed',
  'gate_warning',
]);
const reviewArtifact = z
  .object({
    id: z.string(),
    logical_key: z.string(),
    revision: z.number().int().positive(),
    sha256,
    status: z.enum(['draft', 'approved', 'superseded']),
    is_latest_revision: z.boolean(),
  })
  .strict();
const reviewGate = z
  .object({
    status: z.enum(['pending', 'passed', 'warning', 'failed', 'waived']),
    required: z.boolean(),
    recorded_by: z.string(),
    recorded_at: z.string().nullable(),
    waiver_reason: z.string().nullable(),
  })
  .strict();
const reviewPackage = z
  .object({
    id: z.string(),
    revision: z.number().int().positive(),
    manifest_sha256: sha256,
    status: z.enum(['published', 'superseded']),
  })
  .strict();

function definitionSha256(value: Record<string, unknown>): string {
  const ordered = Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => left.localeCompare(right)),
  );
  return createHash('sha256').update(JSON.stringify(ordered)).digest('hex');
}

function requireCommandOperationId(operationName: string, operationId: string | null): string {
  if (!operationId) {
    throw new ApplicationOperationContractError(operationName, {
      reason: 'missing_command_operation_id',
    });
  }
  return operationId;
}

async function projectForDelivery(input: Record<string, unknown>, appCtx: AppContext) {
  const delivery = await appCtx.db.requireDelivery(String(input['delivery_id']));
  return { projectId: delivery.project_id };
}

async function projectForRun(input: Record<string, unknown>, appCtx: AppContext) {
  return {
    projectId: await appCtx.deliveryAgentRunService.projectIdForRun(String(input['run_id'])),
  };
}

export const planDeliveryOperation: ApplicationOperationDefinition = {
  name: 'plan_delivery',
  version: 1,
  description:
    'Create a Delivery from an objective, Definition of Done, manifest path, and manifest-defined Gates.',
  kind: 'command',
  execution: 'sync',
  idempotency: 'required',
  allowedScopes: ['instance', 'org', 'project'],
  projectIdField: 'project_id',
  inputSchema: z
    .object({
      project_id: z.string().min(1),
      title: z.string().trim().min(1).max(300),
      summary: z.string().trim().max(20_000).optional(),
      objective: z.string().trim().min(1).max(20_000),
      definition_of_done: z.array(z.string().trim().min(1).max(2_000)).min(1).max(100),
      manifest_path: z.string().trim().min(1).max(500).default('.openlander/delivery.yml'),
      delivery_type: z.enum(['software_release', 'artifact_delivery']).default('software_release'),
      maturity: deliveryMaturity.default('customer_review'),
      auto_finalize: z.boolean().default(true),
      gates: z
        .array(
          z
            .object({
              gate_key: z.string().trim().min(1).max(100),
              gate_type: gateType,
              label: z.string().trim().min(1).max(300),
              required: z.boolean().default(true),
            })
            .strict(),
        )
        .min(1)
        .max(100),
    })
    .strict(),
  outputSchema: z
    .object({
      status: z.literal('planned'),
      project_id: z.string(),
      delivery_id: z.string(),
      delivery_status: z.string(),
      manifest_path: z.string(),
      gate_count: z.number().int().positive(),
      auto_finalize: z.boolean(),
      suggested_call: z.object({
        operation: z.literal('start_delivery_run'),
        input: z.object({ delivery_id: z.string() }),
      }),
      _agent_guidance: z.object({ message: z.string(), next_steps: z.array(z.string()).max(3) }),
    })
    .strict(),
  activity: { recordsActivity: true, recordsEvidence: true },
  execute: async (input, context) => {
    const operationId = requireCommandOperationId('plan_delivery', context.operationId);
    const rawGates = input['gates'] as Array<{
      gate_key: string;
      gate_type: 'review' | 'qa' | 'data' | 'custom';
      label: string;
      required: boolean;
    }>;
    const gates = rawGates.map((gate) => ({
      ...gate,
      source: 'manifest' as const,
      definition_sha256: definitionSha256(gate),
    }));
    const delivery = await context.appCtx.deliveryService.createDelivery({
      id: `del_${operationId}`,
      projectId: String(input['project_id']),
      title: String(input['title']),
      summary: typeof input['summary'] === 'string' ? input['summary'] : undefined,
      objective: String(input['objective']),
      definitionOfDone: input['definition_of_done'] as string[],
      manifestPath: String(input['manifest_path']),
      autoFinalize: input['auto_finalize'] === true,
      deliveryType: input['delivery_type'] as 'software_release' | 'artifact_delivery',
      maturity: input['maturity'] as z.infer<typeof deliveryMaturity>,
      actor: context.actor.label,
      gates,
    });
    return {
      status: 'planned',
      project_id: delivery.project_id,
      delivery_id: delivery.id,
      delivery_status: delivery.status,
      manifest_path: delivery.manifest_path ?? '.openlander/delivery.yml',
      gate_count: gates.length,
      auto_finalize: delivery.auto_finalize,
      suggested_call: {
        operation: 'start_delivery_run',
        input: { delivery_id: delivery.id },
      },
      _agent_guidance: {
        message:
          'Delivery plan is stored. Start a run only after the manifest is committed and supply its exact SHA-256.',
        next_steps: [
          'Commit the manifest and implementation changes.',
          'Call start_delivery_run with the exact commit, manifest hash, and runner image.',
        ],
      },
    };
  },
};

export const requestDeliveryReviewOperation: ApplicationOperationDefinition = {
  name: 'request_delivery_review',
  version: 1,
  description:
    'Bind one exact latest Artifact SHA-256 to a Delivery review Gate and request review.',
  kind: 'command',
  execution: 'sync',
  idempotency: 'required',
  allowedScopes: ['instance', 'org', 'project'],
  resolveScopeTarget: projectForDelivery,
  inputSchema: z
    .object({
      delivery_id: z.string().min(1),
      gate_key: z.string().trim().min(1).max(100),
      artifact_id: z.string().min(1),
      expected_sha256: sha256,
      summary: z.string().trim().min(1).max(20_000).nullable().optional(),
    })
    .strict(),
  outputSchema: z
    .object({
      status: z.literal('pending_review'),
      project_id: z.string(),
      delivery_id: z.string(),
      gate_key: z.string(),
      artifact_id: z.string(),
      revision: z.number().int().positive(),
      sha256,
      status_call: z.object({
        operation: z.literal('get_delivery_review_status'),
        input: z.object({ delivery_id: z.string(), gate_key: z.string() }),
      }),
      _agent_guidance: z.object({ message: z.string(), next_steps: z.array(z.string()).max(3) }),
    })
    .strict(),
  activity: { recordsActivity: true, recordsEvidence: true },
  execute: async (input, context) => {
    const operationId = requireCommandOperationId('request_delivery_review', context.operationId);
    const review = await context.appCtx.deliveryService.requestReview({
      deliveryId: String(input['delivery_id']),
      gateKey: String(input['gate_key']),
      artifactId: String(input['artifact_id']),
      expectedSha256: String(input['expected_sha256']),
      summary: typeof input['summary'] === 'string' ? input['summary'] : null,
      idempotencyKey: `review-request:${operationId}`,
      actor: context.actor.label,
    });
    if (!review.artifact) {
      throw new ApplicationOperationContractError('request_delivery_review', {
        reason: 'requested_artifact_missing_from_review_status',
      });
    }
    return {
      status: 'pending_review',
      project_id: review.project_id,
      delivery_id: review.delivery_id,
      gate_key: review.gate_key,
      artifact_id: review.artifact.id,
      revision: review.artifact.revision,
      sha256: review.artifact.sha256,
      status_call: {
        operation: 'get_delivery_review_status',
        input: { delivery_id: review.delivery_id, gate_key: review.gate_key },
      },
      _agent_guidance: {
        message:
          'The exact Artifact revision is waiting for review. Do not apply the external change yet.',
        next_steps: [
          'Ask the reviewer to inspect the Artifact and resolve the Review Gate in OpenLander.',
          'Poll get_delivery_review_status and continue only when ready_for_next_step is true.',
        ],
      },
    };
  },
};

export const getDeliveryReviewStatusOperation: ApplicationOperationDefinition = {
  name: 'get_delivery_review_status',
  version: 1,
  description: 'Read the compact exact-Artifact review checkpoint for one Delivery review Gate.',
  kind: 'query',
  execution: 'sync',
  idempotency: 'none',
  allowedScopes: ['instance', 'org', 'project'],
  resolveScopeTarget: projectForDelivery,
  inputSchema: z
    .object({
      delivery_id: z.string().min(1),
      gate_key: z.string().trim().min(1).max(100),
    })
    .strict(),
  outputSchema: z
    .object({
      status: reviewState,
      project_id: z.string(),
      delivery_id: z.string(),
      gate_key: z.string(),
      ready_for_next_step: z.boolean(),
      artifact: reviewArtifact.nullable(),
      gate: reviewGate,
      approval_evidence_id: z.string().nullable(),
      review_package: reviewPackage.nullable().optional(),
      blockers: z.array(reviewBlocker),
      status_call: z.object({
        operation: z.literal('get_delivery_review_status'),
        input: z.object({ delivery_id: z.string(), gate_key: z.string() }),
      }),
      _agent_guidance: z.object({ message: z.string(), next_steps: z.array(z.string()).max(3) }),
    })
    .strict(),
  activity: { recordsActivity: false, recordsEvidence: false },
  execute: async (input, context) => {
    const review = await context.appCtx.deliveryService.getReviewStatus(
      String(input['delivery_id']),
      String(input['gate_key']),
    );
    const nextSteps = review.ready_for_next_step
      ? [
          'Continue with the domain-specific next command using this exact Artifact revision.',
          'Record the external apply result as new evidence; accepted is not proof that apply ran.',
        ]
      : review.state === 'changes_requested' || review.state === 'stale'
        ? [
            'Create a newer Artifact revision that addresses the review result.',
            'Call request_delivery_review again with the new Artifact id and SHA-256.',
          ]
        : [
            'Keep the external change unapplied while review is pending.',
            'Poll this status after the reviewer resolves the Review Gate.',
          ];
    return {
      status: review.state,
      project_id: review.project_id,
      delivery_id: review.delivery_id,
      gate_key: review.gate_key,
      ready_for_next_step: review.ready_for_next_step,
      artifact: review.artifact,
      gate: review.gate,
      approval_evidence_id: review.approval_evidence_id,
      review_package: review.review_package,
      blockers: review.blockers,
      status_call: {
        operation: 'get_delivery_review_status',
        input: { delivery_id: review.delivery_id, gate_key: review.gate_key },
      },
      _agent_guidance: {
        message: review.ready_for_next_step
          ? 'The exact Artifact revision cleared this review checkpoint.'
          : 'This review checkpoint is not ready for the next external action.',
        next_steps: nextSteps,
      },
    };
  },
};

export const acceptDeliveryReviewOperation: ApplicationOperationDefinition = {
  name: 'accept_delivery_review',
  version: 1,
  description:
    'Accept one exact Artifact revision from the authenticated Web UI and pass its linked Review Gate.',
  kind: 'command',
  execution: 'sync',
  idempotency: 'required',
  allowedScopes: ['instance'],
  resolveScopeTarget: projectForDelivery,
  inputSchema: z
    .object({
      delivery_id: z.string().min(1),
      gate_key: z.string().trim().min(1).max(100),
      artifact_id: z.string().min(1),
      expected_sha256: sha256,
      package_id: z.string().min(1).optional(),
      expected_manifest_sha256: sha256.optional(),
      summary: z.string().trim().min(1).max(20_000).nullable().optional(),
    })
    .strict(),
  outputSchema: z
    .object({
      status: z.literal('accepted'),
      project_id: z.string(),
      delivery_id: z.string(),
      gate_key: z.string(),
      artifact_id: z.string(),
      revision: z.number().int().positive(),
      sha256,
      review_package: reviewPackage.nullable().optional(),
      ready_for_next_step: z.literal(true),
      status_call: z.object({
        operation: z.literal('get_delivery_review_status'),
        input: z.object({ delivery_id: z.string(), gate_key: z.string() }),
      }),
      _agent_guidance: z.object({ message: z.string(), next_steps: z.array(z.string()).max(3) }),
    })
    .strict(),
  activity: { recordsActivity: true, recordsEvidence: true },
  execute: async (input, context) => {
    if (context.actor.source !== 'web') {
      throw new OperationRequiresHumanUiError(
        'accept_delivery_review',
        'Accepting an exact Delivery review version requires an authenticated Web session.',
      );
    }
    const review = await context.appCtx.deliveryService.acceptReview({
      deliveryId: String(input['delivery_id']),
      gateKey: String(input['gate_key']),
      artifactId: String(input['artifact_id']),
      expectedSha256: String(input['expected_sha256']),
      ...(typeof input['package_id'] === 'string' ? { packageId: input['package_id'] } : {}),
      ...(typeof input['expected_manifest_sha256'] === 'string'
        ? { expectedManifestSha256: input['expected_manifest_sha256'] }
        : {}),
      summary: typeof input['summary'] === 'string' ? input['summary'] : null,
      actor: context.actor.label,
    });
    if (!review.artifact || !review.ready_for_next_step || review.state !== 'accepted') {
      throw new ApplicationOperationContractError('accept_delivery_review', {
        reason: 'review_checkpoint_not_accepted',
      });
    }
    return {
      status: 'accepted',
      project_id: review.project_id,
      delivery_id: review.delivery_id,
      gate_key: review.gate_key,
      artifact_id: review.artifact.id,
      revision: review.artifact.revision,
      sha256: review.artifact.sha256,
      review_package: review.review_package,
      ready_for_next_step: true,
      status_call: {
        operation: 'get_delivery_review_status',
        input: { delivery_id: review.delivery_id, gate_key: review.gate_key },
      },
      _agent_guidance: {
        message:
          'The human reviewer accepted this exact Artifact revision. This does not prove that the external change was applied.',
        next_steps: [
          'Continue with the domain-specific apply step using this exact Artifact revision.',
          'Record the external apply result as new evidence.',
        ],
      },
    };
  },
};

export const startDeliveryRunOperation: ApplicationOperationDefinition = {
  name: 'start_delivery_run',
  version: 1,
  description: 'Start an Agent Run pinned to an exact commit and Delivery manifest snapshot.',
  kind: 'command',
  execution: 'sync',
  idempotency: 'required',
  allowedScopes: ['instance', 'org', 'project'],
  resolveScopeTarget: projectForDelivery,
  inputSchema: z
    .object({
      delivery_id: z.string().min(1),
      commit_sha: commitSha,
      manifest_path: z.string().trim().min(1).max(500),
      manifest_sha256: sha256,
      runner_image: z.string().trim().min(1).max(1_000),
      runner_image_digest: z
        .string()
        .trim()
        .regex(/^sha256:[a-f0-9]{64}$/i)
        .nullable()
        .optional(),
      phase: z.string().trim().min(1).max(100).default('planning'),
    })
    .strict(),
  outputSchema: z
    .object({
      status: z.literal('running'),
      project_id: z.string(),
      delivery_id: z.string(),
      run_id: z.string(),
      phase: z.string(),
      commit_sha: z.string(),
      manifest_sha256: z.string(),
      status_call: z.object({
        operation: z.literal('get_delivery_run'),
        input: z.object({ run_id: z.string() }),
      }),
      _agent_guidance: z.object({ message: z.string(), next_steps: z.array(z.string()).max(3) }),
    })
    .strict(),
  activity: { recordsActivity: true, recordsEvidence: true },
  execute: async (input, context) => {
    const operationId = requireCommandOperationId('start_delivery_run', context.operationId);
    const delivery = await context.appCtx.db.requireDelivery(String(input['delivery_id']));
    const run = await context.appCtx.deliveryAgentRunService.start({
      id: `run_${operationId}`,
      deliveryId: delivery.id,
      commitSha: String(input['commit_sha']),
      manifestPath: String(input['manifest_path']),
      manifestSha256: String(input['manifest_sha256']),
      runnerImage: String(input['runner_image']),
      runnerImageDigest:
        typeof input['runner_image_digest'] === 'string' ? input['runner_image_digest'] : null,
      phase: String(input['phase']),
      actor: context.actor.label,
    });
    return {
      status: 'running',
      project_id: delivery.project_id,
      delivery_id: delivery.id,
      run_id: run.id,
      phase: run.current_phase,
      commit_sha: run.commit_sha,
      manifest_sha256: run.manifest_sha256,
      status_call: { operation: 'get_delivery_run', input: { run_id: run.id } },
      _agent_guidance: {
        message: 'Agent Run is active and pinned to the recorded commit and manifest snapshot.',
        next_steps: [
          'Record phase changes with record_delivery_run_progress.',
          'Use a handoff summary to pause the run before another Agent resumes it.',
        ],
      },
    };
  },
};

export const getDeliveryRunOperation: ApplicationOperationDefinition = {
  name: 'get_delivery_run',
  version: 1,
  description: 'Read one Agent Run and its ordered progress/handoff events.',
  kind: 'query',
  execution: 'sync',
  idempotency: 'none',
  allowedScopes: ['instance', 'org', 'project'],
  resolveScopeTarget: projectForRun,
  inputSchema: z.object({ run_id: z.string().min(1) }).strict(),
  outputSchema: z.object({
    status: z.literal('ok'),
    project_id: z.string(),
    delivery_id: z.string(),
    run: z.record(z.string(), z.unknown()),
    events: z.array(z.record(z.string(), z.unknown())),
    checks: z.array(z.record(z.string(), z.unknown())),
  }),
  activity: { recordsActivity: false, recordsEvidence: false },
  execute: async (input, context) => {
    const detail = await context.appCtx.deliveryAgentRunService.get(String(input['run_id']));
    return {
      status: 'ok',
      project_id: detail.delivery.project_id,
      delivery_id: detail.delivery.id,
      run: detail.run,
      events: detail.events,
      checks: detail.checks,
    };
  },
};

export const runQualityGatesOperation: ApplicationOperationDefinition = {
  name: 'run_quality_gates',
  version: 1,
  description:
    'Start manifest-declared quality checks in disposable containers for an exact Agent Run snapshot.',
  kind: 'command',
  execution: 'async',
  idempotency: 'required',
  allowedScopes: ['instance', 'org', 'project'],
  resolveScopeTarget: projectForRun,
  inputSchema: z
    .object({
      run_id: z.string().min(1),
      check_keys: z.array(z.string().trim().min(1).max(100)).min(1).max(100).optional(),
    })
    .strict(),
  outputSchema: z
    .object({
      status: z.literal('running'),
      project_id: z.string(),
      delivery_id: z.string(),
      run_id: z.string(),
      status_call: z.object({
        operation: z.literal('get_delivery_run'),
        input: z.object({ run_id: z.string() }),
      }),
      _agent_guidance: z.object({ message: z.string(), next_steps: z.array(z.string()).max(3) }),
    })
    .strict(),
  activity: { recordsActivity: true, recordsEvidence: true },
  execute: async (input, context) => {
    const runId = String(input['run_id']);
    const detail = await context.appCtx.deliveryAgentRunService.get(runId);
    await context.appCtx.deliveryQualityGateService.start({
      runId,
      checkKeys: input['check_keys'] as string[] | undefined,
      actor: context.actor.label,
    });
    return {
      status: 'running',
      project_id: detail.delivery.project_id,
      delivery_id: detail.delivery.id,
      run_id: runId,
      status_call: { operation: 'get_delivery_run', input: { run_id: runId } },
      _agent_guidance: {
        message:
          'Manifest quality checks are running in disposable containers. Poll the Agent Run for check attempts and Gate status.',
        next_steps: [
          'Call get_delivery_run until every selected check reaches a terminal status.',
          'If the Run fails, fix the repository and start a new Run at the new commit.',
        ],
      },
    };
  },
};

export const recordDeliveryRunProgressOperation: ApplicationOperationDefinition = {
  name: 'record_delivery_run_progress',
  version: 1,
  description: 'Record an Agent Run phase, concise progress evidence, or a pause/handoff summary.',
  kind: 'command',
  execution: 'sync',
  idempotency: 'required',
  allowedScopes: ['instance', 'org', 'project'],
  resolveScopeTarget: projectForRun,
  inputSchema: z
    .object({
      run_id: z.string().min(1),
      phase: z.string().trim().min(1).max(100),
      summary: z.string().trim().min(1).max(20_000),
      detail: z.record(z.string(), z.unknown()).optional(),
      handoff_summary: z.string().trim().min(1).max(20_000).nullable().optional(),
    })
    .strict(),
  outputSchema: z.object({
    status: z.enum(['running', 'paused']),
    project_id: z.string(),
    delivery_id: z.string(),
    run_id: z.string(),
    event_id: z.string(),
    phase: z.string(),
    status_call: z.object({
      operation: z.literal('get_delivery_run'),
      input: z.object({ run_id: z.string() }),
    }),
  }),
  activity: { recordsActivity: true, recordsEvidence: true },
  execute: async (input, context) => {
    const result = await context.appCtx.deliveryAgentRunService.recordProgress({
      runId: String(input['run_id']),
      phase: String(input['phase']),
      summary: String(input['summary']),
      detail: input['detail'] as Record<string, unknown> | undefined,
      handoffSummary:
        typeof input['handoff_summary'] === 'string' ? input['handoff_summary'] : undefined,
      actor: context.actor.label,
    });
    const delivery = await context.appCtx.db.requireDelivery(result.run.delivery_id);
    return {
      status: result.run.status === 'paused' ? 'paused' : 'running',
      project_id: delivery.project_id,
      delivery_id: delivery.id,
      run_id: result.run.id,
      event_id: result.event.id,
      phase: result.run.current_phase,
      status_call: { operation: 'get_delivery_run', input: { run_id: result.run.id } },
    };
  },
};

export const resumeDeliveryRunOperation: ApplicationOperationDefinition = {
  name: 'resume_delivery_run',
  version: 1,
  description: 'Resume a paused Agent Run with an explicit takeover summary.',
  kind: 'command',
  execution: 'sync',
  idempotency: 'required',
  allowedScopes: ['instance', 'org', 'project'],
  resolveScopeTarget: projectForRun,
  inputSchema: z
    .object({ run_id: z.string().min(1), summary: z.string().trim().min(1).max(20_000) })
    .strict(),
  outputSchema: z.object({
    status: z.literal('running'),
    project_id: z.string(),
    delivery_id: z.string(),
    run_id: z.string(),
    phase: z.string(),
    status_call: z.object({
      operation: z.literal('get_delivery_run'),
      input: z.object({ run_id: z.string() }),
    }),
  }),
  activity: { recordsActivity: true, recordsEvidence: true },
  execute: async (input, context) => {
    const run = await context.appCtx.deliveryAgentRunService.resume({
      runId: String(input['run_id']),
      summary: String(input['summary']),
      actor: context.actor.label,
    });
    const delivery = await context.appCtx.db.requireDelivery(run.delivery_id);
    return {
      status: 'running',
      project_id: delivery.project_id,
      delivery_id: delivery.id,
      run_id: run.id,
      phase: run.current_phase,
      status_call: { operation: 'get_delivery_run', input: { run_id: run.id } },
    };
  },
};

export const cancelDeliveryRunOperation: ApplicationOperationDefinition = {
  name: 'cancel_delivery_run',
  version: 1,
  description: 'Cancel an active Agent Run while preserving its events and evidence.',
  kind: 'command',
  execution: 'sync',
  idempotency: 'required',
  allowedScopes: ['instance', 'org', 'project'],
  resolveScopeTarget: projectForRun,
  inputSchema: z
    .object({ run_id: z.string().min(1), reason: z.string().trim().min(1).max(20_000) })
    .strict(),
  outputSchema: z.object({
    status: z.literal('cancelled'),
    project_id: z.string(),
    delivery_id: z.string(),
    run_id: z.string(),
    reason: z.string(),
  }),
  activity: { recordsActivity: true, recordsEvidence: true },
  execute: async (input, context) => {
    const reason = String(input['reason']);
    const run = await context.appCtx.deliveryAgentRunService.cancel({
      runId: String(input['run_id']),
      reason,
      actor: context.actor.label,
    });
    const delivery = await context.appCtx.db.requireDelivery(run.delivery_id);
    return {
      status: 'cancelled',
      project_id: delivery.project_id,
      delivery_id: delivery.id,
      run_id: run.id,
      reason,
    };
  },
};

export const completeDeliveryOperation: ApplicationOperationDefinition = {
  name: 'complete_delivery',
  version: 1,
  description: 'Finalize immutable Completion Evidence after a successful Production Promotion.',
  kind: 'command',
  execution: 'sync',
  idempotency: 'required',
  allowedScopes: ['instance', 'org', 'project'],
  resolveScopeTarget: projectForDelivery,
  inputSchema: z
    .object({
      delivery_id: z.string().min(1),
      run_id: z.string().min(1),
      release_id: z.string().min(1),
      promotion_id: z.string().min(1),
      limitations: z.string().trim().min(1).max(20_000),
    })
    .strict(),
  outputSchema: z
    .object({
      status: z.literal('completed'),
      delivery_id: z.string(),
      run_id: z.string(),
      release_id: z.string(),
      promotion_id: z.string(),
      receipt_id: z.string(),
      pdf_sha256: sha256,
    })
    .strict(),
  activity: { recordsActivity: true, recordsEvidence: true },
  execute: async (input, context) => {
    const receipt = await context.appCtx.deliveryCompletionService.complete({
      deliveryId: String(input['delivery_id']),
      runId: String(input['run_id']),
      releaseId: String(input['release_id']),
      promotionId: String(input['promotion_id']),
      limitations: String(input['limitations']),
      actor: context.actor.label,
    });
    return {
      status: 'completed',
      delivery_id: String(input['delivery_id']),
      run_id: String(input['run_id']),
      release_id: String(input['release_id']),
      promotion_id: String(input['promotion_id']),
      receipt_id: receipt.id,
      pdf_sha256: receipt.pdf_sha256,
    };
  },
};

export const createEvidenceUploadOperation: ApplicationOperationDefinition = {
  name: 'create_evidence_upload',
  version: 1,
  description: 'Issue a short-lived, single-artifact upload URL for Delivery evidence.',
  kind: 'command',
  execution: 'sync',
  idempotency: 'required',
  allowedScopes: ['instance', 'org', 'project'],
  projectIdField: 'project_id',
  inputSchema: z
    .object({
      project_id: z.string().min(1),
      delivery_id: z.string().min(1),
      filename: z.string().trim().min(1).max(500),
      mime_type: z.string().trim().min(1).max(200).nullable().optional(),
      logical_key: z.string().trim().min(1).max(200),
      revision: z.number().int().positive(),
      kind: artifactKind,
      include_in_receipt: z.boolean().default(true),
      receipt_order: z.number().int().min(0).max(10_000).default(0),
      companion_for_artifact_id: z.string().min(1).nullable().optional(),
    })
    .strict(),
  outputSchema: z
    .object({
      status: z.literal('ready'),
      project_id: z.string(),
      delivery_id: z.string(),
      artifact_id: z.string(),
      upload_url: z.string(),
      upload_method: z.literal('PUT'),
      expires_at: z.string(),
      max_bytes: z.number().int().positive(),
      _agent_guidance: z.object({ message: z.string(), next_steps: z.array(z.string()).max(3) }),
    })
    .strict(),
  activity: { recordsActivity: false, recordsEvidence: false },
  execute: async (input, context) => {
    const ticket = await context.appCtx.evidenceUploadService.issue({
      projectId: String(input['project_id']),
      deliveryId: String(input['delivery_id']),
      filename: String(input['filename']),
      mimeType: typeof input['mime_type'] === 'string' ? input['mime_type'] : null,
      logicalKey: String(input['logical_key']),
      revision: Number(input['revision']),
      kind: input['kind'] as z.infer<typeof artifactKind>,
      includeInReceipt: input['include_in_receipt'] === true,
      receiptOrder: Number(input['receipt_order']),
      companionForArtifactId:
        typeof input['companion_for_artifact_id'] === 'string'
          ? input['companion_for_artifact_id']
          : null,
    });
    return {
      status: 'ready',
      project_id: String(input['project_id']),
      delivery_id: String(input['delivery_id']),
      artifact_id: ticket.artifactId,
      upload_url: ticket.uploadUrl,
      upload_method: 'PUT',
      expires_at: ticket.expiresAt,
      max_bytes: ticket.maxBytes,
      _agent_guidance: {
        message:
          'Upload the exact evidence bytes with PUT before the URL expires. The URL is a bearer capability and must not be logged or shared.',
        next_steps: [
          'PUT the file body to upload_url with the declared content type.',
          'After upload succeeds, reference artifact_id from the relevant Gate or project update.',
        ],
      },
    };
  },
};

export const agentDeliveryOperations = [
  planDeliveryOperation,
  createEvidenceUploadOperation,
  requestDeliveryReviewOperation,
  getDeliveryReviewStatusOperation,
  startDeliveryRunOperation,
  getDeliveryRunOperation,
  runQualityGatesOperation,
  recordDeliveryRunProgressOperation,
  resumeDeliveryRunOperation,
  cancelDeliveryRunOperation,
  completeDeliveryOperation,
] as const;

export const webDeliveryOperations = [acceptDeliveryReviewOperation] as const;
