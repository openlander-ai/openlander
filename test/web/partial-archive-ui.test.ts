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
    ]) {
      expect(enSource).toContain(key);
      expect(koSource).toContain(key);
    }
  });
});
