import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8');
}

describe('Project migration dialog', () => {
  const projectView = source('web/src/pages/ProjectView.tsx');
  const dialog = source('web/src/components/project/ProjectMigrationDialog.tsx');
  const projectsApi = source('web/src/lib/api/projects.ts');
  const en = source('web/src/i18n/en.ts');
  const ko = source('web/src/i18n/ko.ts');

  it('opens from the Project header More menu without adding a Project tab', () => {
    expect(projectView).toContain("t('projectDetail.migration.prepare')");
    expect(projectView).toContain('setMigrationOpen(true)');
    expect(projectView).toContain('<ProjectMigrationDialog');
    expect(projectView).not.toContain("id: 'migration'");
  });

  it('loads lazily and downloads snapshot and planning documents from the same response', () => {
    expect(dialog).toContain('if (!open || !projectId) return;');
    expect(dialog).toContain('getProjectMigration(projectId)');
    expect(dialog).toContain('JSON.stringify(bundle.snapshot, null, 2)');
    expect(dialog).toContain('bundle.document_markdown');
    expect(dialog).toContain('bundle.target_comparison.targets.map');
    expect(dialog).toContain('bundle.target_document_markdown');
    expect(dialog).toContain(
      'getProjectMigrationRunbook(projectId, runbookTarget, runbookServiceId)',
    );
    expect(dialog).toContain("service.ownership === 'project'");
    expect(dialog).toContain("service.kind === 'postgres'");
    expect(dialog).toContain('runbookBundle.document_markdown');
    expect(dialog).toContain('getProjectMigrationPreflight(projectId, runbookServiceId)');
    expect(dialog).toContain('startProjectMigrationRehearsal(projectId');
    expect(dialog).toContain('getProjectMigrationRehearsal(projectId, rehearsal.run_id)');
    expect(dialog).toContain('autoComplete="new-password"');
    expect(dialog).toContain("ssl_mode: 'require'");
    expect(dialog).toContain('confirm_empty_target: true');
    expect(dialog).toContain("setTargetPassword('')");
    expect(dialog).toContain('-migration-${timestamp}.json');
    expect(dialog).toContain('-MIGRATION-${timestamp}.md');
    expect(dialog).toContain('-TARGETS-${timestamp}.md');
    expect(dialog).toContain('-postgres-migration-runbook-${timestamp}.json');
    expect(dialog).toContain('-RUNBOOK-${timestamp}.md');
    expect(dialog).toContain('URL.revokeObjectURL(href)');
  });

  it('uses the authenticated read endpoint and keeps all dialog copy localized', () => {
    expect(projectsApi).toContain('fetchWithAuth(');
    expect(projectsApi).toContain('/migration`');
    for (const locale of [en, ko]) {
      expect(locale).toContain('migration: {');
      expect(locale).toContain('noCloudChanges:');
      expect(locale).toContain('secretsExcluded:');
      expect(locale).toContain('downloadJson:');
      expect(locale).toContain('downloadMarkdown:');
      expect(locale).toContain('downloadTargets:');
      expect(locale).toContain('runbook: {');
      expect(locale).toContain('preflight: {');
      expect(locale).toContain('rehearsal: {');
      expect(locale).toContain('credentialPolicy:');
      expect(locale).toContain('confirmEmpty:');
      expect(locale).toContain('writeFreeze:');
      expect(locale).toContain('downloadMarkdown:');
      expect(locale).toContain('review_required:');
      expect(locale).toContain('needs_attention:');
    }
  });
});
