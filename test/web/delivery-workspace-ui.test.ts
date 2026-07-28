import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('Delivery Workspace UI contract', () => {
  const detailSource = readRepoFile('web/src/pages/DeliveryDetail.tsx');
  const workflowSource = readRepoFile('web/src/components/delivery/DeliveryWorkflowRail.tsx');

  it('connects every Delivery tab to an accessible tab panel', () => {
    for (const tab of ['overview', 'artifacts', 'review', 'gates', 'deployments', 'receipt']) {
      expect(detailSource).toContain(`panelId="deliverypanel-${tab}"`);
      expect(detailSource).toContain(`labelledBy="delivery-${tab}"`);
    }
    expect(detailSource).toContain('<TabPanel');
  });

  it('announces async status and exposes a persistent guided workflow', () => {
    expect(detailSource).toContain('role="alert"');
    expect(detailSource).toContain('role="status"');
    expect(detailSource).toContain('<DeliveryWorkflowRail');
    expect(workflowSource).toContain("aria-current={active ? 'step' : undefined}");
    expect(workflowSource).toContain("detail.delivery.status === 'delivered'");
    expect(workflowSource).toContain('readiness.blockers.length');
    expect(workflowSource).toContain("if (pendingExactReview) return 'gates'");
  });

  it('restores finalization eligibility only for the current evidence preview', () => {
    expect(detailSource).toContain(
      'nextDetail.delivery.previewed_evidence_version === nextDetail.delivery.evidence_version',
    );
    expect(detailSource).toContain("key !== 'receipt:preview'");
  });

  it('shows one exact review target and keeps its acceptance out of generic artifact actions', () => {
    expect(detailSource).toContain('<ReviewCheckpointCard');
    expect(detailSource).toContain('acceptDeliveryReview(deliveryId');
    expect(detailSource).toContain('expected_sha256: artifact.blob.sha256');
    expect(detailSource).toContain("artifact.status === 'draft' && !reviewTarget");
    expect(detailSource).toContain('countDeliveryReviewAttention(detail)');
  });
});
