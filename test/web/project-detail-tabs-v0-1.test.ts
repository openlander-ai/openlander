import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('Project detail v0.1 tabs', () => {
  const projectViewSource = readRepoFile('web/src/pages/ProjectView.tsx');
  const servicesApiSource = readRepoFile('web/src/lib/api/services.ts');
  const projectsApiSource = readRepoFile('web/src/lib/api/projects.ts');
  const enSource = readRepoFile('web/src/i18n/en.ts');
  const koSource = readRepoFile('web/src/i18n/ko.ts');

  it('exposes Resources, Deliveries, AI, and Settings tabs', () => {
    expect(projectViewSource).toContain(
      "type ProjectTabId = 'services' | 'deliveries' | 'ai' | 'settings'",
    );
    expect(projectViewSource).toContain("id: 'services'");
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
      'navigate(`/projects/${projectId}/infrastructure/${service.id}`)',
    );
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
    // Per docs/i18n-policy.md, tab labels are Chrome — same English
    // string in both locales (no Korean translation).
    expect(enTabs).toContain("services: 'Resources'");
    expect(enTabs).toContain("deliveries: 'Deliveries'");
    expect(enTabs).toContain("settings: 'Settings'");
    expect(koTabs).toContain("services: 'Resources'");
    expect(koTabs).toContain("deliveries: 'Deliveries'");
    expect(koTabs).toContain("settings: 'Settings'");
  });
});
