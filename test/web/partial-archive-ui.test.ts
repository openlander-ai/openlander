import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('partial archive UI wiring', () => {
  const gridSource = readRepoFile('web/src/pages/ProjectsGrid.tsx');
  const headerSource = readRepoFile('web/src/components/project/ProjectHeader.tsx');
  const settingsSource = readRepoFile('web/src/components/project/SettingsTab.tsx');
  const enSource = readRepoFile('web/src/i18n/en.ts');
  const koSource = readRepoFile('web/src/i18n/ko.ts');

  it('shows a partial archive badge on project list cards', () => {
    expect(gridSource).toContain('p.partiallyArchived === true || p.partially_archived === true');
    expect(gridSource).toContain("t('projects.card.partiallyArchivedBadge')");
  });

  it('uses archive-remaining copy in project detail actions', () => {
    expect(headerSource).toContain('isPartiallyArchived');
    expect(headerSource).toContain("'projects.archive.remainingButton'");
    expect(settingsSource).toContain("'projectDetail.danger.partialArchiveTitle'");
    expect(settingsSource).toContain("'projectDetail.danger.partialArchiveBody'");
  });

  it('keeps English and Korean lifecycle copy in lockstep', () => {
    for (const key of [
      'partiallyArchivedBadge',
      'remainingButton',
      'remainingDescription',
      'partialArchiveTitle',
      'partialArchiveBody',
      'archivedVisible',
      'showArchived',
      'hideArchived',
      'archivedServicesTitle',
      'archivedServicesBody',
      'archivedServicesEmpty',
      'deleteArchivedServiceHint',
      'deleteArchivedServiceInputLabel',
    ]) {
      expect(enSource).toContain(key);
      expect(koSource).toContain(key);
    }
  });

  it('uses plain Korean for partial-archive controls', () => {
    expect(koSource).toContain("partiallyArchivedBadge: '일부 보관됨'");
    expect(koSource).toContain("remainingButton: '나머지 보관'");
    expect(koSource).toContain("partialArchiveTitle: '남은 애플리케이션 보관'");
    expect(koSource).toContain("showArchived: '보관된 애플리케이션 표시'");
    expect(koSource).toContain("hideArchived: '보관된 애플리케이션 숨기기'");
  });

  it('keeps archived service cleanup reachable after default lists hide archived rows', () => {
    const projectViewSource = readRepoFile('web/src/pages/ProjectView.tsx');
    const serviceDetailSource = readRepoFile('web/src/pages/ServiceDetailV2.tsx');
    const apiSource = readRepoFile('web/src/lib/api/services.ts');

    expect(apiSource).toContain("params.set('include_archived', 'true')");
    expect(settingsSource).toContain('listGroupServices(projectId, { includeArchived: true })');
    expect(settingsSource).toContain('service.archivedAt != null');
    expect(settingsSource).toContain('unarchiveGroupService(projectId, service.id)');
    expect(settingsSource).toContain('deleteGroupService(projectId, service.id');
    expect(settingsSource).toContain('`${projectName}/${service.name}`');
    expect(settingsSource).toContain("'projectDetail.danger.archivedServicesTitle'");
    expect(settingsSource).toContain('archivedServiceStatusLabel(service.status, t)');
    expect(settingsSource).not.toContain('{service.status}');
    expect(settingsSource).toContain("'projectDetail.danger.deleteArchivedServiceHint'");
    expect(settingsSource).toContain("'projectDetail.danger.deleteArchivedServiceInputLabel'");
    expect(projectViewSource).toContain('showArchivedServices');
    expect(projectViewSource).toContain('archivedAt &&');
    expect(projectViewSource).toContain('const archivedServiceCount =');
    expect(projectViewSource).toContain(
      'const canToggleArchived = !archiveForced && archivedCount > 0',
    );
    expect(projectViewSource).toContain('archivedCount={archivedServiceCount}');
    expect(serviceDetailSource).toContain('groupServiceToDetailNode');
    expect(serviceDetailSource).toContain('service ?? (serviceDetail');
  });

  it('loads archived project detail outside the active project context', () => {
    const projectViewSource = readRepoFile('web/src/pages/ProjectView.tsx');

    expect(projectViewSource).toContain('getProject as fetchProject');
    expect(projectViewSource).toContain('const contextProject = projects.find');
    expect(projectViewSource).toContain('contextProject ??');
    expect(projectViewSource).toContain('fetchProject(projectId)');
    expect(projectViewSource).toContain('fallbackProjectLoading');
    expect(projectViewSource).toContain(
      'const isProjectArchived = realProject?.archived_at != null',
    );
    expect(projectViewSource).toContain(
      'const showArchivedServiceList = showArchivedServices || isProjectArchived',
    );
    expect(projectViewSource).toContain('{!isProjectArchived && (');
    expect(projectViewSource).toContain('archiveForced={isProjectArchived}');
  });

  it('keeps Korean loading copy localized for archived-service cleanup', () => {
    expect(koSource).toContain("archivedServicesLoading: '보관된 애플리케이션을 불러오는 중…'");
  });
});
