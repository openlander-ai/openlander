import { describe, expect, it } from 'vitest';

import {
  deriveDeliveryReviewStatus,
  requireDeliveryReviewTarget,
} from '../../src/delivery/review-status.js';
import type { DeliveryArtifactKind, DeliveryDetail } from '../../src/delivery/types.js';

const NOW = '2026-07-28T00:00:00.000Z';
const SHA_ONE = '1'.repeat(64);
const SHA_TWO = '2'.repeat(64);

function artifact(input: {
  id: string;
  kind: DeliveryArtifactKind;
  logicalKey: string;
  revision: number;
  sha256: string;
  status?: 'draft' | 'approved' | 'superseded';
}): DeliveryDetail['artifacts'][number] {
  return {
    id: input.id,
    delivery_id: 'delivery-review',
    blob_id: `blob-${input.id}`,
    logical_key: input.logicalKey,
    revision: input.revision,
    kind: input.kind,
    original_filename: `${input.logicalKey}.json`,
    status: input.status ?? 'draft',
    companion_pdf_artifact_id: null,
    include_in_receipt: true,
    receipt_order: 0,
    idempotency_key: null,
    created_at: NOW,
    updated_at: NOW,
    blob: {
      id: `blob-${input.id}`,
      sha256: input.sha256,
      mime_type: input.kind === 'markdown' ? 'text/markdown' : 'application/json',
      size_bytes: 128,
      storage_key: `sha256/${input.sha256}`,
      created_at: NOW,
    },
  };
}

function detail(
  input: {
    kind?: DeliveryArtifactKind;
    logicalKey?: string;
    artifactStatus?: 'draft' | 'approved' | 'superseded';
    gateStatus?: 'pending' | 'passed' | 'warning' | 'failed' | 'waived';
    deliveryStatus?: DeliveryDetail['delivery']['status'];
    withApproval?: boolean;
    withNewerRevision?: boolean;
    gateType?: DeliveryDetail['gates'][number]['gate_type'];
  } = {},
): DeliveryDetail {
  const selected = artifact({
    id: 'artifact-review-1',
    kind: input.kind ?? 'data_report',
    logicalKey: input.logicalKey ?? 'change-plan',
    revision: 1,
    sha256: SHA_ONE,
    status: input.artifactStatus,
  });
  const artifacts = input.withNewerRevision
    ? [
        selected,
        artifact({
          id: 'artifact-review-2',
          kind: selected.kind,
          logicalKey: selected.logical_key,
          revision: 2,
          sha256: SHA_TWO,
        }),
      ]
    : [selected];
  return {
    delivery: {
      id: 'delivery-review',
      project_id: 'project-review',
      title: 'Review checkpoint',
      summary: '',
      objective: '',
      definition_of_done: [],
      manifest_path: '.openlander/delivery.yml',
      auto_finalize: false,
      delivery_type: 'artifact_delivery',
      maturity: 'functional_preview',
      status: input.deliveryStatus ?? 'in_review',
      evidence_version: 1,
      previewed_evidence_version: null,
      limitations: null,
      predecessor_delivery_id: null,
      created_by: 'agent',
      created_at: NOW,
      updated_at: NOW,
    },
    settings: {} as DeliveryDetail['settings'],
    artifacts,
    external_refs: [],
    feedback_sources: [],
    work_items: [],
    approvals: input.withApproval
      ? [
          {
            id: 'approval-review',
            delivery_id: 'delivery-review',
            artifact_ids: ['artifact-review-1'],
            approver_display_name: 'Reviewer',
            approval_excerpt: 'Approved exact revision.',
            source_type: 'meeting',
            source_url: null,
            approved_at: NOW,
            invalidated_at: null,
            invalidated_reason: null,
            recorded_by: 'admin',
            created_at: NOW,
          },
        ]
      : [],
    gates: [
      {
        id: 'gate-review',
        delivery_id: 'delivery-review',
        gate_key: 'change-review',
        source: 'manifest',
        definition_sha256: SHA_TWO,
        gate_type: input.gateType ?? 'review',
        label: 'Change review',
        required: true,
        status: input.gateStatus ?? 'pending',
        summary: null,
        waiver_reason: input.gateStatus === 'waived' ? 'Accepted operationally.' : null,
        warning_accepted: false,
        report_artifact_id: 'artifact-review-1',
        idempotency_key: null,
        recorded_by: 'admin',
        recorded_at: NOW,
        created_at: NOW,
        updated_at: NOW,
      },
    ],
    deploy_links: [],
    receipt: null,
  };
}

describe('Delivery exact-Artifact review status', () => {
  it.each([
    ['data Import Plan', 'data_report' as const, 'coverage-import-plan'],
    ['weekly WBS proposal', 'markdown' as const, 'weekly-wbs-change'],
  ])('accepts the exact latest revision for a %s', (_label, kind, logicalKey) => {
    const result = deriveDeliveryReviewStatus(
      detail({
        kind,
        logicalKey,
        artifactStatus: 'approved',
        gateStatus: 'passed',
        withApproval: true,
      }),
      'change-review',
    );

    expect(result).toMatchObject({
      state: 'accepted',
      ready_for_next_step: true,
      approval_evidence_id: 'approval-review',
      artifact: {
        logical_key: logicalKey,
        revision: 1,
        sha256: SHA_ONE,
        is_latest_revision: true,
      },
      blockers: [],
    });
  });

  it('keeps a draft Artifact blocked while the Review Gate is pending', () => {
    expect(deriveDeliveryReviewStatus(detail(), 'change-review')).toMatchObject({
      state: 'pending',
      ready_for_next_step: false,
      blockers: ['artifact_not_approved', 'gate_pending'],
    });
  });

  it('marks a Gate bound to an older revision as stale', () => {
    expect(
      deriveDeliveryReviewStatus(detail({ withNewerRevision: true }), 'change-review'),
    ).toMatchObject({
      state: 'stale',
      ready_for_next_step: false,
      blockers: ['artifact_not_latest', 'artifact_not_approved', 'gate_pending'],
    });
  });

  it('reports an explicit waiver as ready without an approval blocker', () => {
    expect(
      deriveDeliveryReviewStatus(detail({ gateStatus: 'waived' }), 'change-review'),
    ).toMatchObject({
      state: 'waived',
      ready_for_next_step: true,
      blockers: [],
      gate: { waiver_reason: 'Accepted operationally.' },
    });
  });

  it('rejects a stale target, a mismatched SHA, and a non-review Gate', () => {
    expect(() =>
      requireDeliveryReviewTarget(detail({ withNewerRevision: true }), {
        gateKey: 'change-review',
        artifactId: 'artifact-review-1',
        expectedSha256: SHA_ONE,
      }),
    ).toThrow('Only the latest non-superseded artifact can be reviewed.');
    expect(() =>
      requireDeliveryReviewTarget(detail(), {
        gateKey: 'change-review',
        artifactId: 'artifact-review-1',
        expectedSha256: SHA_TWO,
      }),
    ).toThrow('Artifact SHA-256 does not match the expected review bytes.');
    expect(() =>
      requireDeliveryReviewTarget(detail({ gateType: 'qa' }), {
        gateKey: 'change-review',
        artifactId: 'artifact-review-1',
        expectedSha256: SHA_ONE,
      }),
    ).toThrow('is not a review Gate');
  });
});
