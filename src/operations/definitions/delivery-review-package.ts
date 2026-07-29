import { z } from 'zod';

import type { AppContext } from '../../app.js';
import { ApplicationOperationContractError } from '../../errors.js';
import type { ApplicationOperationDefinition } from '../types.js';

const sha256 = z.string().regex(/^[a-f0-9]{64}$/i);
const packageStatus = z.enum(['draft', 'published', 'superseded', 'aborted', 'expired']);
const itemStatus = z.enum(['pending', 'uploaded', 'failed']);
const fileRole = z.enum(['review_document', 'interactive_preview', 'representative_image']);

const fileSpec = z
  .object({
    role: fileRole,
    filename: z.string().trim().min(1).max(500),
    expected_sha256: sha256,
    expected_size_bytes: z
      .number()
      .int()
      .positive()
      .max(100 * 1024 * 1024),
    mime_type: z.string().trim().min(1).max(200),
  })
  .strict();

const overview = z.discriminatedUnion('mode', [
  z
    .object({
      mode: z.literal('update'),
      title: z.string().trim().min(1).max(300).optional(),
      summary: z.string().trim().max(20_000).optional(),
      limitations: z.string().trim().max(20_000).nullable().optional(),
    })
    .strict()
    .refine(
      (value) =>
        value.title !== undefined || value.summary !== undefined || value.limitations !== undefined,
      { message: 'overview update requires at least one field' },
    ),
  z
    .object({
      mode: z.literal('keep'),
      reason: z.string().trim().min(1).max(2_000),
    })
    .strict(),
]);

const packageSummary = z
  .object({
    package_id: z.string(),
    revision: z.number().int().positive(),
    status: packageStatus,
    manifest_sha256: sha256,
    base_evidence_version: z.number().int().nonnegative(),
    expires_at: z.string(),
    published_at: z.string().nullable(),
  })
  .strict();

const itemSummary = z
  .object({
    item_id: z.string(),
    role: fileRole,
    filename: z.string(),
    required: z.boolean(),
    status: itemStatus,
    expected_sha256: sha256,
    expected_size_bytes: z.number().int().positive(),
    expected_mime_type: z.string(),
    actual_sha256: sha256.nullable(),
    actual_size_bytes: z.number().int().positive().nullable(),
    actual_mime_type: z.string().nullable(),
    artifact_id: z.string().nullable(),
    error_code: z.string().nullable(),
  })
  .strict();

const uploadCapability = z
  .object({
    item_id: z.string(),
    role: fileRole,
    upload_url: z.string(),
    upload_method: z.literal('PUT'),
    expires_at: z.string(),
  })
  .strict();

function packageSummaryFrom(row: {
  id: string;
  revision: number;
  status: z.infer<typeof packageStatus>;
  manifest_sha256: string;
  base_evidence_version: number;
  expires_at: string;
  published_at: string | null;
}) {
  return {
    package_id: row.id,
    revision: row.revision,
    status: row.status,
    manifest_sha256: row.manifest_sha256,
    base_evidence_version: row.base_evidence_version,
    expires_at: row.expires_at,
    published_at: row.published_at,
  };
}

function itemSummaryFrom(detail: {
  item: {
    id: string;
    role: z.infer<typeof fileRole>;
    filename: string;
    required: boolean;
    status: z.infer<typeof itemStatus>;
    expected_sha256: string;
    expected_size_bytes: number;
    expected_mime_type: string;
    actual_sha256: string | null;
    actual_size_bytes: number | null;
    actual_mime_type: string | null;
    artifact_id: string | null;
    last_error_code: string | null;
  };
}) {
  return {
    item_id: detail.item.id,
    role: detail.item.role,
    filename: detail.item.filename,
    required: detail.item.required,
    status: detail.item.status,
    expected_sha256: detail.item.expected_sha256,
    expected_size_bytes: detail.item.expected_size_bytes,
    expected_mime_type: detail.item.expected_mime_type,
    actual_sha256: detail.item.actual_sha256,
    actual_size_bytes: detail.item.actual_size_bytes,
    actual_mime_type: detail.item.actual_mime_type,
    artifact_id: detail.item.artifact_id,
    error_code: detail.item.last_error_code,
  };
}

async function projectForDelivery(input: Record<string, unknown>, appCtx: AppContext) {
  const delivery = await appCtx.db.requireDelivery(String(input['delivery_id']));
  return { projectId: delivery.project_id };
}

async function projectForPackage(input: Record<string, unknown>, appCtx: AppContext) {
  const detail = await appCtx.db.getDeliveryReviewPackage(String(input['package_id']));
  return { projectId: detail?.delivery.project_id };
}

function requireCommandOperationId(operationName: string, operationId: string | null): void {
  if (!operationId) {
    throw new ApplicationOperationContractError(operationName, {
      reason: 'missing_command_operation_id',
    });
  }
}

export const prepareDeliveryReviewPackageOperation: ApplicationOperationDefinition = {
  name: 'prepare_delivery_review_package',
  version: 1,
  description:
    'Prepare one resumable customer review package with a primary PDF and optional HTML/image files.',
  kind: 'command',
  execution: 'sync',
  idempotency: 'required',
  allowedScopes: ['instance', 'org', 'project'],
  resolveScopeTarget: projectForDelivery,
  inputSchema: z
    .object({
      delivery_id: z.string().min(1),
      source_run_id: z.string().min(1).nullable().optional(),
      gate_key: z.string().trim().min(1).max(100).default('review'),
      review_note: z.string().trim().min(1).max(20_000),
      files: z
        .array(fileSpec)
        .min(1)
        .max(3)
        .superRefine((files, context) => {
          const roles = files.map((file) => file.role);
          if (roles.filter((role) => role === 'review_document').length !== 1) {
            context.addIssue({
              code: 'custom',
              message: 'files must contain exactly one review_document',
            });
          }
          if (new Set(roles).size !== roles.length) {
            context.addIssue({ code: 'custom', message: 'each file role may appear only once' });
          }
        }),
      overview,
      replace_draft: z.boolean().default(false),
    })
    .strict(),
  outputSchema: z
    .object({
      status: z.literal('prepared'),
      project_id: z.string(),
      delivery_id: z.string(),
      package_id: z.string(),
      revision: z.number().int().positive(),
      manifest_sha256: sha256,
      base_evidence_version: z.number().int().nonnegative(),
      status_call: z.object({
        operation: z.literal('get_delivery_review_package_status'),
        input: z.object({ delivery_id: z.string(), package_id: z.string() }),
      }),
      _agent_guidance: z.object({ message: z.string(), next_steps: z.array(z.string()).max(3) }),
    })
    .strict(),
  activity: { recordsActivity: true, recordsEvidence: false },
  execute: async (input, context) => {
    requireCommandOperationId('prepare_delivery_review_package', context.operationId);
    const detail = await context.appCtx.deliveryReviewPackageService.prepare({
      deliveryId: String(input['delivery_id']),
      sourceRunId: typeof input['source_run_id'] === 'string' ? input['source_run_id'] : null,
      gateKey: String(input['gate_key']),
      reviewNote: String(input['review_note']),
      files: input['files'] as z.infer<typeof fileSpec>[],
      overview: input['overview'] as z.infer<typeof overview>,
      replaceDraft: input['replace_draft'] === true,
      actor: context.actor.label,
    });
    return {
      status: 'prepared',
      project_id: detail.delivery.project_id,
      delivery_id: detail.delivery.id,
      package_id: detail.package.id,
      revision: detail.package.revision,
      manifest_sha256: detail.package.manifest_sha256,
      base_evidence_version: detail.package.base_evidence_version,
      status_call: {
        operation: 'get_delivery_review_package_status',
        input: { delivery_id: detail.delivery.id, package_id: detail.package.id },
      },
      _agent_guidance: {
        message:
          'The customer review package is prepared. Request upload capabilities only when you are ready to PUT the files.',
        next_steps: [
          'Call get_delivery_review_package_status with include_upload_capabilities=true.',
          'PUT only the missing files to their short-lived bearer URLs.',
        ],
      },
    };
  },
};

export const getDeliveryReviewPackageStatusOperation: ApplicationOperationDefinition = {
  name: 'get_delivery_review_package_status',
  version: 1,
  description:
    'Read current customer review package files, blockers, review target, and optional upload capabilities.',
  kind: 'query',
  execution: 'sync',
  idempotency: 'none',
  allowedScopes: ['instance', 'org', 'project'],
  resolveScopeTarget: projectForDelivery,
  inputSchema: z
    .object({
      delivery_id: z.string().min(1),
      package_id: z.string().min(1).optional(),
      include_upload_capabilities: z.boolean().default(false),
    })
    .strict(),
  outputSchema: z
    .object({
      status: z.literal('ok'),
      project_id: z.string(),
      delivery_id: z.string(),
      selected: packageSummary,
      draft: packageSummary.nullable(),
      current: packageSummary.nullable(),
      previous: packageSummary.nullable(),
      files: z.array(itemSummary).max(3),
      missing_roles: z.array(fileRole).max(3),
      blockers: z.array(z.string()).max(10),
      review_gate: z
        .object({
          gate_key: z.string(),
          status: z.enum(['pending', 'passed', 'warning', 'failed', 'waived']),
          review_package_id: z.string().nullable(),
          report_artifact_id: z.string().nullable(),
        })
        .nullable(),
      overview: z.object({
        mode: z.enum(['update', 'keep']),
        keep_reason: z.string().nullable(),
        before_sha256: sha256,
        after_sha256: sha256,
      }),
      upload_capabilities: z.array(uploadCapability).max(3),
      suggested_call: z.object({
        operation: z.string(),
        input: z.record(z.string(), z.unknown()),
        idempotency_key: z.string().min(1).max(200).optional(),
      }),
      _agent_guidance: z.object({ message: z.string(), next_steps: z.array(z.string()).max(3) }),
    })
    .strict(),
  activity: { recordsActivity: false, recordsEvidence: false },
  execute: async (input, context) => {
    const status = await context.appCtx.deliveryReviewPackageService.getStatus({
      deliveryId: String(input['delivery_id']),
      packageId: typeof input['package_id'] === 'string' ? input['package_id'] : null,
      includeUploadCapabilities: input['include_upload_capabilities'] === true,
    });
    const selected = status.selected;
    const readyToPublish = selected.package.status === 'draft' && status.missing_roles.length === 0;
    const suggestedCall = readyToPublish
      ? {
          operation: 'publish_delivery_review_package',
          idempotency_key: `review-package:${selected.package.id}:publish:${selected.package.manifest_sha256}`,
          input: {
            package_id: selected.package.id,
            expected_manifest_sha256: selected.package.manifest_sha256,
            expected_delivery_evidence_version: selected.package.base_evidence_version,
          },
        }
      : selected.package.status === 'published'
        ? {
            operation: 'get_delivery_review_status',
            input: {
              delivery_id: selected.delivery.id,
              gate_key: selected.package.review_gate_key,
            },
          }
        : {
            operation: 'get_delivery_review_package_status',
            input: {
              delivery_id: selected.delivery.id,
              package_id: selected.package.id,
              include_upload_capabilities: true,
            },
          };
    return {
      status: 'ok',
      project_id: selected.delivery.project_id,
      delivery_id: selected.delivery.id,
      selected: packageSummaryFrom(selected.package),
      draft: status.draft ? packageSummaryFrom(status.draft) : null,
      current: status.current ? packageSummaryFrom(status.current) : null,
      previous: status.previous ? packageSummaryFrom(status.previous) : null,
      files: selected.items.map(itemSummaryFrom),
      missing_roles: status.missing_roles,
      blockers: status.blockers,
      review_gate: selected.gate
        ? {
            gate_key: selected.gate.gate_key,
            status: selected.gate.status,
            review_package_id: selected.gate.review_package_id,
            report_artifact_id: selected.gate.report_artifact_id,
          }
        : null,
      overview: {
        mode: selected.package.overview_mode,
        keep_reason: selected.package.overview_keep_reason,
        before_sha256: selected.package.overview_before_sha256,
        after_sha256: selected.package.overview_after_sha256,
      },
      upload_capabilities: status.upload_capabilities,
      suggested_call: suggestedCall,
      _agent_guidance: {
        message: readyToPublish
          ? 'All required files match the prepared manifest. Publish this exact package revision.'
          : selected.package.status === 'published'
            ? 'This package is published and its exact manifest is waiting for review.'
            : 'Upload only the files that are still pending or failed, then check status again.',
        next_steps: readyToPublish
          ? [
              'Call publish_delivery_review_package with the returned manifest and evidence version.',
            ]
          : selected.package.status === 'published'
            ? ['Poll the Delivery review checkpoint; do not treat pending review as approval.']
            : [
                'Use only freshly returned upload capabilities.',
                'Recheck package status after PUT.',
              ],
      },
    };
  },
};

export const publishDeliveryReviewPackageOperation: ApplicationOperationDefinition = {
  name: 'publish_delivery_review_package',
  version: 1,
  description:
    'Atomically publish one prepared customer review package and bind its exact manifest to the Review Gate.',
  kind: 'command',
  execution: 'sync',
  idempotency: 'required',
  allowedScopes: ['instance', 'org', 'project'],
  resolveScopeTarget: projectForPackage,
  inputSchema: z
    .object({
      package_id: z.string().min(1),
      expected_manifest_sha256: sha256,
      expected_delivery_evidence_version: z.number().int().nonnegative(),
    })
    .strict(),
  outputSchema: z
    .object({
      status: z.literal('pending_review'),
      project_id: z.string(),
      delivery_id: z.string(),
      package_id: z.string(),
      revision: z.number().int().positive(),
      manifest_sha256: sha256,
      review_document_artifact_id: z.string(),
      review_document_sha256: sha256,
      status_call: z.object({
        operation: z.literal('get_delivery_review_package_status'),
        input: z.object({ delivery_id: z.string(), package_id: z.string() }),
      }),
      _agent_guidance: z.object({ message: z.string(), next_steps: z.array(z.string()).max(3) }),
    })
    .strict(),
  activity: { recordsActivity: true, recordsEvidence: true },
  execute: async (input, context) => {
    requireCommandOperationId('publish_delivery_review_package', context.operationId);
    const published = await context.appCtx.deliveryReviewPackageService.publish({
      packageId: String(input['package_id']),
      expectedManifestSha256: String(input['expected_manifest_sha256']).toLowerCase(),
      expectedDeliveryEvidenceVersion: Number(input['expected_delivery_evidence_version']),
      actor: context.actor.label,
    });
    const primary = published.items.find(({ item }) => item.role === 'review_document');
    if (!primary?.blob || !primary.artifact) {
      throw new ApplicationOperationContractError('publish_delivery_review_package', {
        reason: 'published_review_document_missing',
      });
    }
    return {
      status: 'pending_review',
      project_id: published.delivery.project_id,
      delivery_id: published.delivery.id,
      package_id: published.package.id,
      revision: published.package.revision,
      manifest_sha256: published.package.manifest_sha256,
      review_document_artifact_id: primary.artifact.id,
      review_document_sha256: primary.blob.sha256,
      status_call: {
        operation: 'get_delivery_review_package_status',
        input: { delivery_id: published.delivery.id, package_id: published.package.id },
      },
      _agent_guidance: {
        message:
          'The exact customer review package is published and waiting for a human review decision.',
        next_steps: [
          'Ask the reviewer to inspect and approve this package revision in OpenLander.',
          'Poll get_delivery_review_status before continuing the external workflow.',
        ],
      },
    };
  },
};

export const deliveryReviewPackageOperations = [
  prepareDeliveryReviewPackageOperation,
  getDeliveryReviewPackageStatusOperation,
  publishDeliveryReviewPackageOperation,
] as const;
