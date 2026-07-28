import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('Delivery Workspace UI contract', () => {
  const detailSource = readRepoFile('web/src/pages/DeliveryDetail.tsx');
  const workflowSource = readRepoFile('web/src/components/delivery/DeliveryWorkflowRail.tsx');
  const humanActionSource = readRepoFile('web/src/lib/delivery-human-action.ts');

  it('connects every Delivery tab to an accessible tab panel', () => {
    for (const tab of ['overview', 'artifacts', 'gates', 'deployments', 'receipt']) {
      expect(detailSource).toContain(`panelId="deliverypanel-${tab}"`);
      expect(detailSource).toContain(`labelledBy="delivery-${tab}"`);
    }
    expect(detailSource).not.toContain('panelId="deliverypanel-review"');
    expect(detailSource).toContain('<TabPanel');
  });

  it('announces async status and exposes a persistent guided workflow', () => {
    expect(detailSource).toContain('role="alert"');
    expect(detailSource).toContain('role="status"');
    expect(detailSource).toContain('<DeliveryHumanActionCard');
    expect(detailSource).toContain('<DeliveryWorkflowRail');
    expect(workflowSource).toContain('<details');
    expect(workflowSource).toContain('<summary');
    expect(workflowSource).not.toContain('<details open');
    expect(workflowSource).toContain("aria-current={active ? 'step' : undefined}");
    expect(workflowSource).toContain("detail.delivery.status === 'delivered'");
    expect(workflowSource).toContain('readiness.blockers.length');
    expect(workflowSource).toContain("if (pendingExactReview) return 'gates'");
    expect(humanActionSource).toContain("state: 'review_version'");
    expect(humanActionSource).toContain("targetTab: 'gates'");
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
    expect(detailSource).toContain('countPendingReviewGates(detail)');
    expect(detailSource).toContain('pendingReviewGateCount + pendingReviewItemCount');
  });

  it('shows one package-level review card without adding a browser upload form', () => {
    expect(detailSource).toContain('getDeliveryReviewPackageStatus');
    expect(detailSource).toContain("t('delivery.reviewPackage.versionTitle'");
    expect(detailSource).toContain('expected_manifest_sha256');
    expect(detailSource).toContain('artifact.review_package_role');
    expect(detailSource).not.toContain('type="file"');
  });

  it('prioritizes customer shareables while keeping internal evidence and history collapsed', () => {
    expect(detailSource).toContain('groupDeliveryArtifacts(detail.artifacts, detail.gates)');
    expect(detailSource).toContain("t('delivery.artifacts.customerTitle')");
    expect(detailSource).toContain("t('delivery.artifacts.internalTitle'");
    expect(detailSource).toContain("t('delivery.artifacts.historyTitle'");
    expect(detailSource).toContain('<details className=');
    expect(detailSource).not.toContain('<details open');
  });

  it('combines human review evidence and quality Gates in one task-oriented tab', () => {
    expect(detailSource).toContain("id: 'gates'");
    expect(detailSource).toContain('<GatesPanel');
    expect(detailSource).toContain('<ReviewPanel');
    expect(detailSource).not.toContain("id: 'review',");
    expect(detailSource).toContain('detail.feedback_sources.length > 0');
    expect(detailSource).toContain('detail.work_items.length > 0');
    expect(detailSource).toContain('activeApprovals.length > 0');
    expect(detailSource).toContain('detail.external_refs.length > 0');
    expect(workflowSource).toContain("{ id: 'gates', complete: reviewComplete && gatesComplete }");
    expect(workflowSource).toContain('lg:grid-cols-5');
  });

  it('shows unmet completion checks first and collapses satisfied conditions', () => {
    expect(detailSource).toContain('const pendingChecks =');
    expect(detailSource).toContain("t('delivery.receipt.remainingTitle'");
    expect(detailSource).toContain("t('delivery.receipt.satisfiedTitle'");
    expect(detailSource).toContain('<details className=');
  });
});
