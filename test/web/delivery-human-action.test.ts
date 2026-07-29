import { describe, expect, it } from 'vitest';
import type { DeliveryDetail } from '../../web/src/lib/api/deliveries.js';
import { deriveDeliveryHumanAction } from '../../web/src/lib/delivery-human-action.js';

function deliveryDetail(
  input: {
    status?: DeliveryDetail['delivery']['status'];
    gates?: DeliveryDetail['gates'];
    workItems?: DeliveryDetail['work_items'];
    artifacts?: DeliveryDetail['artifacts'];
  } = {},
): DeliveryDetail {
  return {
    delivery: {
      id: 'delivery-human-action',
      project_id: 'project-human-action',
      title: 'Review one exact proposal',
      summary: 'Review the evidence selected by the agent.',
      delivery_type: 'artifact_delivery',
      maturity: 'functional_preview',
      status: input.status ?? 'in_review',
      evidence_version: 1,
      previewed_evidence_version: null,
      limitations: 'External apply is out of scope.',
      predecessor_delivery_id: null,
      created_by: 'agent',
      created_at: '2026-07-28T00:00:00.000Z',
      updated_at: '2026-07-28T00:00:00.000Z',
    },
    settings: {
      project_id: 'project-human-action',
      organization_name: null,
      document_name: 'Receipt',
      primary_color: '#000000',
      logo_blob_id: null,
      footer_text: null,
      locale: 'ko',
      default_gates_json: {},
    },
    artifacts: input.artifacts ?? [],
    external_refs: [],
    feedback_sources: [],
    work_items: input.workItems ?? [],
    approvals: [],
    gates: input.gates ?? [],
    deploy_links: [],
    receipt: null,
  };
}

describe('Delivery human action summary', () => {
  it('counts the customer package separately from its included files', () => {
    const artifact = (
      id: string,
      role: NonNullable<DeliveryDetail['artifacts'][number]['review_package_role']>,
    ): DeliveryDetail['artifacts'][number] => ({
      id,
      delivery_id: 'delivery-human-action',
      blob_id: `blob-${id}`,
      logical_key: 'customer-review-package',
      revision: 1,
      kind:
        role === 'interactive_preview'
          ? 'review_html'
          : role === 'representative_image'
            ? 'image'
            : 'companion_pdf',
      original_filename: `${id}.pdf`,
      status: 'draft',
      companion_pdf_artifact_id: null,
      include_in_receipt: true,
      receipt_order: 10,
      review_package_role: role,
      blob: {
        id: `blob-${id}`,
        sha256: 'a'.repeat(64),
        mime_type: 'application/pdf',
        size_bytes: 100,
        storage_key: `sha256/${id}`,
      },
    });
    const detail = deliveryDetail({
      artifacts: [
        artifact('review-document', 'review_document'),
        artifact('preview', 'interactive_preview'),
        artifact('screen', 'representative_image'),
      ],
      gates: [
        {
          id: 'gate-review',
          gate_key: 'change-review',
          gate_type: 'review',
          label: 'Change review',
          required: true,
          status: 'pending',
          summary: null,
          waiver_reason: null,
          warning_accepted: false,
          report_artifact_id: 'artifact-review',
          review_package_id: 'package-review',
        },
      ],
    });

    expect(deriveDeliveryHumanAction(detail, null, null)).toEqual({
      state: 'review_version',
      count: 1,
      fileCount: 3,
      targetTab: 'gates',
      asksAgent: false,
    });
  });

  it('routes extracted feedback decisions to the customer review tab', () => {
    const detail = deliveryDetail({
      workItems: [
        {
          id: 'question-1',
          kind: 'question',
          title: 'Confirm owner',
          detail: 'Who confirms this change?',
          status: 'confirmed',
          is_ai_draft: false,
          resolution: null,
        },
      ],
    });

    expect(deriveDeliveryHumanAction(detail, null, null)).toMatchObject({
      state: 'review_items',
      count: 1,
      targetTab: 'gates',
    });
  });

  it('shows completion instead of stale review attention after finalization', () => {
    const detail = deliveryDetail({
      status: 'delivered',
      workItems: [
        {
          id: 'old-question',
          kind: 'question',
          title: 'Historical question',
          detail: 'Already captured in the final evidence.',
          status: 'confirmed',
          is_ai_draft: false,
          resolution: null,
        },
      ],
    });

    expect(deriveDeliveryHumanAction(detail, null, null)).toMatchObject({
      state: 'complete',
      targetTab: 'receipt',
    });
  });
});
