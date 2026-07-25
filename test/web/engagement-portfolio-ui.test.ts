import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { translations as en } from '../../web/src/i18n/en.js';
import { translations as ko } from '../../web/src/i18n/ko.js';

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
  const sidebarSource = readRepoFile('web/src/components/Shell/Sidebar.tsx');
  const listSource = readRepoFile('web/src/pages/Engagements.tsx');
  const detailSource = readRepoFile('web/src/pages/EngagementDetail.tsx');
  const projectSource = readRepoFile('web/src/pages/ProjectView.tsx');
  const deliverySource = readRepoFile('web/src/pages/DeliveryDetail.tsx');

  it('registers portfolio routes and the Workspace sidebar entry', () => {
    expect(appSource).toContain('path="/engagements"');
    expect(appSource).toContain('path="/engagements/:engagementId"');
    expect(sidebarSource).toContain("id: 'engagements'");
    expect(sidebarSource).toContain("labelKey: 'engagements.sidebar'");
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

  it('exposes accessible search, filters, async errors, and keyboard-native actions', () => {
    expect(listSource).toContain('<label');
    expect(listSource).toContain('type="checkbox"');
    expect(listSource).toContain('role="alert"');
    expect(listSource).toContain('type="button"');
    expect(detailSource).toContain('role="alert"');
    expect(detailSource).toContain('aria-label={t(');
    expect(detailSource).toContain('<Link');
  });

  it('polls operational summaries and keeps mutation errors inside their dialogs', () => {
    expect(listSource).toContain('window.setInterval');
    expect(listSource).toContain('void load(false)');
    expect(detailSource).toContain('window.setInterval');
    expect(detailSource).toContain('setEditError(');
    expect(detailSource).toContain('setLinkError(');
    expect(detailSource).toContain('{editError && (');
    expect(detailSource).toContain('{linkError && (');
    expect(detailSource).toContain('maxLength={200}');
    expect(detailSource).toContain('maxLength={4000}');
    expect(listSource).toContain('returnFocusRef={createButtonRef}');
    expect(detailSource).toContain('returnFocusRef={editButtonRef}');
    expect(detailSource).toContain('returnFocusRef={linkButtonRef}');
    expect(detailSource).toContain('className="min-w-0 rounded-lg');
  });

  it('adds optional Engagement context to Project and Delivery headers', () => {
    expect(projectSource).toContain('<EngagementChip projectId={projectId}');
    expect(deliverySource).toContain('<EngagementChip projectId={projectId}');
  });

  it('keeps every Engagement translation key in English and Korean', () => {
    expect(keys(en.engagements).sort()).toEqual(keys(ko.engagements).sort());
  });
});
