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
    expect(projectSettingsSource).toContain("type SettingsSection = 'general' | 'ai' | 'danger'");
    expect(projectSettingsSource).toContain("id: 'general'");
    expect(projectSettingsSource).toContain("id: 'ai'");
    expect(projectSettingsSource).toContain("id: 'danger'");

    expect(projectSettingsSource).not.toMatch(
      /id: 'env'|id: 'source'|id: 'domains'|id: 'resources'/,
    );
    expect(projectSettingsSource).not.toMatch(/EnvVarsTable|projectDetail\.env\.shared/);
    expect(projectSettingsSource).not.toMatch(
      /DeploymentSourcePanel|DomainsPanel|ResourceLimitsPanel|ServiceResourceLimitsPanel|SourceSettingsPanel/,
    );
  });

  it('keeps deployable ownership on Service Detail (v0.1 service IA)', () => {
    // v0.1 service detail tabs: Overview / Logs / Deployments / Monitoring /
    // AI / Environment / Domains. Resources is folded into Overview; Advanced and
    // Settings tabs are cut (PR #198). SourceSettingsPanel was removed
    // alongside the Advanced tab —
    // source/build edits route through MCP for v0.1.
    expect(serviceDetailSource).toContain("'overview'");
    expect(serviceDetailSource).toContain("'environment'");
    expect(serviceDetailSource).toContain("'domains'");
    expect(serviceDetailSource).toContain("'deployments'");
    expect(serviceDetailSource).toContain("'logs'");
    expect(serviceDetailSource).toContain("'monitoring'");
    expect(serviceDetailSource).toContain("'ai'");
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
