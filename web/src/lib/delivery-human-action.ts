import type {
  DeliveryDetail,
  DeliveryExecutionView,
  DeliveryReadiness,
} from '@/lib/api/deliveries';

export type DeliveryHumanState =
  | 'review_version'
  | 'review_items'
  | 'gate_warning'
  | 'agent_working'
  | 'revision_in_progress'
  | 'ready'
  | 'complete'
  | 'cancelled'
  | 'idle';

export interface DeliveryHumanAction {
  state: DeliveryHumanState;
  count: number;
  targetTab: 'gates' | 'receipt' | null;
  asksAgent: boolean;
}

export function deriveDeliveryHumanAction(
  detail: DeliveryDetail,
  execution: DeliveryExecutionView | null,
  readiness: DeliveryReadiness | null,
): DeliveryHumanAction {
  if (detail.delivery.status === 'delivered') {
    return { state: 'complete', count: 0, targetTab: 'receipt', asksAgent: false };
  }
  if (detail.delivery.status === 'cancelled') {
    return { state: 'cancelled', count: 0, targetTab: null, asksAgent: false };
  }

  const pendingReviewVersions = detail.gates.filter(
    (gate) =>
      gate.gate_type === 'review' && gate.status === 'pending' && Boolean(gate.report_artifact_id),
  ).length;
  if (pendingReviewVersions > 0 && detail.delivery.status === 'in_review') {
    return {
      state: 'review_version',
      count: pendingReviewVersions,
      targetTab: 'gates',
      asksAgent: false,
    };
  }

  const reviewItems = detail.work_items.filter(
    (item) =>
      item.status === 'proposed' ||
      (item.status === 'confirmed' && (item.kind === 'question' || item.kind === 'change_request')),
  ).length;
  if (reviewItems > 0) {
    return { state: 'review_items', count: reviewItems, targetTab: 'gates', asksAgent: false };
  }

  const warnings = detail.gates.filter(
    (gate) => gate.status === 'warning' && !gate.warning_accepted,
  ).length;
  if (warnings > 0) {
    return { state: 'gate_warning', count: warnings, targetTab: 'gates', asksAgent: false };
  }

  if (detail.delivery.status === 'revision_requested') {
    return {
      state: 'revision_in_progress',
      count: 0,
      targetTab: null,
      asksAgent: true,
    };
  }
  if (execution?.agent_runs.some((run) => run.status === 'running')) {
    return { state: 'agent_working', count: 0, targetTab: null, asksAgent: false };
  }
  if (readiness?.ready) {
    return { state: 'ready', count: 0, targetTab: null, asksAgent: true };
  }
  return { state: 'idle', count: 0, targetTab: null, asksAgent: true };
}
