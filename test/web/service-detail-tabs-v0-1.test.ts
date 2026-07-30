import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

function extractServiceTabUnion(source: string): string {
  const match = source.match(/type ServiceTabId =([^;]+);/);
  expect(match?.[1]).toBeDefined();
  return match![1];
}

function extractDeployableTabsBlock(source: string): string {
  // Scope the regex to the `const tabs = useMemo(() => [ ... ], …)`
  // block so managed-service detail tabs cannot false-match this
  // deployable-service contract.
  const match = source.match(/const tabs = useMemo<TabDef[\s\S]*?\(\) =>\s*\[([\s\S]*?)\]\.filter/);
  expect(match?.[1]).toBeDefined();
  return match![1];
}

describe('Service detail v0.1 tabs', () => {
  const source = readRepoFile('web/src/pages/ServiceDetailV2.tsx');

  it('exposes the v0.1 service tab set without a Service AI tab', () => {
    // Accept both single-line and multi-line union formatting — prettier
    // chooses based on width, so we shouldn't lock the test to either.
    const serviceTabUnion = extractServiceTabUnion(source);
    expect(serviceTabUnion).toMatch(/(?:\| )?['"]overview['"]/);
    expect(serviceTabUnion).toMatch(/['"]environment['"]/);
    expect(serviceTabUnion).toMatch(/['"]domains['"]/);
    expect(serviceTabUnion).toMatch(/['"]deployments['"]/);
    expect(serviceTabUnion).toMatch(/['"]logs['"]/);
    expect(serviceTabUnion).toMatch(/['"]monitoring['"]/);
    expect(serviceTabUnion).not.toMatch(/['"]ai['"]/);
    expect(serviceTabUnion).not.toMatch(/\|\s*'resources'/);
    expect(serviceTabUnion).not.toMatch(/\|\s*'advanced'/);
    expect(serviceTabUnion).not.toMatch(/\|\s*'general'/);
    expect(serviceTabUnion).not.toMatch(/\|\s*'settings'/);
  });

  it('drops the standalone Resources, Advanced and Settings tabs from the deployable tabs array', () => {
    const tabsBlock = extractDeployableTabsBlock(source);
    expect(tabsBlock).toContain("id: 'overview'");
    expect(tabsBlock).not.toMatch(/id:\s*'resources'/);
    expect(tabsBlock).not.toMatch(/id:\s*'advanced'/);
    expect(tabsBlock).not.toMatch(/id:\s*'general'/);
    expect(tabsBlock).not.toMatch(/id:\s*'settings'/);
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
    const tabsBlock = extractDeployableTabsBlock(source);
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

  it('keeps managed-service operations in Overview instead of a Settings tab', () => {
    expect(source).toContain("type ManagedServiceTabId = 'overview' | 'logs' | 'connections'");
    expect(source).not.toContain(
      "{ id: 'settings', label: t('services.managedDetail.tabs.settings')",
    );
    expect(source).not.toContain('panelId="managed-servicepanel-settings"');
    expect(source).toContain('<ManagedOperationsSection');
    expect(source).toContain('panelId="managed-servicepanel-overview"');
    expect(source).toContain("t('projectDetail.serviceDelete.title')");
    expect(source).toContain("t('services.managedDetail.settings.deleteBody')");
    expect(source).not.toContain("t('services.managedDetail.settings.danger')");
  });

  it('does not render missing managed-service ports as undefined', () => {
    expect(source).toContain('getManagedServicePortLabel(service)');
    expect(source).not.toContain('value={String(service.port)}');
  });

  it('falls legacy ?tab={general|resources|advanced|settings} through to overview', () => {
    expect(source).toContain('isServiceTabId(tabParam) ? tabParam : ');
    expect(source).toContain("'overview'");
    expect(source).not.toContain("activeTab === 'resources'");
    expect(source).not.toContain("activeTab === 'advanced'");
    expect(source).not.toContain("activeTab === 'general'");
  });

  it('renders Overview as the composite panel (General + Resources + Danger)', () => {
    expect(source).toContain('<GeneralTab');
    expect(source).toContain('service={resolvedService}');
    expect(source).toContain('onCredentialChanged={loadServiceDetail}');
    expect(source).toContain('<ServiceResourceLimitsPanel');
    expect(source).toContain('<ServiceDangerZone');
    expect(source).toContain('panelId="servicepanel-overview"');
  });

  it('does not render service AI Ops in Service detail', () => {
    const overviewStart = source.indexOf('panelId="servicepanel-overview"');
    const overviewEnd = source.indexOf('panelId="servicepanel-environment"');
    const overviewSource = source.slice(overviewStart, overviewEnd);

    expect(source).not.toContain("{ id: 'ai', label: t('services.detail.tabs.ai'), icon: Bot }");
    expect(source).not.toContain('panelId="servicepanel-ai"');
    expect(source).not.toContain('labelledBy="service-ai"');
    expect(source).not.toContain('scope="service"');
    expect(overviewSource).not.toContain('AiOpsBriefingPanel');
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

  it('uses operator-facing runtime metric labels instead of internal sample wording', () => {
    const generalTabStart = source.indexOf('function GeneralTab(');
    const generalTabEnd = source.indexOf('function LogsTab(');
    const generalTabSource = source.slice(generalTabStart, generalTabEnd);

    expect(generalTabSource).toContain('const { t } = useLanguage();');
    expect(source).toContain("t('services.detail.runtime.cpuSub')");
    expect(source).toContain("t('services.detail.runtime.memSub')");
    expect(source).not.toContain('latest sample');
    expect(source).not.toContain('last 60s');
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

  it('starts service deploys asynchronously and opens the live deployment log page', () => {
    expect(source).toMatch(/redeployService\(projectId,\s*id,\s*\{\s*async:\s*true\s*\}\)/);
    expect(source).toMatch(
      /const deploymentId = result\.deploymentId \?\? result\.serviceId \?\? id/,
    );
    expect(source).toMatch(
      /navigate\(`\/projects\/\$\{projectId\}\/deployments\/\$\{deploymentId\}`\)/,
    );
    expect(source).toContain(
      "type DeployUiState = 'idle' | 'pending' | 'building' | 'approval' | 'error'",
    );
    expect(source).toContain("result.status === 'pending_approval'");
    expect(source).toContain("setDeployState('approval')");
    expect(source).toContain('ACTION_RUN_RESOLVED_EVENT');
    expect(source).toContain("setDeployState('building')");
    expect(source).toContain("setDeployState('idle')");
    expect(source).toContain('disabled={deployBusy}');
    expect(source).toContain("t('serviceDetail.deploy.approvalEffect')");
    expect(readRepoFile('web/src/i18n/en.ts')).toContain("approval: 'Approval required'");
    expect(readRepoFile('web/src/i18n/ko.ts')).toContain("approval: '승인 필요'");
  });

  it('surfaces service archive before hard delete and keeps deletion typed-confirm', () => {
    expect(source).toContain('archiveGroupService');
    expect(source).toContain('unarchiveGroupService');
    expect(source).toContain('archivedAt');
    expect(source).toContain("t('projectDetail.serviceLifecycle.title')");
    expect(source).toContain("t('projectDetail.serviceLifecycle.archivedBadge')");
    expect(source).toContain('projectDetail.serviceArchive.title');
    expect(source).toContain('projectDetail.serviceRestore.title');
    expect(source.indexOf('projectDetail.serviceArchive.title')).toBeLessThan(
      source.indexOf("t('projectDetail.serviceDelete.title')"),
    );
    expect(source).toContain('expectedDeleteSlug');
    expect(source).toContain('`${projectName}/${service.name}`');
    expect(source).toContain('deleteVolumes');
    expect(source).toContain('deleteGroupService');
  });
});
