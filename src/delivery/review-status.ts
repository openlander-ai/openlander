import { ArtifactNotFoundError, ArtifactValidationError, DeliveryStateError } from '../errors.js';
import type {
  DeliveryArtifactWithBlob,
  DeliveryDetail,
  DeliveryReviewBlocker,
  DeliveryReviewStatus,
} from './types.js';

interface ReviewTargetInput {
  gateKey: string;
  artifactId: string;
  expectedSha256: string;
}

function requireReviewGate(detail: DeliveryDetail, gateKey: string) {
  const gate = detail.gates.find((candidate) => candidate.gate_key === gateKey);
  if (!gate) {
    throw new DeliveryStateError(detail.delivery.id, `Delivery Gate ${gateKey} was not found.`);
  }
  if (gate.gate_type !== 'review') {
    throw new DeliveryStateError(
      detail.delivery.id,
      `Delivery Gate ${gateKey} is not a review Gate.`,
    );
  }
  return gate;
}

function isLatestRevision(
  artifacts: DeliveryArtifactWithBlob[],
  target: DeliveryArtifactWithBlob,
): boolean {
  const latestRevision = Math.max(
    ...artifacts
      .filter(
        (candidate) =>
          candidate.logical_key === target.logical_key && candidate.kind === target.kind,
      )
      .map((candidate) => candidate.revision),
  );
  return target.revision === latestRevision;
}

export function requireDeliveryReviewTarget(
  detail: DeliveryDetail,
  input: ReviewTargetInput,
): DeliveryArtifactWithBlob {
  requireReviewGate(detail, input.gateKey);
  const artifact = detail.artifacts.find((candidate) => candidate.id === input.artifactId);
  if (!artifact) throw new ArtifactNotFoundError(input.artifactId);
  if (artifact.status === 'superseded' || !isLatestRevision(detail.artifacts, artifact)) {
    throw new ArtifactValidationError('Only the latest non-superseded artifact can be reviewed.', {
      artifactId: artifact.id,
      logicalKey: artifact.logical_key,
      revision: artifact.revision,
    });
  }
  if (artifact.blob.sha256.toLowerCase() !== input.expectedSha256.toLowerCase()) {
    throw new ArtifactValidationError(
      'Artifact SHA-256 does not match the expected review bytes.',
      {
        artifactId: artifact.id,
        expectedSha256: input.expectedSha256.toLowerCase(),
        actualSha256: artifact.blob.sha256,
      },
    );
  }
  return artifact;
}

export function deriveDeliveryReviewStatus(
  detail: DeliveryDetail,
  gateKey: string,
): DeliveryReviewStatus {
  const gate = requireReviewGate(detail, gateKey);
  const artifact = gate.report_artifact_id
    ? (detail.artifacts.find((candidate) => candidate.id === gate.report_artifact_id) ?? null)
    : null;
  const latest = artifact ? isLatestRevision(detail.artifacts, artifact) : false;
  const approval = artifact
    ? (detail.approvals.find(
        (candidate) => !candidate.invalidated_at && candidate.artifact_ids.includes(artifact.id),
      ) ?? null)
    : null;
  const blockers: DeliveryReviewBlocker[] = [];
  const validWaiver = gate.status === 'waived' && Boolean(gate.waiver_reason?.trim());

  if (!gate.report_artifact_id) blockers.push('review_not_requested');
  else if (!artifact) blockers.push('artifact_not_found');
  if (artifact && (!latest || artifact.status === 'superseded')) {
    blockers.push('artifact_not_latest');
  }
  if (artifact && artifact.status !== 'approved' && !validWaiver) {
    blockers.push('artifact_not_approved');
  }
  if (gate.status === 'pending') blockers.push('gate_pending');
  if (gate.status === 'failed') blockers.push('gate_failed');
  if (gate.status === 'warning') blockers.push('gate_warning');

  const exactArtifactAccepted =
    artifact !== null && latest && artifact.status === 'approved' && gate.status === 'passed';
  const exactArtifactWaived =
    artifact !== null && latest && artifact.status !== 'superseded' && validWaiver;
  let state: DeliveryReviewStatus['state'];
  if (!gate.report_artifact_id) state = 'not_requested';
  else if (!artifact || !latest || artifact.status === 'superseded') state = 'stale';
  else if (gate.status === 'failed' || detail.delivery.status === 'revision_requested') {
    state = 'changes_requested';
  } else if (exactArtifactAccepted) state = 'accepted';
  else if (exactArtifactWaived) state = 'waived';
  else state = 'pending';

  return {
    project_id: detail.delivery.project_id,
    delivery_id: detail.delivery.id,
    gate_key: gate.gate_key,
    state,
    ready_for_next_step: exactArtifactAccepted || exactArtifactWaived,
    artifact: artifact
      ? {
          id: artifact.id,
          logical_key: artifact.logical_key,
          revision: artifact.revision,
          sha256: artifact.blob.sha256,
          status: artifact.status,
          is_latest_revision: latest,
        }
      : null,
    gate: {
      status: gate.status,
      required: gate.required,
      recorded_by: gate.recorded_by,
      recorded_at: gate.recorded_at,
      waiver_reason: gate.waiver_reason,
    },
    approval_evidence_id: approval?.id ?? null,
    blockers,
  };
}
