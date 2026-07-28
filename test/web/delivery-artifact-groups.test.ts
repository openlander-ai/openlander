import { describe, expect, it } from 'vitest';
import type { DeliveryArtifact, DeliveryGate } from '../../web/src/lib/api/deliveries.js';
import { groupDeliveryArtifacts } from '../../web/src/lib/delivery-artifact-groups.js';

function artifact(
  id: string,
  input: Partial<DeliveryArtifact> & Pick<DeliveryArtifact, 'kind' | 'logical_key'>,
): DeliveryArtifact {
  return {
    id,
    delivery_id: 'delivery-1',
    blob_id: `blob-${id}`,
    revision: 1,
    original_filename: `${id}.bin`,
    status: 'draft',
    companion_pdf_artifact_id: null,
    include_in_receipt: true,
    receipt_order: 0,
    blob: {
      id: `blob-${id}`,
      sha256: id.padEnd(64, '0'),
      mime_type: 'application/octet-stream',
      size_bytes: 10,
      storage_key: `sha256/${id}`,
    },
    ...input,
  };
}

function reviewGate(reportArtifactId: string): DeliveryGate {
  return {
    id: 'gate-review',
    gate_key: 'review',
    gate_type: 'review',
    label: 'Review',
    required: true,
    status: 'pending',
    summary: null,
    waiver_reason: null,
    warning_accepted: false,
    report_artifact_id: reportArtifactId,
  };
}

describe('Delivery artifact groups', () => {
  it('shows customer files once and keeps QA evidence and prior records separate', () => {
    const pdfHash = 'f'.repeat(64);
    const reviewPdf = artifact('review-pdf', {
      kind: 'companion_pdf',
      logical_key: 'customer-review-pack',
      blob: {
        id: 'blob-review-pdf',
        sha256: pdfHash,
        mime_type: 'application/pdf',
        size_bytes: 20,
        storage_key: 'sha256/review-pdf',
      },
    });
    const duplicatePdf = artifact('duplicate-pdf', {
      kind: 'companion_pdf',
      logical_key: 'offline-review',
      blob: { ...reviewPdf.blob },
    });
    const html = artifact('review-html', {
      kind: 'review_html',
      logical_key: 'offline-review',
    });
    const qa = artifact('qa', { kind: 'qa_report', logical_key: 'qa-evidence' });
    const image = artifact('image', { kind: 'image', logical_key: 'scenario-capture' });
    const oldHtml = artifact('old-html', {
      kind: 'review_html',
      logical_key: 'offline-review',
      status: 'superseded',
    });

    const groups = groupDeliveryArtifacts(
      [qa, duplicatePdf, oldHtml, html, image, reviewPdf],
      [reviewGate(reviewPdf.id)],
    );

    expect(groups.customerShareables.map((item) => item.id)).toEqual(['review-pdf', 'review-html']);
    expect(groups.internalEvidence.map((item) => item.id)).toEqual(['qa', 'image']);
    expect(groups.history.map((item) => item.id)).toEqual(['old-html', 'duplicate-pdf']);
    expect(groups.currentCount).toBe(4);
  });

  it('treats an exact Review Gate target as customer material regardless of kind', () => {
    const report = artifact('review-report', {
      kind: 'data_report',
      logical_key: 'customer-data-review',
    });

    const groups = groupDeliveryArtifacts([report], [reviewGate(report.id)]);

    expect(groups.customerShareables).toEqual([report]);
    expect(groups.internalEvidence).toEqual([]);
  });
});
