import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { translations as en } from '../../web/src/i18n/en.js';
import { translations as ko } from '../../web/src/i18n/ko.js';
import {
  formatDeliveryRunPhase,
  formatReadinessCheck,
} from '../../web/src/pages/DeliveryDetail.js';

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

function keys(value: unknown, prefix = ''): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [prefix];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    keys(child, prefix ? `${prefix}.${key}` : key),
  );
}

describe('Engagement Portfolio UI contract', () => {
  const appSource = readRepoFile('web/src/App.tsx');
  const activityLoggerSource = readRepoFile('src/monitor/activity-logger.ts');
  const sidebarSource = readRepoFile('web/src/components/Shell/Sidebar.tsx');
  const listSource = readRepoFile('web/src/pages/Engagements.tsx');
  const detailSource = readRepoFile('web/src/pages/EngagementDetail.tsx');
  const projectSource = readRepoFile('web/src/pages/ProjectView.tsx');
  const projectContextSource = readRepoFile('web/src/components/project/ProjectContextTab.tsx');
  const deliverySource = readRepoFile('web/src/pages/DeliveryDetail.tsx');
  const deliveriesTabSource = readRepoFile('web/src/components/delivery/DeliveriesTab.tsx');

  it('registers portfolio routes and the Workspace sidebar entry', () => {
    expect(appSource).toContain('path="/engagements"');
    expect(appSource).toContain('path="/engagements/:engagementId"');
    expect(sidebarSource).toContain("id: 'engagements'");
    expect(sidebarSource).toContain("labelKey: 'sidebar.items.engagements'");
  });

  it('keeps the detail page limited to the four planned evidence sections', () => {
    for (const section of ['projects', 'deliveries', 'blockers', 'activity']) {
      expect(detailSource).toContain(`engagements.sections.${section}.title`);
      expect(detailSource).toContain(`engagements.sections.${section}.description`);
    }
    expect(detailSource).not.toContain('Gantt');
    expect(detailSource).not.toContain('assignee');
    expect(detailSource).not.toContain('customer portal');
  });

  it('renders known server events and blockers from locale-neutral metadata', () => {
    expect(detailSource).toContain('ACTIVITY_TRANSLATION_KEYS');
    expect(detailSource).toContain('activityTitle(activity, t)');
    expect(detailSource).toContain('blockerContext(blocker, t)');
    expect(detailSource).toContain('blockerDetail(blocker, t)');
    expect(detailSource).not.toContain('{activity.title}');
    expect(detailSource).not.toContain('{blocker.detail}');
    expect(en.engagements.activityEvent.unknown).not.toContain('{eventType}');
    expect(ko.engagements.activityEvent.unknown).not.toContain('{eventType}');
  });

  it('localizes every persisted project activity event without exposing raw enum names', () => {
    const persistedList = activityLoggerSource.match(
      /const PERSISTED_EVENT_TYPES:[\s\S]*?= \[([\s\S]*?)\];/,
    )?.[1];
    expect(persistedList).toBeDefined();
    const persistedEventTypes = [...(persistedList ?? '').matchAll(/'([^']+)'/g)].map(
      ([, eventType]) => eventType,
    );

    for (const eventType of persistedEventTypes) {
      expect(detailSource, `missing Engagement activity mapping for ${eventType}`).toContain(
        `'${eventType}':`,
      );
    }
    expect(detailSource).not.toContain('{ eventType: activity.event_type }');
  });

  it('renders Delivery readiness from stable keys instead of English server prose', () => {
    expect(deliverySource).toContain(
      'formatReadinessCheck(check, detail.delivery.delivery_type, t)',
    );
    expect(deliverySource).not.toContain('{check.message}');
  });

  it('localizes known Agent Run phases and humanizes unknown machine values', () => {
    const keyOnly = (key: string) => key;
    expect(formatDeliveryRunPhase('quality_gates_passed', keyOnly)).toBe(
      'delivery.execution.phaseValue.qualityGatesPassed',
    );
    expect(formatDeliveryRunPhase('customer_validation', keyOnly)).toBe('customer validation');
    expect(deliverySource).not.toContain('{run.current_phase}');
    expect(deliverySource).not.toContain('[{event.phase}]');
  });

  it('uses truthful generic Korean copy for legacy readiness responses without params', () => {
    const keyOnly = (key: string) => key;
    expect(
      formatReadinessCheck(
        { key: 'approved_artifact', passed: true, message: '2 approved artifact(s)' },
        'software_release',
        keyOnly,
      ),
    ).toBe('delivery.receipt.check.approved_artifact.passedGeneric');
    expect(
      formatReadinessCheck(
        { key: 'page_limit', passed: false, message: 'Page limit exceeded.' },
        'software_release',
        keyOnly,
      ),
    ).toBe('delivery.receipt.check.page_limit.blockedGeneric');
    expect(
      formatReadinessCheck(
        { key: 'production_deploy', passed: true, message: 'Not required.' },
        'artifact_delivery',
        keyOnly,
      ),
    ).toBe('delivery.receipt.check.production_deploy.notRequired');
  });

  it('exposes accessible search, filters, async errors, and keyboard-native actions', () => {
    expect(listSource).toContain('<label');
    expect(listSource).toContain('type="checkbox"');
    expect(listSource).toContain('role="alert"');
    expect(listSource).toContain('type="button"');
    expect(detailSource).toContain('role="alert"');
    expect(detailSource).toContain('aria-label={t(');
    expect(detailSource).toContain('<Link');
  });

  it('polls operational summaries and keeps primary portfolio flows form-free', () => {
    expect(listSource).toContain('window.setInterval');
    expect(listSource).toContain('void load(false)');
    expect(detailSource).toContain('window.setInterval');
    for (const source of [
      listSource,
      detailSource,
      deliveriesTabSource,
      deliverySource,
      projectContextSource,
    ]) {
      expect(source).not.toContain('<form');
      expect(source).not.toContain('<textarea');
      expect(source).not.toContain('type="file"');
    }
    expect(listSource).toContain('kind="bootstrap-engagement"');
    expect(detailSource).toContain('kind="manage-engagement"');
    expect(deliveriesTabSource).toContain('kind="plan-delivery"');
    expect(deliverySource).toContain('kind="manage-delivery"');
    expect(projectContextSource).toContain('kind="record-project-update"');
  });

  it('adds a read-only Project context tab and Delivery source-context warning', () => {
    expect(projectSource).toContain("type ProjectTabId = 'services' | 'context'");
    expect(projectSource).toContain('<ProjectContextTab projectId={projectId} />');
    expect(projectContextSource).toContain('getProjectContext(projectId)');
    expect(projectContextSource).toContain('changed_delivery_context');
    expect(deliverySource).toContain(
      '<ProjectContextPanel detail={detail} projectId={projectId} />',
    );
    expect(deliverySource).toContain('entry.context_changed');
  });

  it('shows Agent execution evidence and the immutable Release Promotion path', () => {
    expect(deliverySource).toContain('getDeliveryExecution(projectId, deliveryId)');
    expect(deliverySource).toContain('<ExecutionPanel execution={execution} />');
    expect(deliverySource).toContain('delivery.execution.manifest');
    expect(deliverySource).toContain('delivery.execution.runner');
    expect(deliverySource).toContain('delivery.promotion.graphLabel');
    expect(deliverySource).toContain('artifact.image_digest');
    expect(deliverySource).toContain('latestPromotion');
  });

  it('adds optional Engagement context to Project and Delivery headers', () => {
    expect(projectSource).toContain('<EngagementChip projectId={projectId}');
    expect(deliverySource).toContain('<EngagementChip projectId={projectId}');
  });

  it('keeps every Engagement translation key in English and Korean', () => {
    expect(keys(en.engagements).sort()).toEqual(keys(ko.engagements).sort());
  });

  it('keeps every Delivery translation key in English and Korean', () => {
    expect(keys(en.delivery).sort()).toEqual(keys(ko.delivery).sort());
  });

  it('keeps every Project context translation key in English and Korean', () => {
    expect(keys(en.projectContext).sort()).toEqual(keys(ko.projectContext).sort());
  });
});
