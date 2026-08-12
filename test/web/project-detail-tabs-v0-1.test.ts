import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('Project detail v0.1 tabs', () => {
  const projectViewSource = readRepoFile('web/src/pages/ProjectView.tsx');
  const resourceQuickMenuSource = readRepoFile('web/src/components/project/ResourceQuickMenu.tsx');
  const serviceDetailSource = readRepoFile('web/src/pages/ServiceDetailV2.tsx');
  const servicesApiSource = readRepoFile('web/src/lib/api/services.ts');
  const projectsApiSource = readRepoFile('web/src/lib/api/projects.ts');
  const enSource = readRepoFile('web/src/i18n/en.ts');
  const koSource = readRepoFile('web/src/i18n/ko.ts');

  it('exposes Resources, Context, Deliveries, AI, and Settings tabs', () => {
    expect(projectViewSource).toContain(
      "type ProjectTabId = 'services' | 'context' | 'deliveries' | 'ai' | 'settings'",
    );
    expect(projectViewSource).toContain("id: 'services'");
    expect(projectViewSource).toContain("id: 'context'");
    expect(projectViewSource).toContain("id: 'deliveries'");
    expect(projectViewSource).toContain("id: 'ai'");
    expect(projectViewSource).toContain("id: 'settings'");
    expect(projectViewSource).not.toMatch(/id:\s*'mcp'/);
    expect(projectViewSource).not.toMatch(/id:\s*'activity'/);
  });

  it('falls through legacy ?tab=mcp to services without rendering an MCP panel', () => {
    expect(projectViewSource).toContain("tabParam === 'settings'");
    expect(projectViewSource).toContain("tabParam === 'deliveries'");
    expect(projectViewSource).toContain("tabParam === 'ai'");
    expect(projectViewSource).toContain(": 'services';");
    expect(projectViewSource).not.toContain('projectpanel-mcp');
    expect(projectViewSource).not.toContain('<ProjectMcpTab');
  });

  it('drops the ProjectMcpTab component import and file (PR #188 revert)', () => {
    expect(projectViewSource).not.toMatch(/ProjectMcpTab/);
    expect(
      existsSync(path.join(process.cwd(), 'web/src/components/project/ProjectMcpTab.tsx')),
    ).toBe(false);
  });

  it('shows connected Database/Cache/Storage resources in the project Resources tab', () => {
    expect(servicesApiSource).toContain(
      'apiGet<ProjectManagedService[]>(`/api/projects/${groupId}/managed-services`)',
    );
    expect(projectsApiSource).toContain('`/api/projects/${id}/managed-services${params}`');
    expect(projectViewSource).toContain('managedServices.listForGroup(projectId)');
    expect(projectViewSource).toContain('managedServiceToNode');
    expect(projectViewSource).toContain('const projectServiceRows = useMemo');
    expect(projectViewSource).toContain('services={projectServiceRows}');
    expect(projectViewSource).toContain(
      'navigate(`/projects/${projectId}/infrastructure/${service.id}${tabQuery}`)',
    );
  });

  it('offers lazy, propagation-safe resource quick actions without list-level API fanout', () => {
    expect(projectViewSource).toContain('<ResourceQuickMenu');
    expect(resourceQuickMenuSource).toContain('<DropdownMenuContent align="end"');
    expect(resourceQuickMenuSource).toContain('if (open) void loadAccess()');
    expect(resourceQuickMenuSource).toContain("void publish('protected_share')");
    expect(resourceQuickMenuSource).toContain("void publish('cloudflare')");
    expect(resourceQuickMenuSource).toContain("activeAccess?.status === 'public'");
    expect(resourceQuickMenuSource).toContain("activeAccess?.status === 'provisioning'");
    expect(resourceQuickMenuSource).toContain('<ConfirmDialog');
    expect(resourceQuickMenuSource).toContain('shareResult?.access_code');
    expect(projectViewSource).toContain('`?tab=${encodeURIComponent(tab)}`');
    expect(serviceDetailSource).toContain('isManagedServiceTabId(tabParam) ? tabParam :');
    expect(projectViewSource).not.toContain('getServicePublicAccess(');
  });

  it('keeps resource quick-menu copy localized in both locales', () => {
    for (const source of [enSource, koSource]) {
      expect(source).toContain('quickActions: {');
      expect(source).toContain('shareProtected:');
      expect(source).toContain('shareCloudflare:');
      expect(source).toContain('shareProvisioning:');
      expect(source).toContain('retryShareStatus:');
      expect(source).toContain('shareResultTitle:');
    }
  });

  it('drops the projectDetail.tabs.mcp i18n key from both locales', () => {
    function projectDetailTabsBlock(source: string): string {
      const start = source.indexOf('projectDetail:');
      expect(start).toBeGreaterThanOrEqual(0);
      const tabsAt = source.indexOf('tabs:', start);
      expect(tabsAt).toBeGreaterThan(start);
      const closing = source.indexOf('}', tabsAt);
      return source.slice(tabsAt, closing);
    }

    const enTabs = projectDetailTabsBlock(enSource);
    const koTabs = projectDetailTabsBlock(koSource);

    expect(enTabs).not.toMatch(/mcp:/);
    expect(koTabs).not.toMatch(/mcp:/);
    expect(enTabs).toContain("services: 'Resources'");
    expect(enTabs).toContain("context: 'Context'");
    expect(enTabs).toContain("deliveries: 'Deliveries'");
    expect(enTabs).toContain("settings: 'Settings'");
    expect(koTabs).toContain("services: '리소스'");
    expect(koTabs).toContain("context: '현황'");
    expect(koTabs).toContain("deliveries: '납품 건'");
    expect(koTabs).toContain("settings: '설정'");
  });
});
