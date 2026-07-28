import type { DeliveryArtifact, DeliveryGate } from './api/deliveries';

export interface DeliveryArtifactGroups {
  customerShareables: DeliveryArtifact[];
  internalEvidence: DeliveryArtifact[];
  history: DeliveryArtifact[];
  currentCount: number;
}

function compareArtifacts(a: DeliveryArtifact, b: DeliveryArtifact): number {
  if (a.receipt_order !== b.receipt_order) return a.receipt_order - b.receipt_order;
  if (a.logical_key !== b.logical_key) return a.logical_key.localeCompare(b.logical_key);
  return a.revision - b.revision;
}

/**
 * Builds the human-facing artifact view from the existing Delivery contract.
 * `review_html` and `companion_pdf` are customer material; an exact Review Gate
 * target is always customer-facing. Everything else stays internal by default.
 * Duplicate customer records that point to the same immutable blob are shown
 * once, while the full record remains available in history.
 */
export function groupDeliveryArtifacts(
  artifacts: DeliveryArtifact[],
  gates: DeliveryGate[],
): DeliveryArtifactGroups {
  const reviewTargetIds = new Set(
    gates
      .filter((gate) => gate.gate_type === 'review' && gate.report_artifact_id)
      .map((gate) => gate.report_artifact_id as string),
  );
  const current = artifacts.filter((artifact) => artifact.status !== 'superseded');
  const customerCandidates = current
    .filter(
      (artifact) =>
        reviewTargetIds.has(artifact.id) ||
        artifact.kind === 'review_html' ||
        artifact.kind === 'companion_pdf',
    )
    .sort((a, b) => {
      const reviewPriority = Number(reviewTargetIds.has(b.id)) - Number(reviewTargetIds.has(a.id));
      return reviewPriority || compareArtifacts(a, b);
    });

  const customerByBlob = new Map<string, DeliveryArtifact>();
  const duplicateCustomerRecords: DeliveryArtifact[] = [];
  for (const artifact of customerCandidates) {
    if (customerByBlob.has(artifact.blob.sha256)) {
      duplicateCustomerRecords.push(artifact);
      continue;
    }
    customerByBlob.set(artifact.blob.sha256, artifact);
  }

  const customerCandidateIds = new Set(customerCandidates.map((artifact) => artifact.id));
  const customerShareables = [...customerByBlob.values()].sort(compareArtifacts);
  const internalEvidence = current
    .filter((artifact) => !customerCandidateIds.has(artifact.id))
    .sort(compareArtifacts);
  const history = [
    ...artifacts.filter((artifact) => artifact.status === 'superseded'),
    ...duplicateCustomerRecords,
  ].sort(compareArtifacts);

  return {
    customerShareables,
    internalEvidence,
    history,
    currentCount: customerShareables.length + internalEvidence.length,
  };
}
