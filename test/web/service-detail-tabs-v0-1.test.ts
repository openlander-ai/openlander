import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('Service detail v0.1 tabs', () => {
  const source = readRepoFile('web/src/pages/ServiceDetailV2.tsx');

  it('exposes the v0.1 6-tab set (Overview/Logs/Deployments/Monitoring/Environment/Domains)', () => {
    // Accept both single-line and multi-line union formatting — prettier
    // chooses based on width, so we shouldn't lock the test to either.
    expect(source).toMatch(/type ServiceTabId =\s*[\n ]*(?:\| )?['"]overview['"]/);
    expect(source).toMatch(/['"]environment['"]/);
    expect(source).toMatch(/['"]domains['"]/);
    expect(source).toMatch(/['"]deployments['"]/);
    expect(source).toMatch(/['"]logs['"]/);
    expect(source).toMatch(/['"]monitoring['"]/);
    expect(source).not.toMatch(/\|\s*'resources'/);
    expect(source).not.toMatch(/\|\s*'advanced'/);
    expect(source).not.toMatch(/\|\s*'general'/);
    expect(source).not.toMatch(/\|\s*'settings'/);
  });

  it('drops the standalone Resources, Advanced and Settings tabs from the tabs array', () => {
    expect(source).toContain("id: 'overview'");
    expect(source).not.toMatch(/id:\s*'resources'/);
    expect(source).not.toMatch(/id:\s*'advanced'/);
    expect(source).not.toMatch(/id:\s*'general'/);
    expect(source).not.toMatch(/id:\s*'settings'/);
    expect(source).not.toContain("label: 'General'");
    expect(source).not.toContain("label: 'Resources'");
    expect(source).not.toContain("label: 'Advanced'");
  });

  it('orders tabs observability-first per the v0.1 spec (Overview/Logs/Deployments/Monitoring/Environment/Domains)', () => {
    // Pre-sweep order was config-first (Overview/Environment/Domains/
    // Deployments/Logs/Monitoring); v0.1 spec mandates observability-
    // first because OpenLander is agent-first — humans hit Service
    // Detail mostly to diagnose, not to configure.
    //
    // Scope the regex to the `const tabs = useMemo(() => [ ... ], …)`
    // block so it cannot false-match `id: '<word>'` from helper
    // objects, comments, or future code outside the tabs array (Codex
    // CCG round-1 P2). Anchor on the literal `useMemo<TabDef` opener
    // we own and stop at the first `]` that closes the array literal.
    const tabsBlockMatch = source.match(
      /const tabs = useMemo<TabDef[\s\S]*?\(\) => \[([\s\S]*?)\]/,
    );
    expect(tabsBlockMatch?.[1]).toBeDefined();
    const tabsBlock = tabsBlockMatch![1];
    const ids: string[] = [];
    const re = /id:\s*'([a-z]+)'/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(tabsBlock)) !== null) {
      ids.push(match[1]);
    }
    expect(ids).toEqual([
      'overview',
      'logs',
      'deployments',
      'monitoring',
      'environment',
      'domains',
    ]);
  });

  it('falls legacy ?tab={general|resources|advanced|settings} through to overview', () => {
    expect(source).toContain('isServiceTabId(tabParam) ? tabParam : ');
    expect(source).toContain("'overview'");
    expect(source).not.toContain("activeTab === 'resources'");
    expect(source).not.toContain("activeTab === 'advanced'");
    expect(source).not.toContain("activeTab === 'general'");
  });

  it('renders Overview as the composite panel (General + Resources + Danger)', () => {
    expect(source).toContain('<GeneralTab service={resolvedService} />');
    expect(source).toContain('<ServiceResourceLimitsPanel');
    expect(source).toContain('<ServiceDangerZone');
    expect(source).toContain('panelId="servicepanel-overview"');
  });

  it('uses measured metrics for Monitoring headlines without fake traffic values', () => {
    expect(source).toContain('const cpuDisplay = formatMetricAverage(cpuData');
    expect(source).toContain('const memDisplay = formatMetricAverage(memData');
    expect(source).toContain('value={cpuDisplay}');
    expect(source).toContain('value={memDisplay}');
    expect(source).toContain('const hasTrafficTelemetry =');
    expect(source).not.toContain("value={service.cpu || '—'}");
    expect(source).not.toContain("value={service.mem || '—'}");
    expect(source).not.toContain('512 MB limit');
  });

  it('replaces AdvancedTab with ServiceDangerZone (Advanced cut for v0.1)', () => {
    expect(source).toContain('function ServiceDangerZone(');
    expect(source).not.toContain('function AdvancedTab(');
    expect(source).not.toContain('panelId="servicepanel-advanced"');
    expect(source).not.toContain('panelId="servicepanel-resources"');
    expect(source).not.toContain('panelId="servicepanel-general"');
  });

  it('navigates the Deployments View action to the route page (no black-backdrop modal)', () => {
    // The v0.1 spec design (`p7-log-success.png`) shows the deploy
    // detail surface as a full page inside the dashboard chrome —
    // sidebar + breadcrumb + StaticLogViewer + summary card — at the
    // route `/projects/:id/deployments/:deployId`. The legacy "open
    // in place" modal overlay rendered a black-backdrop layer over
    // the service detail page; the design never had that backdrop.
    //
    // Pin both halves of the contract:
    //   1. Clicking View navigates to the route page.
    //   2. The legacy modal overlay + its `openDeployId` state + the
    //      Shell-variant LogViewer mount are gone.
    expect(source).toMatch(/navigate\(`\/projects\/\$\{projectId\}\/deployments\/\$\{[^}]+\}`\)/);
    expect(source).not.toMatch(/setOpenDeployId/);
    expect(source).not.toMatch(/const \[openDeployId,/);
    // The Shell `LogViewer` was the modal variant. The page-level
    // surface uses `StaticLogViewer` from `@/components/logs/...` via
    // DeploymentDetail.tsx. Only the runtime ConsoleLogViewer alias
    // should remain mounted in this file.
    expect(source).not.toMatch(/from '@\/components\/Shell\/LogViewer'/);
    expect(source).toMatch(/from '@\/components\/logs\/LogViewer'/);
    // The black-backdrop modal layer (`fixed inset-0 ... bg-black/60`)
    // mounted only the deploy LogViewer; assert it isn't reintroduced.
    expect(source).not.toMatch(/fixed inset-0 z-40 flex items-stretch bg-black\/60/);
  });

  it('keeps service deletion typed-confirm (Group A defensive UI path)', () => {
    expect(source).toContain('expectedDeleteSlug');
    expect(source).toContain("`${projectName}/${service.name}`");
    expect(source).toContain('deleteVolumes');
    expect(source).toContain('deleteGroupService');
  });
});
