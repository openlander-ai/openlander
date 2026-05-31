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
    ]) {
      expect(enSource).toContain(key);
      expect(koSource).toContain(key);
    }
  });

  it('keeps partial-archive chrome labels English in Korean locale', () => {
    expect(koSource).toContain("partiallyArchivedBadge: 'Partially archived'");
    expect(koSource).toContain("remainingButton: 'Archive remaining'");
    expect(koSource).toContain("partialArchiveTitle: 'Archive remaining services'");
    expect(koSource).toContain("showArchived: 'Show archived services'");
    expect(koSource).toContain("hideArchived: 'Hide archived services'");
  });

  it('keeps archived service cleanup reachable after default lists hide archived rows', () => {
    const projectViewSource = readRepoFile('web/src/pages/ProjectView.tsx');
    const serviceDetailSource = readRepoFile('web/src/pages/ServiceDetailV2.tsx');
    const apiSource = readRepoFile('web/src/lib/api/services.ts');

    expect(apiSource).toContain('include_archived=true');
    expect(projectViewSource).toContain('showArchivedServices');
    expect(projectViewSource).toContain('archivedAt &&');
    expect(serviceDetailSource).toContain('groupServiceToDetailNode');
    expect(serviceDetailSource).toContain('service ?? (serviceDetail');
  });
});
