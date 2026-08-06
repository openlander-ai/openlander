import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

function repoFileExists(relativePath: string): boolean {
  return existsSync(path.join(process.cwd(), relativePath));
}

describe('Project Settings split contract', () => {
  const projectSettingsSource = readRepoFile('web/src/components/project/SettingsTab.tsx');
  const serviceDetailSource = readRepoFile('web/src/pages/ServiceDetailV2.tsx');

  it('keeps Project Settings group-owned only', () => {
    expect(projectSettingsSource).toContain(
      "type SettingsSection = 'general' | 'permissions' | 'delivery' | 'ai' | 'data' | 'danger'",
    );
    expect(projectSettingsSource).toContain("id: 'general'");
    expect(projectSettingsSource).toContain("id: 'permissions'");
    expect(projectSettingsSource).toContain("id: 'delivery'");
    expect(projectSettingsSource).toContain("id: 'ai'");
    expect(projectSettingsSource).toContain("id: 'data'");
    expect(projectSettingsSource).toContain("id: 'danger'");

    expect(projectSettingsSource).not.toMatch(
      /id: 'env'|id: 'source'|id: 'domains'|id: 'resources'/,
    );
    expect(projectSettingsSource).toContain('<OperationPermissionsPanel scope="project"');
    expect(projectSettingsSource).not.toMatch(/EnvVarsTable|projectDetail\.env\.shared/);
    expect(projectSettingsSource).not.toMatch(
      /DeploymentSourcePanel|DomainsPanel|ResourceLimitsPanel|ServiceResourceLimitsPanel|SourceSettingsPanel/,
    );
  });

  it('keeps deployable ownership on Service Detail (v0.1 service IA)', () => {
    // v0.1 service detail tabs: Overview / Logs / Deployments / Monitoring /
    // Environment / Domains. Resources is folded into Overview; Advanced, AI,
    // and Settings tabs are cut. SourceSettingsPanel was removed alongside the
    // Advanced tab — source/build edits route through MCP for v0.1.
    expect(serviceDetailSource).toContain("'overview'");
    expect(serviceDetailSource).toContain("'environment'");
    expect(serviceDetailSource).toContain("'domains'");
    expect(serviceDetailSource).toContain("'deployments'");
    expect(serviceDetailSource).toContain("'logs'");
    expect(serviceDetailSource).toContain("'monitoring'");
    expect(serviceDetailSource).not.toContain("'ai'");
    expect(serviceDetailSource).not.toMatch(/\|\s*'resources'/);
    expect(serviceDetailSource).not.toMatch(/\|\s*'advanced'/);
    expect(serviceDetailSource).not.toMatch(/\|\s*'general'/);

    expect(serviceDetailSource).toContain('getServiceDomains');
    expect(serviceDetailSource).toContain('getServiceEnvVars');
    expect(serviceDetailSource).toContain('updateServiceEnvVars');
    expect(serviceDetailSource).toContain('deleteServiceEnvVar');
    // Resources still rendered, but inline inside the Overview panel rather
    // than as its own tab.
    expect(serviceDetailSource).toContain('ServiceResourceLimitsPanel');
    expect(serviceDetailSource).toContain('projectDetail.env.title');
    // Advanced tab removed — SourceSettingsPanel is no longer mounted in v0.1.
    expect(serviceDetailSource).not.toContain('SourceSettingsPanel');

    expect(serviceDetailSource).not.toContain('getProjectDomains');
    expect(serviceDetailSource).not.toContain('getProjectResources');
  });
});

describe('Legacy project-env editor stays pruned', () => {
  // Pins the deletion done by the dead-code-cleanup PR. The v0.1 IA
  // moved env editing onto Service Detail; the project-level
  // EnvVarsTable component + its API client wrappers + its i18n block
  // were dropped together. A future revert that resurrects any one
  // of them in isolation would silently re-introduce a redundant
  // surface, so the assertions guard the whole bundle.
  it('the project-level EnvVarsTable component file is gone from disk', () => {
    expect(repoFileExists('web/src/components/config/EnvVarsTable.tsx')).toBe(false);
  });

  it('the project-env API client wrappers stay removed from web/src/lib/api/projects.ts', () => {
    const apiSource = readRepoFile('web/src/lib/api/projects.ts');
    expect(apiSource).not.toMatch(/export async function getProjectEnv\b/);
    expect(apiSource).not.toMatch(/export async function updateProjectEnv\b/);
    expect(apiSource).not.toMatch(/export async function generateEnvExample\b/);
  });

  it('the orphaned envVars i18n block stays removed from both locales', () => {
    for (const locale of ['en', 'ko']) {
      const dict = readRepoFile(`web/src/i18n/${locale}.ts`);
      // The whole block (only consumer was EnvVarsTable) — not just the keys.
      expect(dict).not.toMatch(/^ {2}envVars:\s*\{/m);
      expect(dict).not.toMatch(/envVars\.pasteDescription/);
      expect(dict).not.toMatch(/envVars\.noEnvVars/);
      expect(dict).not.toMatch(/envVars\.getStarted/);
    }
  });
});

describe('Project Data Access UX contract', () => {
  const projectSettingsSource = readRepoFile('web/src/components/project/SettingsTab.tsx');
  const projectViewSource = readRepoFile('web/src/pages/ProjectView.tsx');
  const activitySource = readRepoFile('web/src/pages/Activity.tsx');
  const activityTimelineSource = readRepoFile('web/src/components/Shell/ActivityTimeline.tsx');

  it('keeps agent data access human-enabled from Project Settings', () => {
    expect(projectSettingsSource).toContain('ProjectDataAccessPanel');
    expect(projectSettingsSource).toContain('enableTarget');
    expect(projectSettingsSource).toContain('settings.data.enableConfirmTitle');
    expect(projectSettingsSource).toContain('settings.data.enableConfirmDescription');
    expect(projectSettingsSource).toContain("void setAccess(enableTarget, 'read')");
    expect(projectSettingsSource).toContain('setEnableTarget(source)');
  });

  it('keeps data access discoverable from Resources without moving the toggle there', () => {
    expect(projectViewSource).toContain('listProjectDataSources(projectId)');
    expect(projectViewSource).toContain('dataAccessByServiceId');
    expect(projectViewSource).toContain('DataAccessResourceBadge');
    expect(projectViewSource).not.toContain('updateDataSourceAccess(');
  });

  it('uses a data-specific empty state for the Activity Data Access filter', () => {
    expect(activitySource).toContain("kindFilter === 'data'");
    expect(activitySource).toContain("t('activity.page.emptyStateData')");
  });

  it('pins the visible safety facts in both locales', () => {
    const en = readRepoFile('web/src/i18n/en.ts');
    const ko = readRepoFile('web/src/i18n/ko.ts');
    for (const dict of [en, ko]) {
      for (const key of [
        'factScopeLabel',
        'factCredentialLabel',
        'factAuditLabel',
        'enableConfirmDescription',
        'emptyStateData',
      ]) {
        expect(dict).toContain(key);
      }
    }
    for (const text of [
      'Off by default',
      'All public schema tables',
      'Only enable this',
      'Hidden from agents',
      'Every read logged',
      'Agent read: On',
      'Agent read: Off',
    ]) {
      expect(en).toContain(text);
    }
    for (const text of [
      '기본값은 꺼짐',
      'public 스키마의 모든 테이블',
      '데이터 소스 전체',
      '에이전트에게 공개하지 않음',
      '모든 읽기 기록',
      '에이전트 읽기: 켜짐',
      '에이전트 읽기: 꺼짐',
    ]) {
      expect(ko).toContain(text);
    }
  });

  it('keeps data-access audit rows readable without exposing result values', () => {
    expect(activityTimelineSource).toContain('activity.dataAccess.operation');
    expect(activityTimelineSource).toContain('activity.dataAccess.preview');
    expect(activityTimelineSource).toContain('summary.preview');
    expect(activityTimelineSource).toContain('queryHash.slice');
  });
});
