import type { DeliveryDetail, DeliveryReadiness } from './types.js';
import { MAX_RECEIPT_PAGES } from './types.js';

/**
 * Deterministic readiness evaluation. File I/O (companion PDF page counting)
 * is deliberately kept outside this function so every blocker can be tested
 * without a database or artifact store.
 */
export function evaluateDeliveryReadiness(
  detail: DeliveryDetail,
  estimatedPages: number,
): DeliveryReadiness {
  const approvedArtifacts = detail.artifacts.filter((artifact) => artifact.status === 'approved');
  const activeApprovals = detail.approvals.filter((approval) => !approval.invalidated_at);
  const unresolved = detail.work_items.filter(
    (item) =>
      (item.kind === 'change_request' || item.kind === 'question') && item.status === 'confirmed',
  );
  const requiredGateFailures = detail.gates.filter(
    (gate) =>
      gate.required &&
      !(
        gate.status === 'passed' ||
        (gate.status === 'waived' && Boolean(gate.waiver_reason?.trim()))
      ),
  );
  const warningFailures = detail.gates.filter(
    (gate) => gate.status === 'warning' && !gate.warning_accepted,
  );
  const htmlWithoutPdf = approvedArtifacts.filter((artifact) => {
    if (artifact.kind !== 'review_html' || !artifact.include_in_receipt) return false;
    const companion = detail.artifacts.find(
      (candidate) => candidate.id === artifact.companion_pdf_artifact_id,
    );
    return (
      !companion ||
      companion.kind !== 'companion_pdf' ||
      companion.status !== 'approved' ||
      !companion.include_in_receipt ||
      companion.logical_key !== artifact.logical_key ||
      companion.revision !== artifact.revision
    );
  });
  const releasedProductionDeploys = detail.deploy_links.filter(
    ({ link, deploy, environment, service }) =>
      link.relation === 'released' &&
      deploy.status === 'success' &&
      environment?.type === 'production' &&
      service.project_id === detail.delivery.project_id,
  );
  const deliveryApproved =
    detail.delivery.status === 'approved' ||
    detail.delivery.status === 'ready' ||
    detail.delivery.status === 'delivered';
  const checks: DeliveryReadiness['checks'] = [
    {
      key: 'delivery_approved',
      passed: deliveryApproved,
      message: deliveryApproved
        ? 'Delivery approval is recorded.'
        : 'The FDE must approve the Delivery before Receipt preview.',
    },
    {
      key: 'approved_artifact',
      passed: approvedArtifacts.length > 0,
      params: { count: approvedArtifacts.length },
      message:
        approvedArtifacts.length > 0
          ? `${String(approvedArtifacts.length)} approved artifact(s)`
          : 'At least one approved artifact is required.',
    },
    {
      key: 'customer_approval',
      passed: activeApprovals.length > 0,
      params: { count: activeApprovals.length },
      message:
        activeApprovals.length > 0
          ? `${String(activeApprovals.length)} active customer approval record(s)`
          : 'Customer approval evidence is required.',
    },
    {
      key: 'work_items_resolved',
      passed: unresolved.length === 0,
      params: { count: unresolved.length },
      message:
        unresolved.length === 0
          ? 'All confirmed questions and change requests are resolved.'
          : `${String(unresolved.length)} confirmed question/change request(s) remain unresolved.`,
    },
    {
      key: 'required_gates',
      passed: requiredGateFailures.length === 0,
      params: { count: requiredGateFailures.length },
      message:
        requiredGateFailures.length === 0
          ? 'All required Gates passed or were waived with a reason.'
          : `${String(requiredGateFailures.length)} required Gate(s) are not satisfied.`,
    },
    {
      key: 'warnings_acknowledged',
      passed: warningFailures.length === 0,
      params: { count: warningFailures.length },
      message:
        warningFailures.length === 0
          ? 'All Gate warnings are acknowledged.'
          : `${String(warningFailures.length)} Gate warning(s) require acknowledgment.`,
    },
    {
      key: 'limitations_recorded',
      passed: Boolean(detail.delivery.limitations?.trim()),
      message: detail.delivery.limitations?.trim()
        ? 'Known limitations are recorded.'
        : 'Enter known limitations or explicitly state none.',
    },
    {
      key: 'html_companion_pdf',
      passed: htmlWithoutPdf.length === 0,
      params: { count: htmlWithoutPdf.length },
      message:
        htmlWithoutPdf.length === 0
          ? 'Every included HTML artifact has an approved companion PDF.'
          : `${String(htmlWithoutPdf.length)} HTML artifact(s) lack a matching approved companion PDF.`,
    },
    {
      key: 'production_deploy',
      passed:
        detail.delivery.delivery_type === 'artifact_delivery' ||
        releasedProductionDeploys.length > 0,
      params: {
        count: releasedProductionDeploys.length,
        not_required: detail.delivery.delivery_type === 'artifact_delivery' ? 1 : 0,
      },
      message:
        detail.delivery.delivery_type === 'artifact_delivery'
          ? 'Production deployment is not required for artifact delivery.'
          : releasedProductionDeploys.length > 0
            ? 'A successful same-project Production deployment is linked.'
            : 'A successful same-project Production deployment must be linked as released.',
    },
    {
      key: 'page_limit',
      passed: estimatedPages <= MAX_RECEIPT_PAGES,
      params: { count: estimatedPages, max: MAX_RECEIPT_PAGES },
      message:
        estimatedPages <= MAX_RECEIPT_PAGES
          ? `Estimated Receipt length is ${String(estimatedPages)} page(s).`
          : `Estimated Receipt length ${String(estimatedPages)} exceeds ${String(MAX_RECEIPT_PAGES)} pages.`,
    },
  ];
  return {
    ready: checks.every((check) => check.passed),
    checks,
    blockers: checks.filter((check) => !check.passed).map((check) => check.message),
    estimated_pages: estimatedPages,
  };
}
